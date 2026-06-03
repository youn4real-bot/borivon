import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.ADMIN_EMAIL = "admin@borivon.com";

// Hoisted mock state — vi.mock factories are hoisted above imports, so the
// state they read must be hoisted too.
const h = vi.hoisted(() => ({
  getUser: vi.fn(),     // anon.auth.getUser(jwt)
  getUserById: vi.fn(), // service.auth.admin.getUserById(id)
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  authTables: {} as Record<string, { data: unknown; error: unknown }>, // auth-schema (getAuthSchemaClient)
}));

// Mock the Supabase clients. softDeleted is left REAL so the soft-delete gate
// is genuinely exercised end-to-end.
vi.mock("@/lib/supabase", () => {
  // Chainable + thenable query-builder stub: every builder method returns the
  // same object; awaiting it (or calling maybeSingle/single) resolves to the
  // per-table result the test configured.
  const qb = (result: { data: unknown; error: unknown }) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "ilike", "eq", "neq", "in", "is", "not", "order", "limit", "gte", "lte", "range", "contains"]) {
      b[m] = () => b;
    }
    b.maybeSingle = () => Promise.resolve(result);
    b.single = () => Promise.resolve(result);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej);
    return b;
  };
  return {
    getAnonVerifyClient: () => ({ auth: { getUser: (...a: unknown[]) => h.getUser(...a) } }),
    getServiceSupabase: () => ({
      from: (t: string) => qb(h.tables[t] ?? { data: null, error: null }),
      auth: { admin: { getUserById: (...a: unknown[]) => h.getUserById(...a) } },
    }),
    getAuthSchemaClient: () => ({
      from: (t: string) => qb(h.authTables[t] ?? { data: null, error: null }),
    }),
    supabase: {},
  };
});

import {
  ciEmail,
  requireAdminRole,
  requireUser,
  canActOnCandidate,
  getVisibleCandidateIds,
  getStaffEmailSet,
  getStaffUserIdsAmong,
  roleByUserId,
} from "../lib/admin-auth";

// Minimal NextRequest stand-in — the auth fns only read req.headers.get(...).
function mkReq(authHeader?: string) {
  return {
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "authorization" && authHeader !== undefined ? authHeader : null,
    },
  } as unknown as Parameters<typeof requireAdminRole>[0];
}

const activeUser = (email: string, id = "u-1") => ({
  data: { user: { id, email, user_metadata: {} } },
  error: null,
});

beforeEach(() => {
  h.getUser.mockReset();
  h.getUserById.mockReset();
  h.tables = {};
  h.authTables = {};
});

describe("ciEmail (ilike wildcard-injection escaping)", () => {
  it("escapes % and _ so they can't act as SQL-LIKE wildcards", () => {
    expect(ciEmail("a_b@x.com")).toBe("a\\_b@x.com");
    expect(ciEmail("50%@x.com")).toBe("50\\%@x.com");
    expect(ciEmail("a\\b@x.com")).toBe("a\\\\b@x.com");
  });
  it("leaves a normal email unchanged", () => {
    expect(ciEmail("first.last@example.com")).toBe("first.last@example.com");
  });
});

describe("requireAdminRole", () => {
  it("401 when no bearer token is present", async () => {
    expect(await requireAdminRole(mkReq())).toMatchObject({ ok: false, status: 401 });
  });
  it("401 when the header is not a Bearer token", async () => {
    expect(await requireAdminRole(mkReq("Basic abc"))).toMatchObject({ ok: false, status: 401 });
  });
  it("401 when the JWT fails verification", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    expect(await requireAdminRole(mkReq("Bearer x"))).toMatchObject({ ok: false, status: 401 });
  });
  it("401 'Account disabled' for a soft-deleted user holding a still-valid token", async () => {
    h.getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "ghost@x.com", user_metadata: { deleted: true } } },
      error: null,
    });
    expect(await requireAdminRole(mkReq("Bearer x"))).toMatchObject({
      ok: false,
      status: 401,
      error: "Account disabled",
    });
  });
  it("grants admin for the ADMIN_EMAIL account (no sub_admins lookup)", async () => {
    h.getUser.mockResolvedValue(activeUser("admin@borivon.com", "admin-id"));
    expect(await requireAdminRole(mkReq("Bearer x"))).toMatchObject({
      ok: true,
      role: "admin",
      userId: "admin-id",
    });
  });
  it("grants sub_admin for an email present in sub_admins", async () => {
    h.getUser.mockResolvedValue(activeUser("agent@org.com", "agent-id"));
    h.tables.sub_admins = {
      data: [{ email: "agent@org.com", agency_id: "ag1", is_agency_admin: true }],
      error: null,
    };
    expect(await requireAdminRole(mkReq("Bearer x"))).toMatchObject({
      ok: true,
      role: "sub_admin",
      isAgencyAdmin: true,
      agencyId: "ag1",
    });
  });
  it("403 for an authenticated user who is neither admin nor sub_admin", async () => {
    h.getUser.mockResolvedValue(activeUser("candidate@x.com"));
    h.tables.sub_admins = { data: [], error: null };
    expect(await requireAdminRole(mkReq("Bearer x"))).toMatchObject({ ok: false, status: 403 });
  });
});

