import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The shadow reads against live traffic found four tables whose answers
 * differed — employers, phase_slots, employer_batches, candidate_profiles.
 * This proves what that difference IS: the same rows in a different order.
 *
 * A query with no .order() is an unordered set in SQL. Postgres hands back
 * heap order, SQLite hands back rowid order, and both are correct — but if
 * the CONTENT ever differs, that is a real defect in the copy. So: the set
 * must match exactly, every time; the sequence is allowed to differ, and when
 * the query DOES ask for an order, the sequence must match too.
 *
 * Runs against the real Supabase and the real D1 copy, so it is skipped
 * unless asked for:
 *   RUN_D1_PARITY=1 npx vitest run tests/d1OrderParity.test.ts
 */
const ENABLED = process.env.RUN_D1_PARITY === "1";

function loadEnv() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  process.env.D1_DATABASE_ID ??= "ffb9dcff-a501-4dc2-a94a-e5301e2595f0";
}

/** Row → hash, with timestamps compared as instants and keys order-independent. */
function fingerprints(rows: Record<string, unknown>[]): string[] {
  return rows.map((row) => {
    const norm: Record<string, unknown> = {};
    for (const k of Object.keys(row).sort()) {
      const v = row[k];
      norm[k] = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? `@${Date.parse(v)}` : v;
    }
    return crypto.createHash("sha256").update(JSON.stringify(norm)).digest("hex");
  });
}

let live: SupabaseClient, copy: SupabaseClient;

describe.skipIf(!ENABLED)("the copy holds the same rows, order aside", () => {
  beforeAll(async () => {
    loadEnv();
    const { getD1 } = await import("../lib/d1/client");
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const runner = await getD1();
    if (!runner) throw new Error("no D1 runner — refusing to run");
    live = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    copy = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      global: {
        fetch: makeBvFetch({
          runner,
          passthrough: (async () => { throw new Error("blocked: this test must never reach Supabase") }) as unknown as typeof fetch,
        }),
      },
    });
  });

  // The exact shapes the live shadow reads flagged.
  const UNORDERED: [string, string][] = [
    ["employers", "*"],
    ["phase_slots", "*"],
    ["employer_batches", "*"],
    ["candidate_profiles", "user_id, profile_photo"],
  ];

  it.each(UNORDERED)("%s: identical set of rows", async (table, select) => {
    const [a, b] = await Promise.all([live.from(table).select(select), copy.from(table).select(select)]);
    expect(a.error, `supabase: ${a.error?.message}`).toBeNull();
    expect(b.error, `d1: ${b.error?.message}`).toBeNull();
    const fa = fingerprints((a.data ?? []) as unknown as Record<string, unknown>[]);
    const fb = fingerprints((b.data ?? []) as unknown as Record<string, unknown>[]);
    expect(fb).toHaveLength(fa.length);
    expect([...fb].sort()).toEqual([...fa].sort());        // same rows…
  });

  it.each([
    ["phase_slots", "position"],
    ["employers", "created_at"],
  ])("%s: an explicit order is honoured exactly", async (table, column) => {
    const [a, b] = await Promise.all([
      live.from(table).select(`id, ${column}`).order(column, { ascending: true }).limit(200),
      copy.from(table).select(`id, ${column}`).order(column, { ascending: true }).limit(200),
    ]);
    expect(a.error, `supabase: ${a.error?.message}`).toBeNull();
    expect(b.error, `d1: ${b.error?.message}`).toBeNull();
    // …and when the order is asked for, the SORT KEY comes back in the same
    // sequence. Not the ids: `employers` holds two rows created in the same
    // transaction, so they carry the identical created_at and SQL leaves the
    // order of a tie undefined on both sides. Asserting ids there would be
    // asserting an accident.
    const rowsOf = (d: unknown) => (d ?? []) as unknown as Record<string, unknown>[];
    const keyOf = (d: unknown) => rowsOf(d).map((r) => String(r[column]));
    const idsOf = (d: unknown) => rowsOf(d).map((r) => String(r.id)).sort();
    expect(keyOf(b.data)).toEqual(keyOf(a.data));
    expect(idsOf(b.data)).toEqual(idsOf(a.data));
  });
});
