import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The real proof for the migration: run the SAME supabase-js query against live
 * Supabase and against the D1 copy through the adapter, and demand identical
 * answers — data, error and count.
 *
 * Skipped unless RUN_D1_PARITY=1, so `npm test` stays offline and fast. Run it
 * deliberately:
 *   RUN_D1_PARITY=1 npx vitest run tests/d1AdapterParity.test.ts
 * READ-ONLY on both sides: every query here is a select.
 */
const ENABLED = process.env.RUN_D1_PARITY === "1";

function loadEnv() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  process.env.D1_DATABASE_ID ??= "ffb9dcff-a501-4dc2-a94a-e5301e2595f0"; // borivon-db (WEUR)
}

/** Both sides answer these; every shape here is one the portal really uses. */
const QUERIES: { name: string; run: (db: SupabaseClient) => PromiseLike<unknown> }[] = [
  { name: "select all + order + limit", run: (db) => db.from("documents").select("id, user_id, status, uploaded_at").order("uploaded_at", { ascending: false }).order("id").limit(5) },
  { name: "eq filter", run: (db) => db.from("documents").select("id, file_type").eq("status", "approved").order("id").limit(5) },
  { name: "neq + is null", run: (db) => db.from("documents").select("id").neq("status", "approved").is("superseded_at", null).order("id").limit(5) },
  { name: "in list", run: (db) => db.from("phase_slots").select("id, label, phase").in("phase", ["bearbeitung", "visum"]).order("id").limit(10) },
  { name: "ilike", run: (db) => db.from("sub_admins").select("email").ilike("email", "%@%").order("email") },
  { name: "not eq", run: (db) => db.from("notifications").select("id, action").not("action", "eq", "approved").order("id").limit(5) },
  { name: "or filter", run: (db) => db.from("phase_slots").select("id, org_id").or("org_id.is.null,type.eq.simple").order("id").limit(10) },
  { name: "gte on a timestamp", run: (db) => db.from("documents").select("id").gte("uploaded_at", "2026-01-01T00:00:00+00:00").order("id").limit(5) },
  { name: "range (offset)", run: (db) => db.from("candidate_journey_items").select("id, text").order("id").range(10, 14) },
  { name: "maybeSingle (one row)", run: (db) => db.from("app_settings").select("key, value").eq("key", "bot_quiet").maybeSingle() },
  { name: "maybeSingle (no rows)", run: (db) => db.from("app_settings").select("key").eq("key", "does-not-exist").maybeSingle() },
  { name: "single (no rows → PGRST116)", run: (db) => db.from("app_settings").select("key").eq("key", "does-not-exist").single() },
  { name: "head + exact count", run: (db) => db.from("documents").select("id", { count: "exact", head: true }) },
  { name: "boolean column", run: (db) => db.from("documents").select("id, uploaded_by_admin").eq("uploaded_by_admin", true).order("id").limit(5) },
  { name: "json column", run: (db) => db.from("candidate_status").select("user_id, vaccines").order("user_id").limit(3) },
  { name: "missing table → PGRST205", run: (db) => db.from("does_not_exist").select("id") },
  { name: "missing column → 42703", run: (db) => db.from("documents").select("id, nope_not_here").limit(1) },
];

describe.skipIf(!ENABLED)("adapter answers exactly like Supabase", () => {
  let live: SupabaseClient;
  let copy: SupabaseClient;

  beforeAll(async () => {
    loadEnv();
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    live = createClient(url, key);
    copy = createClient(url, key, { global: { fetch: makeBvFetch() } });
  });

  for (const q of QUERIES) {
    it(q.name, async () => {
      const a = (await q.run(live)) as { data: unknown; error: { code?: string } | null; count?: number | null };
      const b = (await q.run(copy)) as { data: unknown; error: { code?: string } | null; count?: number | null };
      expect({ error: a.error?.code ?? null, count: a.count ?? null }).toEqual({ error: b.error?.code ?? null, count: b.count ?? null });
      expect(b.data).toEqual(a.data);
    });
  }
});