describe("requireUser", () => {
  it("401 without a token", async () => {
    expect(await requireUser(mkReq())).toMatchObject({ ok: false, status: 401 });
  });
  it("401 for a soft-deleted (future-banned) account", async () => {
    h.getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y.com", banned_until: new Date(Date.now() + 1e7).toISOString() } },
      error: null,
    });
    expect(await requireUser(mkReq("Bearer x"))).toMatchObject({ ok: false, status: 401 });
  });
  it("returns the user with a lowercased email on success", async () => {
    h.getUser.mockResolvedValue(activeUser("MixedCase@X.com", "uX"));
    expect(await requireUser(mkReq("Bearer x"))).toMatchObject({
      ok: true,
      userId: "uX",
      email: "mixedcase@x.com",
    });
  });
});

describe("canActOnCandidate (LAW #25 visibility)", () => {
  it("supreme admin can act on anyone (no DB lookup)", async () => {
    expect(await canActOnCandidate("admin", "admin@borivon.com", "cand-1")).toBe(true);
  });
  it("denies when candidateUserId is empty", async () => {
    expect(await canActOnCandidate("sub_admin", "a@x.com", "")).toBe(false);
  });
  it("FAILS CLOSED when the sub_admins lookup errors", async () => {
    h.tables.sub_admins = { data: null, error: { message: "db blip" } };
    expect(await canActOnCandidate("sub_admin", "a@x.com", "cand-1")).toBe(false);
  });
  it("regular sub-admin (not agency admin) can act on every candidate", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: false }], error: null };
    expect(await canActOnCandidate("sub_admin", "a@x.com", "cand-1")).toBe(true);
  });
  it("org admin CAN act on a candidate linked to their org", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: true }], error: null };
    h.tables.organization_members = { data: [{ org_id: "o1" }], error: null };
    h.tables.candidate_organizations = { data: { org_id: "o1" }, error: null };
    expect(await canActOnCandidate("sub_admin", "a@x.com", "cand-1")).toBe(true);
  });
  it("org admin CANNOT act on a candidate NOT linked to their org", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: true }], error: null };
    h.tables.organization_members = { data: [{ org_id: "o1" }], error: null };
    h.tables.candidate_organizations = { data: null, error: null };
    expect(await canActOnCandidate("sub_admin", "a@x.com", "cand-1")).toBe(false);
  });
  it("org admin with no orgs is denied", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: true }], error: null };
    h.tables.organization_members = { data: [], error: null };
    expect(await canActOnCandidate("sub_admin", "a@x.com", "cand-1")).toBe(false);
  });
  it("a sub-admin who BELONGS to an org is scoped even with is_agency_admin=false (no leak window)", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: false }], error: null };
    h.tables.organization_members = { data: [{ org_id: "o1" }], error: null };
    h.tables.candidate_organizations = { data: null, error: null }; // candidate NOT linked
    expect(await canActOnCandidate("sub_admin", "a@x.com", "cand-1")).toBe(false);
  });
  it("FAILS CLOSED when the organization_members lookup errors", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: true }], error: null };
    h.tables.organization_members = { data: null, error: { message: "blip" } };
    expect(await canActOnCandidate("sub_admin", "a@x.com", "cand-1")).toBe(false);
  });
});

