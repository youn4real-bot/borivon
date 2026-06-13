import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.ADMIN_EMAIL = "admin@borivon.com";

// Hoisted mock state (vi.mock factories hoist above imports).
const h = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  authUsers: [] as Array<{ id: string; email: string; user_metadata?: Record<string, unknown> }>,
  signDlToken: vi.fn((..._a: unknown[]) => "signed-token"),
}));

// Chainable + thenable Supabase stub, keyed by table name. canActOnCandidate is
// left REAL so the LAW #25 gate is genuinely exercised through the tool layer.
vi.mock("@/lib/supabase", () => {
  const qb = (result: { data: unknown; error: unknown }) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "or", "ilike", "eq", "neq", "in", "is", "not", "order", "limit", "gte", "lte", "range", "contains", "insert", "update", "upsert", "delete"]) {
      b[m] = () => b;
    }
    b.maybeSingle = () => Promise.resolve(result);
    b.single = () => Promise.resolve(result);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return b;
  };
  return {
    getServiceSupabase: () => ({
      from: (t: string) => qb(h.tables[t] ?? { data: null, error: null }),
      auth: {
        admin: {
          listUsers: async ({ page }: { page: number; perPage: number }) =>
            ({ data: { users: page === 1 ? h.authUsers : [] }, error: null }),
          getUserById: async (id: string) =>
            ({ data: { user: h.authUsers.find((u) => u.id === id) ?? null }, error: null }),
        },
      },
    }),
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
  h.authUsers = [];
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

  it("searchCandidates drops candidates outside scope.inScope even if the roster returns them", async () => {
    h.tables.candidate_profiles = {
      data: [
        { user_id: "allowed-cand", first_name: "Allowed", last_name: "One" },
        { user_id: "foreign-cand", first_name: "Foreign", last_name: "Two" },
      ],
      error: null,
    };
    h.authUsers = [
      { id: "allowed-cand", email: "allowed@x.com", user_metadata: { full_name: "Allowed One" } },
      { id: "foreign-cand", email: "foreign@x.com", user_metadata: { full_name: "Foreign Two" } },
    ];
    const r = (await run(buildAssistantTools(ORG_ADMIN), "searchCandidates", { query: "o", limit: 10 })) as {
      candidates: { candidateUserId: string }[];
    };
    expect(r.candidates.map((c) => c.candidateUserId)).toEqual(["allowed-cand"]);
  });

  it("saveReminder → out_of_scope when tied to a candidate outside the org", async () => {
    foreignOrgMocks();
    const r = await run(buildAssistantTools(ORG_ADMIN), "saveReminder", { text: "chase passport", candidateUserId: "foreign-cand" });
    expect(r).toEqual({ error: "out_of_scope" });
  });

  it("setInterviewResult → admin_only for a sub-admin (status writes are supreme-only)", async () => {
    const r = await run(buildAssistantTools(ORG_ADMIN), "setInterviewResult", { candidateUserId: "allowed-cand", which: 1, result: "failed" });
    expect(r).toEqual({ error: "admin_only" });
  });

  it("sendCandidateMessage → admin_only for a sub-admin (writes are supreme-only)", async () => {
    const r = await run(buildAssistantTools(ORG_ADMIN), "sendCandidateMessage", { candidateUserId: "allowed-cand", text: "hi" });
    expect(r).toEqual({ error: "admin_only" });
  });

  it("createLead → admin_only for a sub-admin", async () => {
    const r = await run(buildAssistantTools(ORG_ADMIN), "createLead", { name: "Sara Alami" });
    expect(r).toEqual({ error: "admin_only" });
  });

  it("storeCandidateDocument → admin_only for a sub-admin", async () => {
    const tools = buildAssistantTools(ORG_ADMIN, { r2Key: "k", mime: "image/jpeg", fileName: "p.jpg", sha256: "abc" });
    const r = await run(tools, "storeCandidateDocument", { candidateUserId: "allowed-cand", docKey: "id" });
    expect(r).toEqual({ error: "admin_only" });
  });

  it("createCandidateInviteLink → admin_only for a sub-admin", async () => {
    const r = await run(buildAssistantTools(ORG_ADMIN), "createCandidateInviteLink", {});
    expect(r).toEqual({ error: "admin_only" });
  });

  it("getCandidatePipeline → out_of_scope for a candidate outside the org", async () => {
    foreignOrgMocks();
    const r = await run(buildAssistantTools(ORG_ADMIN), "getCandidatePipeline", { candidateUserId: "foreign-cand" });
    expect(r).toEqual({ error: "out_of_scope" });
  });

  it("setAnerkennungStage / setNurseProfile / sendFollowUpNudge / manageJourneyItem → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "setAnerkennungStage", { candidateUserId: "allowed-cand", stage: "submitted" })).toEqual({ error: "admin_only" });
    expect(await run(t, "setNurseProfile", { candidateUserId: "allowed-cand", specialty: "intensive" })).toEqual({ error: "admin_only" });
    expect(await run(t, "sendFollowUpNudge", { candidateUserId: "allowed-cand" })).toEqual({ error: "admin_only" });
    expect(await run(t, "manageJourneyItem", { candidateUserId: "allowed-cand", op: "add", text: "Send passport" })).toEqual({ error: "admin_only" });
  });

  it("Batch 2 document tools → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "reviewDocument", { docId: "doc1", status: "approved" })).toEqual({ error: "admin_only" });
    expect(await run(t, "setPassportDataStatus", { candidateUserId: "allowed-cand", status: "approved" })).toEqual({ error: "admin_only" });
    expect(await run(t, "editCandidateProfileField", { candidateUserId: "allowed-cand", field: "first_name", value: "X" })).toEqual({ error: "admin_only" });
    expect(await run(t, "rotateDocument", { docId: "doc1", deltaRotation: 90 })).toEqual({ error: "admin_only" });
  });

  it("Batch 3 CV write tools → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "editCvDraft", { candidateUserId: "allowed-cand", field: "hobbies", value: "Reading" })).toEqual({ error: "admin_only" });
    expect(await run(t, "setCvBrandingMode", { candidateUserId: "allowed-cand", mode: "agency" })).toEqual({ error: "admin_only" });
    expect(await run(t, "generateAndPublishCv", { candidateUserId: "allowed-cand" })).toEqual({ error: "admin_only" });
  });

  it("listLeads → admin_only for a sub-admin", async () => {
    expect(await run(buildAssistantTools(ORG_ADMIN), "listLeads", {})).toEqual({ error: "admin_only" });
  });

  it("assignEmployer / listOrganizations / upsertEmployer → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "assignEmployer", { candidateUserId: "allowed-cand", employerId: "" })).toEqual({ error: "admin_only" });
    expect(await run(t, "listOrganizations", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "upsertEmployer", { name: "Test Klinik", address: "Str 1" })).toEqual({ error: "admin_only" });
    expect(await run(t, "linkCandidateToOrg", { candidateUserId: "allowed-cand", orgId: "11111111-1111-1111-1111-111111111111", op: "link" })).toEqual({ error: "admin_only" });
  });

  it("listStuckCandidates / nudgeStuckCandidates → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "listStuckCandidates", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "nudgeStuckCandidates", {})).toEqual({ error: "admin_only" });
  });

  it("readCvDraft → out_of_scope for a candidate outside the org", async () => {
    foreignOrgMocks();
    const r = await run(buildAssistantTools(ORG_ADMIN), "readCvDraft", { candidateUserId: "foreign-cand" });
    expect(r).toEqual({ error: "out_of_scope" });
  });

  it("listAutomations / setAutomation → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "listAutomations", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "setAutomation", { key: "weekly_report", enabled: false })).toEqual({ error: "admin_only" });
  });

  it("sendExternalEmail → admin_only for a sub-admin", async () => {
    const r = await run(buildAssistantTools(ORG_ADMIN), "sendExternalEmail", { to: "anna@klinik.de", subject: "Profiles", body: "Hi" });
    expect(r).toEqual({ error: "admin_only" });
  });

  it("getAgencyProfile / setAgencyProfile → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "getAgencyProfile", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "setAgencyProfile", { firma: "Borivon GmbH" })).toEqual({ error: "admin_only" });
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

  it("searchCandidates finds a candidate by their ACCOUNT name when the profile name is empty", async () => {
    h.tables.candidate_profiles = { data: [{ user_id: "c1", first_name: null, last_name: null }], error: null };
    h.authUsers = [{ id: "c1", email: "youssef@x.com", user_metadata: { full_name: "Youssef El Amrani" } }];
    const r = (await run(buildAssistantTools(SUPREME), "searchCandidates", { query: "amrani" })) as {
      candidates: { candidateUserId: string; name: string }[];
    };
    expect(r.candidates).toEqual([{ candidateUserId: "c1", name: "Youssef El Amrani" }]);
  });

  it("listAllCandidates returns the whole roster alphabetically by account name", async () => {
    h.tables.candidate_profiles = {
      data: [
        { user_id: "c2", first_name: null, last_name: null },
        { user_id: "c1", first_name: "Sara", last_name: "Alami" },
      ],
      error: null,
    };
    h.authUsers = [
      { id: "c1", email: "sara@x.com", user_metadata: { full_name: "Sara Alami" } },
      { id: "c2", email: "bilal@x.com", user_metadata: { full_name: "Bilal Nour" } },
    ];
    const r = (await run(buildAssistantTools(SUPREME), "listAllCandidates", {})) as {
      total: number; candidates: { name: string }[];
    };
    expect(r.total).toBe(2);
    expect(r.candidates.map((c) => c.name)).toEqual(["Bilal Nour", "Sara Alami"]);
  });

  it("saveReminder stores the admin's own task", async () => {
    h.tables.assistant_reminders = { data: { id: "r1" }, error: null };
    const r = await run(buildAssistantTools(SUPREME), "saveReminder", { text: "call the embassy Monday" });
    expect(r).toEqual({ saved: true, reminderId: "r1" });
  });

  it("setInterviewResult STAGES a confirm-first write (does not apply immediately)", async () => {
    h.tables.candidate_profiles = { data: { first_name: "Sara", last_name: "Alami" }, error: null };
    const r = (await run(buildAssistantTools(SUPREME), "setInterviewResult", { candidateUserId: "any-cand", which: 1, result: "failed" })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("Sara Alami");
    expect(r.summary).toContain("FAILED");
  });

  it("sendCandidateMessage STAGES an in-app message (confirm-first) for the supreme admin", async () => {
    h.tables.candidate_profiles = { data: { first_name: "Hajar", last_name: "Bousfiha" }, error: null };
    const r = (await run(buildAssistantTools(SUPREME), "sendCandidateMessage", { candidateUserId: "any-cand", text: "Please re-upload your CV in French." })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("Hajar Bousfiha");
    expect(r.summary).toContain("re-upload");
  });

  it("createLead STAGES a new lead (confirm-first) for the supreme admin", async () => {
    const r = (await run(buildAssistantTools(SUPREME), "createLead", { name: "Sara Alami", phone: "+212600112233", cohort: "June 2027" })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("Sara Alami");
    expect(r.summary).toContain("June 2027");
  });

  it("storeCandidateDocument → no_file when no file is attached", async () => {
    const r = await run(buildAssistantTools(SUPREME), "storeCandidateDocument", { candidateUserId: "any-cand", docKey: "id" });
    expect(r).toEqual({ error: "no_file" });
  });

  it("storeCandidateDocument STAGES a passport store (confirm-first) for the supreme admin", async () => {
    h.tables.candidate_profiles = { data: { first_name: "Soufiane", last_name: "Jalal" }, error: null };
    const tools = buildAssistantTools(SUPREME, { r2Key: "chat-uploads/x/y.jpg", mime: "image/jpeg", fileName: "passport.jpg", sha256: "abc123" });
    const r = (await run(tools, "storeCandidateDocument", { candidateUserId: "any-cand", docKey: "id" })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("Soufiane Jalal");
    expect(r.summary).toContain("passport.jpg");
  });

  it("createCandidateInviteLink mints a single-use /join/candidate link for the supreme admin", async () => {
    const r = (await run(buildAssistantTools(SUPREME), "createCandidateInviteLink", {})) as { url?: string; code?: string };
    expect(r.url).toMatch(/\/join\/candidate\/[a-f0-9]+$/);
    expect(typeof r.code).toBe("string");
    expect((r.code ?? "").length).toBeGreaterThan(16);
  });

  it("getCandidatePipeline returns the candidate's pipeline row for the supreme admin", async () => {
    h.tables.candidate_pipeline = { data: { user_id: "any-cand", visa_granted: true, interview1_status: "passed" }, error: null };
    const r = (await run(buildAssistantTools(SUPREME), "getCandidatePipeline", { candidateUserId: "any-cand" })) as { pipeline?: Record<string, unknown> };
    expect(r.pipeline?.visa_granted).toBe(true);
  });

  it("setAnerkennungStage STAGES a recognition-stage change for the supreme admin", async () => {
    const r = (await run(buildAssistantTools(SUPREME), "setAnerkennungStage", { candidateUserId: "any-cand", stage: "recognized" })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("recognized");
  });

  it("setNurseProfile STAGES facts, and returns nothing_to_change when no field is given", async () => {
    const staged = (await run(buildAssistantTools(SUPREME), "setNurseProfile", { candidateUserId: "any-cand", specialty: "intensive", yearsExperience: "5" })) as { staged?: boolean; summary?: string };
    expect(staged.staged).toBe(true);
    expect(staged.summary).toContain("intensive");
    const empty = await run(buildAssistantTools(SUPREME), "setNurseProfile", { candidateUserId: "any-cand" });
    expect(empty).toEqual({ error: "nothing_to_change" });
  });

  it("sendFollowUpNudge STAGES a bell nudge for the supreme admin", async () => {
    const r = (await run(buildAssistantTools(SUPREME), "sendFollowUpNudge", { candidateUserId: "any-cand", message: "Please upload your passport" })) as { staged?: boolean };
    expect(r.staged).toBe(true);
  });

  it("manageJourneyItem stages an add, and requires an id for toggle", async () => {
    const add = (await run(buildAssistantTools(SUPREME), "manageJourneyItem", { candidateUserId: "any-cand", op: "add", text: "Book visa appointment", owner: "candidate" })) as { staged?: boolean; summary?: string };
    expect(add.staged).toBe(true);
    expect(add.summary).toContain("Book visa appointment");
    const noId = await run(buildAssistantTools(SUPREME), "manageJourneyItem", { candidateUserId: "any-cand", op: "toggle", done: true });
    expect(noId).toEqual({ error: "id_required" });
  });

  it("reviewDocument stages an approval, and refuses a reasonless rejection", async () => {
    h.tables.documents = { data: { user_id: "any-cand", file_name: "passport.pdf", file_type: "Reisepass" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "reviewDocument", { docId: "doc1", status: "approved" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("APPROVE");
    const noReason = await run(buildAssistantTools(SUPREME), "reviewDocument", { docId: "doc1", status: "rejected" });
    expect(noReason).toEqual({ error: "reject_needs_reason" });
  });

  it("setPassportDataStatus stages, and requires a reason to reject", async () => {
    const ok = (await run(buildAssistantTools(SUPREME), "setPassportDataStatus", { candidateUserId: "any-cand", status: "approved" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("passport DATA");
    const noReason = await run(buildAssistantTools(SUPREME), "setPassportDataStatus", { candidateUserId: "any-cand", status: "rejected" });
    expect(noReason).toEqual({ error: "reject_needs_reason" });
  });

  it("editCandidateProfileField stages a field edit for the supreme admin", async () => {
    const r = (await run(buildAssistantTools(SUPREME), "editCandidateProfileField", { candidateUserId: "any-cand", field: "passport_no", value: "AB123456" })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("passport_no");
  });

  it("rotateDocument stages a 90° rotation, and rejects non-multiples of 90", async () => {
    h.tables.documents = { data: { user_id: "any-cand", file_name: "diploma.pdf" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "rotateDocument", { docId: "doc1", deltaRotation: 90 })) as { staged?: boolean };
    expect(ok.staged).toBe(true);
    const bad = await run(buildAssistantTools(SUPREME), "rotateDocument", { docId: "doc1", deltaRotation: 45 });
    expect(bad).toEqual({ error: "bad_rotation" });
  });

  it("readCvDraft returns the CV draft for the supreme admin", async () => {
    h.tables.candidate_profiles = { data: { cv_draft: { firstName: "Hajar", hobbies: "Lesen" } }, error: null };
    const r = (await run(buildAssistantTools(SUPREME), "readCvDraft", { candidateUserId: "any-cand" })) as { hasCv?: boolean; draft?: Record<string, unknown> };
    expect(r.hasCv).toBe(true);
    expect(r.draft?.firstName).toBe("Hajar");
  });

  it("editCvDraft + setCvBrandingMode stage for the supreme admin", async () => {
    const edit = (await run(buildAssistantTools(SUPREME), "editCvDraft", { candidateUserId: "any-cand", field: "driverLicense", value: "B" })) as { staged?: boolean; summary?: string };
    expect(edit.staged).toBe(true);
    expect(edit.summary).toContain("driverLicense");
    const brand = (await run(buildAssistantTools(SUPREME), "setCvBrandingMode", { candidateUserId: "any-cand", mode: "agency" })) as { staged?: boolean; summary?: string };
    expect(brand.staged).toBe(true);
    expect(brand.summary).toContain("agency");
  });

  it("generateAndPublishCv stages a CV publish for the supreme admin", async () => {
    const r = (await run(buildAssistantTools(SUPREME), "generateAndPublishCv", { candidateUserId: "any-cand" })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("Lebenslauf");
  });

  it("Batch 6a reads return data for the supreme admin", async () => {
    h.tables.leads = { data: [{ id: "l1", kind: "person", name: "Sara Alami" }], error: null };
    const leads = (await run(buildAssistantTools(SUPREME), "listLeads", {})) as { leads?: { name: string }[] };
    expect(leads.leads?.[0]?.name).toBe("Sara Alami");

    h.tables.candidate_profiles = { data: { phone: "+212600112233" }, error: null };
    const phone = (await run(buildAssistantTools(SUPREME), "getCandidatePhone", { candidateUserId: "any-cand" })) as { phone?: string; wa?: string };
    expect(phone.phone).toBe("+212600112233");
    expect(phone.wa).toContain("wa.me/212600112233");

    h.tables.candidate_profiles = { data: [], error: null }; // empty roster → empty results
    const pass = (await run(buildAssistantTools(SUPREME), "listExpiringPassports", { withinDays: 90 })) as { passports?: unknown[] };
    expect(Array.isArray(pass.passports)).toBe(true);
    const b2 = (await run(buildAssistantTools(SUPREME), "getB2Overview", {})) as { candidates?: unknown[] };
    expect(Array.isArray(b2.candidates)).toBe(true);
    const board = (await run(buildAssistantTools(SUPREME), "getPipelineBoard", {})) as { board?: unknown[] };
    expect(Array.isArray(board.board)).toBe(true);
    const tasks = (await run(buildAssistantTools(SUPREME), "listAssignedTasks", { onlyOpen: true })) as { candidates?: unknown[] };
    expect(Array.isArray(tasks.candidates)).toBe(true);
  });

  it("Batch 6b inbox tools work for the supreme admin", async () => {
    h.tables.messages = { data: [{ id: "m1", thread_user_id: "any-cand", sender_role: "candidate", body: "Hello, when is my interview?", kind: "message", has_attachment: false, read_by_admin: false, created_at: "2026-06-12T10:00:00Z" }], error: null };
    const convos = (await run(buildAssistantTools(SUPREME), "listConversations", {})) as { conversations?: { candidateUserId: string; unread: number }[] };
    expect(convos.conversations?.[0]?.candidateUserId).toBe("any-cand");
    expect(convos.conversations?.[0]?.unread).toBe(1);
    const thread = (await run(buildAssistantTools(SUPREME), "getCandidateThread", { candidateUserId: "any-cand" })) as { messages?: unknown[] };
    expect(Array.isArray(thread.messages)).toBe(true);
    const mark = (await run(buildAssistantTools(SUPREME), "markThreadRead", { candidateUserId: "any-cand" })) as { ok?: boolean };
    expect(mark.ok).toBe(true);
  });

  it("Batch 4a employer tools work for the supreme admin", async () => {
    h.tables.employers = { data: [{ id: "e1", name: "UKSH Kiel", slug: "uksh", agency_id: "ag1" }], error: null };
    const emps = (await run(buildAssistantTools(SUPREME), "listEmployers", {})) as { employers?: { id: string; name: string }[] };
    expect(emps.employers?.[0]?.name).toBe("UKSH Kiel");

    // assignEmployer with a valid active employer stages
    h.tables.employers = { data: { name: "UKSH Kiel", active: true }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "assignEmployer", { candidateUserId: "any-cand", employerId: "e1" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("UKSH Kiel");

    // clearing ('') stages without an employer lookup
    const cleared = (await run(buildAssistantTools(SUPREME), "assignEmployer", { candidateUserId: "any-cand", employerId: "" })) as { staged?: boolean; summary?: string };
    expect(cleared.staged).toBe(true);
    expect(cleared.summary).toContain("cleared");

    // upsertEmployer: create stages; missing name/address rejected
    const create = (await run(buildAssistantTools(SUPREME), "upsertEmployer", { name: "UKSH Kiel", address: "Arnold-Heller-Str. 3\n24105 Kiel" })) as { staged?: boolean; summary?: string };
    expect(create.staged).toBe(true);
    expect(create.summary).toContain("UKSH Kiel");
    expect(await run(buildAssistantTools(SUPREME), "upsertEmployer", { name: "No Address Klinik" })).toEqual({ error: "address_required" });
  });

  it("auto-chase: listStuckCandidates returns the set; nudgeStuckCandidates needs someone stuck", async () => {
    h.tables.candidate_profiles = { data: [], error: null }; // no candidates → nobody stuck
    const list = (await run(buildAssistantTools(SUPREME), "listStuckCandidates", {})) as { count?: number; candidates?: unknown[] };
    expect(list.count).toBe(0);
    expect(Array.isArray(list.candidates)).toBe(true);
    const nudge = await run(buildAssistantTools(SUPREME), "nudgeStuckCandidates", {});
    expect(nudge).toEqual({ error: "none_stuck" });
  });

  it("sendExternalEmail stages a draft, and rejects a bad email", async () => {
    const ok = (await run(buildAssistantTools(SUPREME), "sendExternalEmail", { to: "anna.gombert@klinikum.de", toName: "Anna Gombert", subject: "4 Pflegekraft-Profile", body: "Sehr geehrte Frau Gombert, anbei …" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("anna.gombert@klinikum.de");
    expect(ok.summary).toContain("Pflegekraft");
    const bad = await run(buildAssistantTools(SUPREME), "sendExternalEmail", { to: "not-an-email", subject: "x", body: "y" });
    expect(bad).toEqual({ error: "bad_email" });
  });

  it("setAgencyProfile stages only changed fields, and rejects an empty patch", async () => {
    const ok = (await run(buildAssistantTools(SUPREME), "setAgencyProfile", { firma: "Borivon GmbH", betriebsnummer: "12345678" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Borivon GmbH");
    expect(ok.summary).toContain("betriebsnummer");
    expect(await run(buildAssistantTools(SUPREME), "setAgencyProfile", {})).toEqual({ error: "nothing_to_change" });
  });

  it("listAutomations returns the switches (defaults on), and setAutomation flips one", async () => {
    const list = (await run(buildAssistantTools(SUPREME), "listAutomations", {})) as { automations?: { key: string; enabled: boolean }[] };
    expect(Array.isArray(list.automations)).toBe(true);
    const weekly = list.automations?.find((a) => a.key === "weekly_report");
    expect(weekly?.enabled).toBe(true); // fail-safe default when the table is absent
    const set = (await run(buildAssistantTools(SUPREME), "setAutomation", { key: "weekly_report", enabled: false })) as { ok?: boolean; key?: string; enabled?: boolean };
    expect(set.ok).toBe(true);
    expect(set.key).toBe("weekly_report");
    expect(set.enabled).toBe(false);
  });

  // ── Audit fixes (2026-06-12) ────────────────────────────────────────────────

  it("setCandidateMilestone NORMALIZES a truthy boolean and rejects ambiguous (no silent FALSE)", async () => {
    const ok = (await run(buildAssistantTools(SUPREME), "setCandidateMilestone", { candidateUserId: "any-cand", field: "visa_granted", value: "yes" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("yes"); // summary == what gets written
    const bad = await run(buildAssistantTools(SUPREME), "setCandidateMilestone", { candidateUserId: "any-cand", field: "visa_granted", value: "maybe" });
    expect(bad).toEqual({ error: "bad_value" });
  });

  it("confirmPendingWrite REFUSES a write staged in the SAME request (anti same-turn-injection)", async () => {
    h.tables.assistant_pending_actions = { data: [{ id: "p1", tool_name: "createLead", args: { name: "Sara", __stagedReq: "REQ1" }, candidate_user_id: null, summary: "New lead: Sara", expires_at: "2999-01-01T00:00:00Z" }], error: null };
    const r = await run(buildAssistantTools({ ...SUPREME, requestId: "REQ1" }), "confirmPendingWrite", {});
    expect(r).toEqual({ error: "confirm_in_new_message" });
  });

  it("confirmPendingWrite EXECUTES a write staged in an EARLIER request", async () => {
    h.tables.assistant_pending_actions = { data: [{ id: "p1", tool_name: "createLead", args: { name: "Sara", __stagedReq: "REQ1" }, candidate_user_id: null, summary: "New lead: Sara", expires_at: "2999-01-01T00:00:00Z" }], error: null };
    const r = (await run(buildAssistantTools({ ...SUPREME, requestId: "REQ2" }), "confirmPendingWrite", {})) as { done?: boolean };
    expect(r.done).toBe(true);
  });

  it("confirmPendingWrite REFUSES to send an external email whose requested CV is missing", async () => {
    h.tables.assistant_pending_actions = { data: [{ id: "p1", tool_name: "sendExternalEmail", args: { to: "anna@klinik.de", subject: "Profiles", body: "Hi", attachCandidateIds: "cand1" }, candidate_user_id: null, summary: "email", expires_at: "2999-01-01T00:00:00Z" }], error: null };
    const r = (await run(buildAssistantTools(SUPREME), "confirmPendingWrite", {})) as { error?: string };
    expect(r.error).toMatch(/^attachment_missing/);
  });
});
