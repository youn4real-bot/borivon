import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.ADMIN_EMAIL = "admin@borivon.com";

// Hoisted mock state (vi.mock factories hoist above imports).
const h = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  signDlToken: vi.fn((..._a: unknown[]) => "signed-token"),
}));

// Chainable + thenable Supabase stub, keyed by table name. canActOnCandidate is
// left REAL so the LAW #25 gate is genuinely exercised through the tool layer.
vi.mock("@/lib/supabase", () => {
  const qb = (result: { data: unknown; error: unknown }) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "or", "ilike", "eq", "neq", "in", "is", "not", "order", "limit", "gte", "lte", "range", "contains"]) {
      b[m] = () => b;
    }
    b.maybeSingle = () => Promise.resolve(result);
    b.single = () => Promise.resolve(result);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return b;
  };
  return {
    getServiceSupabase: () => ({ from: (t: string) => qb(h.tables[t] ?? { data: null, error: null }) }),
    getAnonVerifyClient: () => ({ auth: { getUser: vi.fn() } }),
  };
});

vi.mock("@/lib/dlToken", () => ({
  signDlToken: (...a: unknown[]) => h.signDlToken(...a),
  DL_TOKEN_PARAM: "dlt",
  verifyDlToken: () => null,
  dlTokenUserId: () => null,
}));

import { buildAssistantTools } from "../lib/assistantTools";
import type { AssistantScope } from "../lib/assistantScope";

const ORG_ADMIN: AssistantScope = {
  role: "sub_admin",
  email: "agency@org.com",
  userId: "agent-id",
  visibleIds: ["allowed-cand"],
  inScope: (id) => id === "allowed-cand",
};
const SUPREME: AssistantScope = {
  role: "admin",
  email: "admin@borivon.com",
  userId: "admin-id",
  visibleIds: null,
  inScope: () => true,
};

type Tools = ReturnType<typeof buildAssistantTools>;
const run = (tools: Tools, name: keyof Tools, input: unknown): Promise<unknown> =>
  (tools[name] as unknown as { execute: (i: unknown, o: unknown) => Promise<unknown> })
    .execute(input, { toolCallId: "t", messages: [] });

beforeEach(() => {
  h.tables = {};
  h.signDlToken.mockClear();
});

describe("assistant tools enforce LAW #25 scope (org-admin)", () => {
  // Foreign candidate = NOT linked to the org → candidate_organizations returns null.
  const foreignOrgMocks = () => {
    h.tables.sub_admins = { data: [{ is_agency_admin: true }], error: null };
    h.tables.organization_members = { data: [{ org_id: "o1" }], error: null };
    h.tables.candidate_organizations = { data: null, error: null };
  };

  it("getCandidateById → out_of_scope for a candidate outside the org (no profile leaked)", async () => {
    foreignOrgMocks();
    const r = await run(buildAssistantTools(ORG_ADMIN), "getCandidateById", { candidateUserId: "foreign-cand" });
    expect(r).toEqual({ error: "out_of_scope" });
  });

  it("listCandidateCVs → out_of_scope for a foreign candidate", async () => {
    foreignOrgMocks();
    const r = await run(buildAssistantTools(ORG_ADMIN), "listCandidateCVs", { candidateUserId: "foreign-cand" });
    expect(r).toEqual({ error: "out_of_scope" });
  });

  it("getDocumentDownloadLink → out_of_scope AND mints NO token for a foreign candidate's doc", async () => {
    h.tables.documents = { data: { id: "doc1", user_id: "foreign-cand", file_name: "cv.pdf", drive_file_id: "drive1" }, error: null };
    foreignOrgMocks();
    const r = await run(buildAssistantTools(ORG_ADMIN), "getDocumentDownloadLink", { docId: "doc1" });
    expect(r).toEqual({ error: "out_of_scope" });
    expect(h.signDlToken).not.toHaveBeenCalled();
  });

  it("searchCandidates drops candidates outside scope.inScope even if the query returns them", async () => {
    h.tables.candidate_profiles = {
      data: [
        { user_id: "allowed-cand", first_name: "Allowed", last_name: "One" },
        { user_id: "foreign-cand", first_name: "Foreign", last_name: "Two" },
      ],
      error: null,
    };
    const r = (await run(buildAssistantTools(ORG_ADMIN), "searchCandidates", { query: "o", limit: 10 })) as {
      candidates: { candidateUserId: string }[];
    };
    expect(r.candidates.map((c) => c.candidateUserId)).toEqual(["allowed-cand"]);
  });
});

describe("assistant tools allow the supreme admin", () => {
  it("getDocumentDownloadLink mints a 3-minute link (admin token) for any candidate", async () => {
    h.tables.documents = { data: { id: "doc1", user_id: "any-cand", file_name: "cv.pdf", drive_file_id: "drive1" }, error: null };
    const r = (await run(buildAssistantTools(SUPREME), "getDocumentDownloadLink", { docId: "doc1" })) as {
      url: string;
      expiresInSec: number;
    };
    expect(h.signDlToken).toHaveBeenCalledWith("admin-id", 180);
    expect(r.expiresInSec).toBe(180);
    expect(r.url).toContain("/api/portal/file?id=drive1");
    expect(r.url).toContain("dlt=");
    expect(r.url).toContain("dl=1");
  });

  it("getCandidateById returns the profile summary for the supreme admin", async () => {
    h.tables.candidate_profiles = {
      data: { user_id: "any-cand", first_name: "Any", last_name: "Body", b2_exam_date: "2026-09-01", passport_expiry: null, passport_status: null },
      error: null,
    };
    const r = (await run(buildAssistantTools(SUPREME), "getCandidateById", { candidateUserId: "any-cand" })) as {
      candidate: { name: string; b2ExamDate: string };
    };
    expect(r.candidate.name).toBe("Any Body");
    expect(r.candidate.b2ExamDate).toBe("2026-09-01");
  });
});