describe("getVisibleCandidateIds (LAW #25)", () => {
  it("FAILS CLOSED to [] on a sub_admins lookup error", async () => {
    h.tables.sub_admins = { data: null, error: { message: "blip" } };
    expect(await getVisibleCandidateIds("a@x.com")).toEqual([]);
  });
  it("regular sub-admin → null (no filter, sees all)", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: false }], error: null };
    expect(await getVisibleCandidateIds("a@x.com")).toBeNull();
  });
  it("org admin with no orgs → []", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: true }], error: null };
    h.tables.organization_members = { data: [], error: null };
    expect(await getVisibleCandidateIds("a@x.com")).toEqual([]);
  });
  it("org admin → deduped list of their org's approved candidates", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: true }], error: null };
    h.tables.organization_members = { data: [{ org_id: "o1" }], error: null };
    h.tables.candidate_organizations = {
      data: [{ candidate_user_id: "c1" }, { candidate_user_id: "c2" }, { candidate_user_id: "c1" }],
      error: null,
    };
    const ids = await getVisibleCandidateIds("a@x.com");
    expect(new Set(ids)).toEqual(new Set(["c1", "c2"]));
    expect(ids).toHaveLength(2);
  });
  it("a sub-admin who BELONGS to an org is scoped even with is_agency_admin=false", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: false }], error: null };
    h.tables.organization_members = { data: [{ org_id: "o1" }], error: null };
    h.tables.candidate_organizations = { data: [{ candidate_user_id: "c1" }], error: null };
    expect(await getVisibleCandidateIds("a@x.com")).toEqual(["c1"]);
  });
  it("FAILS CLOSED to [] on an organization_members lookup error", async () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: false }], error: null };
    h.tables.organization_members = { data: null, error: { message: "blip" } };
    expect(await getVisibleCandidateIds("a@x.com")).toEqual([]);
  });
});

describe("getStaffEmailSet (candidates-only filtering)", () => {
  it("includes the supreme admin + every sub-admin + every org member, all lowercased", async () => {
    h.tables.sub_admins = { data: [{ email: "Sub@Org.com" }, { email: "hq@borivon.com" }], error: null };
    h.tables.organization_members = { data: [{ sub_admin_email: "Member@Org.com" }], error: null };
    const set = await getStaffEmailSet();
    expect(set.has("admin@borivon.com")).toBe(true);  // ADMIN_EMAIL
    expect(set.has("sub@org.com")).toBe(true);
    expect(set.has("hq@borivon.com")).toBe(true);
    expect(set.has("member@org.com")).toBe(true);
    expect(set.has("a-real-candidate@x.com")).toBe(false);
  });
  it("skips blank / null email rows", async () => {
    h.tables.sub_admins = { data: [{ email: "" }, { email: null }], error: null };
    h.tables.organization_members = { data: [{ sub_admin_email: null }], error: null };
    const set = await getStaffEmailSet();
    expect(set.has("")).toBe(false);
    expect(set.has("admin@borivon.com")).toBe(true); // admin still present
  });
});

describe("getStaffUserIdsAmong (strip staff from a candidate list)", () => {
  it("empty input → empty set (no DB hit)", async () => {
    expect((await getStaffUserIdsAmong([])).size).toBe(0);
  });
  it("returns only the ids whose email is a staff email", async () => {
    h.tables.sub_admins = { data: [{ email: "sub@org.com" }], error: null };
    h.tables.organization_members = { data: [], error: null };
    h.authTables.users = {
      data: [
        { id: "u1", email: "sub@org.com" },          // sub-admin → staff
        { id: "u2", email: "real@candidate.com" },   // real candidate → kept
        { id: "u3", email: "ADMIN@borivon.com" },    // supreme admin (mixed case) → staff
      ],
      error: null,
    };
    const staff = await getStaffUserIdsAmong(["u1", "u2", "u3"]);
    expect(staff.has("u1")).toBe(true);
    expect(staff.has("u3")).toBe(true);
    expect(staff.has("u2")).toBe(false);
    expect(staff.size).toBe(2);
  });
});

describe("roleByUserId (download-token path)", () => {
  it("401 for an empty id", async () => {
    expect(await roleByUserId("")).toMatchObject({ ok: false, status: 401 });
  });
  it("401 when the user does not exist", async () => {
    h.getUserById.mockResolvedValue({ data: { user: null }, error: null });
    expect(await roleByUserId("missing")).toMatchObject({ ok: false, status: 401 });
  });
  it("401 for a soft-deleted account", async () => {
    h.getUserById.mockResolvedValue({
      data: { user: { id: "u1", email: "deleted+abc@borivon.invalid" } },
      error: null,
    });
    expect(await roleByUserId("u1")).toMatchObject({ ok: false, status: 401 });
  });
  it("resolves admin for the ADMIN_EMAIL account", async () => {
    h.getUserById.mockResolvedValue({
      data: { user: { id: "a", email: "admin@borivon.com", user_metadata: {} } },
      error: null,
    });
    expect(await roleByUserId("a")).toMatchObject({ ok: true, role: "admin" });
  });
});
