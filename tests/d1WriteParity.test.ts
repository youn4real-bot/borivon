import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Writes through the adapter, end to end against the real D1 copy.
 *
 * Reads are proven elsewhere (query, table and feature parity). This covers
 * the other half: insert / update / upsert / delete, the rows they return, and
 * the error codes callers branch on — run against D1 exactly as the portal
 * would issue them.
 *
 * SAFETY: the client's passthrough THROWS. The adapter only answers /rest/v1
 * from D1, so if anything tried to reach Supabase this test fails loudly
 * instead of writing to live data. It also refuses to run without a D1 runner.
 * Everything it creates is removed again, and it only touches
 * candidate_reminders (a log table, empty in production).
 *
 * Skipped unless RUN_D1_PARITY=1:
 *   RUN_D1_PARITY=1 npx vitest run tests/d1WriteParity.test.ts
 */
const ENABLED = process.env.RUN_D1_PARITY === "1";
const TABLE = "candidate_reminders";
const MARK = "d1-write-parity";           // kind value that marks our rows
const USER = "00000000-0000-4000-8000-00000000d1d1";

function loadEnv() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  process.env.D1_DATABASE_ID ??= "ffb9dcff-a501-4dc2-a94a-e5301e2595f0";
}

let db: SupabaseClient;

describe.skipIf(!ENABLED)("writes behave like PostgREST, against the D1 copy", () => {
  beforeAll(async () => {
    loadEnv();
    const { getD1 } = await import("../lib/d1/client");
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const runner = await getD1();
    if (!runner) throw new Error("no D1 runner — refusing to run (a passthrough would hit live Supabase)");
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      global: {
        fetch: makeBvFetch({
          runner,
          passthrough: (async () => { throw new Error("blocked: this test must never reach Supabase"); }) as unknown as typeof fetch,
        }),
      },
    });
  });

  afterAll(async () => {
    if (db) await db.from(TABLE).delete().eq("kind", MARK);
  });

  it("insert returns the inserted row, with defaults filled in", async () => {
    const { data, error } = await db.from(TABLE)
      .insert({ user_id: USER, kind: MARK, items: [{ kind: "missing", key: "diploma" }] })
      .select("id, user_id, kind, items, sent_at")
      .single();
    expect(error).toBeNull();
    expect(data!.user_id).toBe(USER);
    expect(data!.items).toEqual([{ kind: "missing", key: "diploma" }]);      // jsonb comes back parsed
    expect(String(data!.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(String(data!.sent_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\+00:00$/);
  });

  it("bulk insert writes every row", async () => {
    const { data, error } = await db.from(TABLE)
      .insert([
        { user_id: USER, kind: MARK, items: [] },
        { user_id: USER, kind: MARK, items: [{ kind: "rejected", key: "id" }] },
      ])
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("update touches only the matching rows and returns them", async () => {
    const { data: before } = await db.from(TABLE).select("id").eq("kind", MARK).limit(1);
    const id = (before as { id: string }[])[0].id;
    const { data, error } = await db.from(TABLE).update({ items: [{ kind: "missing", key: "langcert" }] }).eq("id", id).select("id, items").single();
    expect(error).toBeNull();
    expect(data!.items).toEqual([{ kind: "missing", key: "langcert" }]);
    const { count } = await db.from(TABLE).select("id", { count: "exact", head: true }).eq("kind", MARK);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("upsert updates on conflict and can ignore duplicates", async () => {
    const { data: rows } = await db.from(TABLE).select("id").eq("kind", MARK).limit(1);
    const id = (rows as { id: string }[])[0].id;

    const merged = await db.from(TABLE).upsert({ id, user_id: USER, kind: MARK, items: [{ kind: "rejected", key: "cv_de" }] }, { onConflict: "id" }).select("id, items").single();
    expect(merged.error).toBeNull();
    expect(merged.data!.items).toEqual([{ kind: "rejected", key: "cv_de" }]);

    const ignored = await db.from(TABLE).upsert({ id, user_id: USER, kind: MARK, items: [] }, { onConflict: "id", ignoreDuplicates: true }).select("id");
    expect(ignored.error).toBeNull();
    const after = await db.from(TABLE).select("items").eq("id", id).single();
    expect(after.data!.items).toEqual([{ kind: "rejected", key: "cv_de" }]);   // untouched
  });

  it("delete removes only what it matched", async () => {
    const { data: made } = await db.from(TABLE).insert({ user_id: USER, kind: MARK, items: [] }).select("id").single();
    const { error } = await db.from(TABLE).delete().eq("id", (made as { id: string }).id);
    expect(error).toBeNull();
    const { data } = await db.from(TABLE).select("id").eq("id", (made as { id: string }).id).maybeSingle();
    expect(data).toBeNull();
  });

  it("reports the Postgres error codes callers branch on", async () => {
    const dup = await db.from(TABLE).select("id").eq("kind", MARK).limit(1);
    const id = (dup.data as { id: string }[])[0].id;

    const unique = await db.from(TABLE).insert({ id, user_id: USER, kind: MARK, items: [] });
    expect(unique.error?.code).toBe("23505");                       // duplicate key

    const notNull = await db.from(TABLE).insert({ kind: MARK, items: [] } as never);
    expect(notNull.error?.code).toBe("23502");                      // user_id is NOT NULL

    const badCheck = await db.from("notifications").insert({ user_id: USER, doc_id: USER, doc_name: "x", doc_type: "x", action: "not-a-real-action" } as never);
    expect(badCheck.error?.code).toBe("23514");                     // CHECK constraint

    const badColumn = await db.from(TABLE).insert({ user_id: USER, kind: MARK, nope: 1 } as never);
    expect(["PGRST204", "42703"]).toContain(badColumn.error?.code);  // unknown column

    const badTable = await db.from("no_such_table").insert({ a: 1 } as never);
    expect(badTable.error?.code).toBe("PGRST205");                   // unknown table
  });
});
