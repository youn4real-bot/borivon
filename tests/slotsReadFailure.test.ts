import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { isSchemaMissing, isReadFailure, READ_FAILED } from "../lib/readFailure";

/**
 * F (server half) — A FAILED READ IS NOT AN EMPTY LIST.
 *
 * GET /api/portal/phase-slots used to destructure the error away on every
 * `phase_slots` select and answer HTTP 200 with `slots: []`. One database
 * hiccup while a nurse's dashboard loaded and every Bearbeitung and Visum box
 * vanished behind a calm "no documents yet" — and the client could not tell
 * empty from broken, because on the wire the two were the same response.
 *
 * The contract these pin (the p1-dash track codes the client against it):
 *   200 { slots: [] }                  read fine, genuinely none
 *   503 { error, code: "READ_FAILED" } unknown, retry — never a fake []
 * A PENDING MIGRATION is still not a failure: the founder runs SQL by hand and
 * CLAUDE.md requires that to degrade rather than 500.
 */

const CAND = "11111111-1111-4111-8111-111111111111";

/** Which table reads should fail, and with what. */
let failing: Record<string, { code?: string; message?: string }> = {};
/** Rows a healthy table returns. */
let rows: Record<string, unknown[]> = {};

function table(name: string) {
  const result = () => {
    const err = failing[name];
    return err ? { data: null, error: err } : { data: rows[name] ?? [], error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain, eq: () => chain, is: () => chain, neq: () => chain,
    in: () => chain, order: () => chain, limit: () => chain, not: () => chain,
    maybeSingle: async () => {
      const r = result();
      return { data: r.error ? null : ((r.data as unknown[])?.[0] ?? null), error: r.error };
    },
  };
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown) => res(result());
  return chain;
}
const fakeDb = {
  from: (n: string) => table(n),
  auth: { getUser: async () => ({ data: { user: { id: CAND, email: "nurse@x.test" } }, error: null }) },
};

vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => fakeDb,
  getAnonVerifyClient: () => fakeDb,
}));
vi.mock("@/lib/rateLimit", () => ({ enforceUserRateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/admin-auth", () => ({
  // The caller under test is the CANDIDATE herself — the dashboard's own load.
  requireAdminRole: async () => ({ ok: false, error: "Forbidden", status: 403 }),
  canActOnCandidate: async () => false,
  canActOnOrg: async () => false,
  getVisibleOrgIds: async () => [],
}));

let GET: (r: never) => Promise<Response>;
beforeAll(async () => {
  ({ GET } = await import("@/app/api/portal/phase-slots/route"));
});
beforeEach(() => { failing = {}; rows = {}; });

async function get(phase = "bearbeitung") {
  const url = `https://www.borivon.com/api/portal/phase-slots?phase=${phase}`;
  const req = {
    headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? "Bearer stub-jwt" : null) },
    nextUrl: new URL(url),
    url,
  };
  const res = await GET(req as never);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe("phase-slots: 200 with an empty list means empty, and only empty", () => {
  it("really-no-slots still answers 200 with []", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.slots).toEqual([]);
  });

  it("a healthy read returns the slots", async () => {
    rows["phase_slots"] = [{ id: "s1", label: "EzB", phase: "bearbeitung", position: 0, employer_id: null }];
    const r = await get();
    expect(r.status).toBe(200);
    expect((r.body.slots as unknown[])).toHaveLength(1);
  });
});

describe("phase-slots: a failed read says so instead of blanking her boxes", () => {
  it("a failed GLOBAL slot read answers 503 READ_FAILED, never 200 []", async () => {
    failing["phase_slots"] = { code: "57014", message: "canceling statement due to statement timeout" };
    const r = await get();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe(READ_FAILED);
    expect(r.body.slots).toBeUndefined();
  });

  it("a failed SCOPE read (candidate_profiles) answers 503, not a short list", async () => {
    // Swallowing this one produced globals only — her agency's batch documents
    // silently missing, which is harder to spot than nothing at all.
    failing["candidate_profiles"] = { code: "08006", message: "connection failure" };
    const r = await get();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe(READ_FAILED);
  });

  it("a failed EMPLOYER-AGENCY read answers 503", async () => {
    rows["candidate_profiles"] = [{ employer_id: "22222222-2222-4222-8222-222222222222" }];
    failing["employers"] = { message: "fetch failed" };
    const r = await get();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe(READ_FAILED);
  });

  it("does the same on the visum phase", async () => {
    failing["phase_slots"] = { message: "fetch failed" };
    expect((await get("visum")).status).toBe(503);
  });
});

describe("phase-slots: a pending migration is NOT a failure", () => {
  it("a missing column degrades to an empty list instead of 503", async () => {
    // The founder runs SQL by hand; a not-yet-run migration must lose a nicety,
    // never the page (CLAUDE.md).
    failing["phase_slots"] = { code: "42703", message: 'column phase_slots.is_required does not exist' };
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.slots).toEqual([]);
  });

  it("a stale PostgREST schema cache degrades the same way", async () => {
    failing["phase_slots"] = { code: "PGRST204", message: "Could not find the 'category_id' column in the schema cache" };
    expect((await get()).status).toBe(200);
  });

  it("a multi-row org membership degrades rather than taking the dashboard down", async () => {
    // A candidate who self-joined two orgs makes `.maybeSingle()` answer
    // PGRST116 by design. That has always meant "no single batch org"; turning
    // it into a 503 would break her whole dashboard over a duplicate row.
    failing["candidate_organizations"] = { code: "PGRST116", message: "JSON object requested, multiple rows returned" };
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.slots).toEqual([]);
  });
});

describe("isSchemaMissing / isReadFailure — the line between the two", () => {
  it("treats every migration shape as 'not a failure'", () => {
    for (const e of [
      { code: "42703", message: "column x does not exist" },
      { code: "42P01", message: "relation y does not exist" },
      { code: "PGRST204", message: "schema cache" },
      { code: "PGRST205", message: "Could not find the table 'public.z'" },
    ]) {
      expect(isSchemaMissing(e), JSON.stringify(e)).toBe(true);
      expect(isReadFailure(e), JSON.stringify(e)).toBe(false);
    }
  });

  it("treats a timeout, a connection drop and a 5xx as real failures", () => {
    for (const e of [
      { code: "57014", message: "canceling statement due to statement timeout" },
      { code: "08006", message: "connection failure" },
      { message: "fetch failed" },
      { code: "PGRST301", message: "JWT expired" },
    ]) {
      expect(isReadFailure(e), JSON.stringify(e)).toBe(true);
    }
  });

  it("no error at all is no failure", () => {
    expect(isReadFailure(null)).toBe(false);
    expect(isReadFailure(undefined)).toBe(false);
    expect(isSchemaMissing(null)).toBe(false);
  });
});
