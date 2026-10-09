import { describe, it, expect, vi, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { hasSqlite, openDb, sqliteRunner } from "./helpers/sqliteD1";
import { makeBvFetch } from "../lib/d1/bvFetch";

/**
 * /api/portal/admin/classroom/candidates — the classroom picker's default list.
 *
 * It read `candidate_profiles … limit(40)` with NO order, then sorted those 40
 * by name and showed 25. Which 40 is unspecified SQL: Postgres handed back heap
 * order, D1 hands back rowid order, so after the switch the admin's default list
 * was a different arbitrary 25 (found by tests/routeParity.test.ts: same route,
 * same admin, different candidates on Supabase and live D1). Ordered before the
 * limit, it is the alphabetical first page on any backend.
 *
 * Real adapter over a real SQLite with the D1 schema: rows are inserted in
 * REVERSE alphabetical order, so rowid order is the worst case.
 */
const state: { client: ReturnType<typeof createClient> | null } = { client: null };

vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => state.client,
  getAnonVerifyClient: () => ({}),
  supabase: {},
}));
vi.mock("@/lib/admin-auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-auth")>()),
  requireAdminRole: async () => ({ ok: true, role: "admin", email: "admin@example.invalid", userId: "u-admin", agencyId: null, isAgencyAdmin: false }),
  getStaffUserIdsAmong: async () => new Set<string>(),
}));

describe.skipIf(!hasSqlite)("classroom candidate picker — default list", () => {
  beforeAll(() => {
    const db = openDb({ schema: true });
    // 60 candidates "Cand 59" … "Cand 00": inserted Z→A, so the first 40 rowids are the LAST 40 names.
    for (let i = 59; i >= 0; i--) {
      const n = String(i).padStart(2, "0");
      db.prepare(`INSERT INTO "candidate_profiles" ("user_id", "first_name", "last_name") VALUES (?, ?, ?)`)
        .run(`00000000-0000-4000-8000-0000000000${n}`, "Cand", n);
    }
    state.client = createClient("https://example.supabase.co", "service-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: makeBvFetch({ runner: sqliteRunner(db), passthrough: (async () => { throw new Error("no network in this test"); }) as unknown as typeof fetch }) },
    });
  });

  it("shows the alphabetical first 25, not whichever rows the database returned first", async () => {
    const { GET } = await import("@/app/api/portal/admin/classroom/candidates/route");
    const res = await GET(new NextRequest("https://www.borivon.com/api/portal/admin/classroom/candidates?q="));
    expect(res.status).toBe(200);
    const { candidates } = (await res.json()) as { candidates: { name: string }[] };
    expect(candidates.map((c) => c.name)).toEqual(Array.from({ length: 25 }, (_, i) => `Cand ${String(i).padStart(2, "0")}`));
  });
});
