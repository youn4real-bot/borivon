import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

/**
 * THE BELL'S DOCUMENT LOOKUP, DRIVEN FOR REAL.
 *
 * GET /api/portal/admin/notifications/<id>/doc opened with
 * `if (auth.role !== "admin") return 403`, so the team's ONE sub-admin — the
 * person on an iPhone who actually reviews uploads — got a 403 on every tap.
 * The bell then fell through to its "just navigate to the candidate" fallback
 * and the document never opened. It read as "clicking the notification does
 * nothing", which is exactly how it was reported.
 *
 * The gate is now canActOnCandidate on the RESOLVED document, so the scope is
 * per candidate (LAW #25) rather than per role. These cases drive the actual
 * route module with the REAL lib/admin-auth, only the database mocked, so the
 * scope is genuinely exercised: a regular sub-admin gets the document, an org
 * admin gets her own org's and is refused someone else's.
 */

const SUPREME = "founder@borivon.test";
const SUB     = "helper@borivon.test";
const ORGADM  = "agency@calmaroi.test";
const CAND    = "11111111-1111-4111-8111-111111111111";
const MY_ORG  = "org-calmaroi";

/** Per-table rows the current case serves. */
let tables: Record<string, unknown[]> = {};
/** The signed-in account for the current case. */
let actor = SUPREME;

/** Chainable + thenable builder: awaiting gives the rows, maybeSingle the first. */
function qb(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "ilike", "eq", "neq", "in", "is", "not", "order", "limit", "gte", "lte"]) {
    b[m] = () => b;
  }
  b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  b.single = async () => ({ data: rows[0] ?? null, error: null });
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(res, rej);
  return b;
}

const fakeDb = {
  from: (t: string) => qb(tables[t] ?? []),
  auth: {
    getUser: async () => ({ data: { user: { id: "actor-id", email: actor, user_metadata: {} } }, error: null }),
    admin: {
      getUserById: async () => ({ data: { user: { id: CAND, email: "nurse@x.test", user_metadata: {} } }, error: null }),
      listUsers: async () => ({ data: { users: [] } }),
    },
  },
};

vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => fakeDb,
  getAnonVerifyClient: () => fakeDb,
  // The route prefers a direct auth.users query and falls back to listUsers.
  getAuthSchemaClient: () => ({ from: () => qb([{ id: CAND, email: "nurse@x.test" }]) }),
  supabase: {},
}));

let GET: (req: never, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
beforeAll(async () => {
  process.env.ADMIN_EMAIL = SUPREME;
  ({ GET } = await import("@/app/api/portal/admin/notifications/[id]/doc/route"));
});

const DOC_ROW = {
  id: "doc-1", user_id: CAND, file_name: "amina_b_pflegekraft_diplom.pdf",
  file_type: "Pflegediplom", uploaded_at: "2026-09-20T09:00:00.000Z",
  status: "pending", feedback: null, drive_file_id: null,
  r2_key: `candidates/${CAND}/amina_b_pflegekraft_diplom.pdf`, uploaded_by_admin: false,
};

beforeEach(() => {
  actor = SUPREME;
  tables = {
    admin_notifications: [{
      id: "n-1", type: "upload", user_email: "nurse@x.test",
      doc_type: "Pflegediplom", doc_name: DOC_ROW.file_name,
      created_at: "2026-09-20T09:00:01.000Z",
    }],
    documents: [DOC_ROW],
    sub_admins: [],
    organization_members: [],
    candidate_organizations: [],
  };
});

function call(id = "n-1") {
  // The route only reads req.headers.get("authorization").
  const req = { headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? "Bearer jwt" : null) } };
  return GET(req as never, { params: Promise.resolve({ id }) });
}

describe("who may open the document a notification points at", () => {
  it("the supreme admin gets it", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).doc.id).toBe("doc-1");
  });

  it("a REGULAR sub-admin gets it — this is the bug that was reported", async () => {
    // Before: 403 for everyone but the founder, so every tap by the one
    // sub-admin opened the candidate and no document.
    actor = SUB;
    tables.sub_admins = [{ email: SUB, agency_id: null, is_agency_admin: false }];
    const res = await call();
    expect(res.status, "a scoped sub-admin must be able to open her own queue's document").toBe(200);
    expect((await res.json()).doc.id).toBe("doc-1");
  });

  it("an ORG admin gets her OWN org's candidate", async () => {
    actor = ORGADM;
    tables.sub_admins = [{ email: ORGADM, agency_id: MY_ORG, is_agency_admin: true }];
    tables.organization_members = [{ org_id: MY_ORG }];
    tables.candidate_organizations = [{ org_id: MY_ORG }];
    const res = await call();
    expect(res.status).toBe(200);
  });

  it("LAW #25: an ORG admin is refused a candidate outside her org", async () => {
    actor = ORGADM;
    tables.sub_admins = [{ email: ORGADM, agency_id: MY_ORG, is_agency_admin: true }];
    tables.organization_members = [{ org_id: MY_ORG }];
    tables.candidate_organizations = []; // no approved link to this candidate
    const res = await call();
    expect(res.status, "widening the gate must not widen the scope").toBe(403);
  });

  it("the fallback lookup BY FILENAME is scoped too", async () => {
    // Rows written before the upload route persisted an email are resolved by
    // file_name across the whole table — that path must be gated as well, or
    // it becomes the way around the gate.
    actor = ORGADM;
    tables.admin_notifications = [{
      id: "n-old", type: "upload", user_email: "",
      doc_type: null, doc_name: DOC_ROW.file_name, created_at: "2026-01-01T00:00:00.000Z",
    }];
    tables.sub_admins = [{ email: ORGADM, agency_id: MY_ORG, is_agency_admin: true }];
    tables.organization_members = [{ org_id: MY_ORG }];
    tables.candidate_organizations = [];
    const res = await call("n-old");
    expect(res.status).toBe(403);
  });

  it("a candidate (no admin role at all) is still refused", async () => {
    actor = "nurse@x.test";
    tables.sub_admins = [];
    const res = await call();
    expect(res.status).toBe(403);
  });
});

describe("the row it serves is complete enough to open", () => {
  it("carries r2_key and uploaded_by_admin", async () => {
    // Without r2_key an R2-only file — every upload since the storage
    // migration — arrives as a row with no indication of where its bytes are.
    const doc = (await (await call()).json()).doc;
    expect(doc).toHaveProperty("r2_key");
    expect(doc).toHaveProperty("uploaded_by_admin");
    expect(doc.r2_key).toContain(CAND);
  });

  it("a non-upload notification is still refused with 400", async () => {
    tables.admin_notifications = [{ ...(tables.admin_notifications[0] as object), type: "signup" }];
    expect((await call()).status).toBe(400);
  });
});
