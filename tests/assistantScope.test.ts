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
    expect(await run(t, "setAutomation", { key: "inbox_reminder", enabled: false })).toEqual({ error: "admin_only" });
  });

  it("listUnansweredEmails → admin_only for a sub-admin (never reads the inbox)", async () => {
    const r = await run(buildAssistantTools(ORG_ADMIN), "listUnansweredEmails", {});
    expect(r).toEqual({ error: "admin_only" });
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

  it("org-pipeline tools → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    const orgUuid = "11111111-1111-1111-1111-111111111111";
    const reqUuid = "22222222-2222-2222-2222-222222222222";
    expect(await run(t, "listOrgRequests", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "reviewOrgRequest", { candidateUserId: "allowed-cand", orgId: orgUuid, decision: "approve" })).toEqual({ error: "admin_only" });
    expect(await run(t, "listSuggestedMatches", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "decideSuggestedMatch", { matchId: reqUuid, action: "accepted" })).toEqual({ error: "admin_only" });
    expect(await run(t, "listOrgNeeds", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "manageOrgRequirement", { op: "add", orgId: orgUuid, specialty: "Intensiv" })).toEqual({ error: "admin_only" });
    expect(await run(t, "manageOrganization", { op: "create", name: "Klinik X" })).toEqual({ error: "admin_only" });
    expect(await run(t, "setOrgBranding", { orgId: orgUuid, footerText: "Footer" })).toEqual({ error: "admin_only" });
    expect(await run(t, "listAgencies", {})).toEqual({ error: "admin_only" });
  });

  it("slot + sign-request tools → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    const slotUuid = "44444444-4444-4444-4444-444444444444";
    const srUuid = "55555555-5555-5555-5555-555555555555";
    expect(await run(t, "listSlots", { phase: "visum" })).toEqual({ error: "admin_only" });
    expect(await run(t, "sendSlotRequest", { slotId: slotUuid, candidateUserId: "allowed-cand" })).toEqual({ error: "admin_only" });
    expect(await run(t, "reviewSignRequest", { signRequestId: srUuid, action: "accept" })).toEqual({ error: "admin_only" });
  });

  it("listSignRequests → out_of_scope for a foreign candidate (no sign-requests leaked)", async () => {
    foreignOrgMocks();
    const r = await run(buildAssistantTools(ORG_ADMIN), "listSignRequests", { candidateUserId: "foreign-cand" });
    expect(r).toEqual({ error: "out_of_scope" });
  });

  it("staff & access tools → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    const orgUuid = "11111111-1111-1111-1111-111111111111";
    expect(await run(t, "listStaff", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "inviteSubAdmin", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "manageSubAdmin", { op: "create", email: "helper@borivon.com" })).toEqual({ error: "admin_only" });
    expect(await run(t, "assignCandidate", { op: "assign", subAdminEmail: "helper@borivon.com", candidateUserId: "allowed-cand" })).toEqual({ error: "admin_only" });
    expect(await run(t, "setCandidateVerified", { candidateUserId: "allowed-cand", verified: true })).toEqual({ error: "admin_only" });
    expect(await run(t, "manageOrgMember", { op: "add", orgId: orgUuid, email: "m@org.com", role: "member" })).toEqual({ error: "admin_only" });
  });

  it("calendar + academy tools → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    const evUuid = "66666666-6666-6666-6666-666666666666";
    expect(await run(t, "listCalendarEvents", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "createCalendarEvent", { title: "Networking", startsAt: "2026-07-10T10:00:00Z" })).toEqual({ error: "admin_only" });
    expect(await run(t, "bookCalendarEvent", { title: "Erstgespräch", startsAt: "2026-06-15T15:00:00" })).toEqual({ error: "admin_only" });
    expect(await run(t, "deleteCalendarEvent", { eventId: evUuid })).toEqual({ error: "admin_only" });
    expect(await run(t, "listCohorts", {})).toEqual({ error: "admin_only" });
  });

  it("getAcademyStanding → out_of_scope for a foreign candidate", async () => {
    foreignOrgMocks();
    const r = await run(buildAssistantTools(ORG_ADMIN), "getAcademyStanding", { candidateUserId: "foreign-cand" });
    expect(r).toEqual({ error: "out_of_scope" });
  });

  it("full-power tools (stage lock/unlock, delete org, delete account) → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    const orgUuid = "77777777-7777-7777-7777-777777777777";
    expect(await run(t, "toggleStageLock", { candidateUserId: "11111111-1111-1111-1111-111111111111", stage: "visum", unlocked: true })).toEqual({ error: "admin_only" });
    expect(await run(t, "deleteOrganization", { orgId: orgUuid })).toEqual({ error: "admin_only" });
    expect(await run(t, "deleteCandidateAccount", { candidateUserId: "11111111-1111-1111-1111-111111111111" })).toEqual({ error: "admin_only" });
    expect(await run(t, "setAcademyLevel", { candidateUserId: "11111111-1111-1111-1111-111111111111", level: "B2" })).toEqual({ error: "admin_only" });
    const tf = buildAssistantTools(ORG_ADMIN, { r2Key: "k", mime: "image/png", fileName: "logo.png", sha256: "abc" });
    expect(await run(tf, "uploadOrgLogo", { orgId: "77777777-7777-7777-7777-777777777777" })).toEqual({ error: "admin_only" });
  });

  it("Batch Board tools (listBatches, manageBatch, setFunnelStage) → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "listBatches", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "manageBatch", { op: "create", name: "UKSH — Q3 2026", seats: 10 })).toEqual({ error: "admin_only" });
    expect(await run(t, "setFunnelStage", { candidateUserId: "11111111-1111-1111-1111-111111111111", stage: "waiting_2nd" })).toEqual({ error: "admin_only" });
  });

  it("sent-email memory tools (listRecentSentEmails, resendEmail) → admin_only for a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "listRecentSentEmails", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "resendEmail", { emailId: "88888888-8888-8888-8888-888888888888" })).toEqual({ error: "admin_only" });
  });
});

describe("assistant tools allow the supreme admin", () => {
  it("getDocumentDownloadLink mints a 10-minute link (admin token) for any candidate", async () => {
    h.tables.documents = { data: { id: "doc1", user_id: "any-cand", file_name: "cv.pdf", drive_file_id: "drive1" }, error: null };
    const r = (await run(buildAssistantTools(SUPREME), "getDocumentDownloadLink", { docId: "doc1" })) as {
      url: string;
      expiresInSec: number;
    };
    // 600s (was 180) — the webhook delivers files AFTER the model run; 180 expired the tail of big batches (B7).
    expect(h.signDlToken).toHaveBeenCalledWith("admin-id", 600);
    expect(r.expiresInSec).toBe(600);
    expect(r.url).toContain("/api/portal/file?id=drive1");
    expect(r.url).toContain("dlt=");
    expect(r.url).toContain("dl=1");
  });

  it("getCvLinks resolves many full names in ONE call (full name → one person; bare first name → ambiguous; unknown → not_found)", async () => {
    h.tables.candidate_profiles = {
      data: [
        { user_id: "u-ismail", first_name: "Ismail", last_name: "Louali" },
        { user_id: "u-hajar1", first_name: "Hajar", last_name: "El Kairaa" },
        { user_id: "u-hajar2", first_name: "Hajar", last_name: "Bousfiha" },
      ],
      error: null,
    };
    h.authUsers = [
      { id: "u-ismail", email: "ismail@x.com", user_metadata: { full_name: "Ismail Louali" } },
      { id: "u-hajar1", email: "h1@x.com", user_metadata: { full_name: "Hajar El Kairaa" } },
      { id: "u-hajar2", email: "h2@x.com", user_metadata: { full_name: "Hajar Bousfiha" } },
    ];
    // documents lookup (same stub for any candidate) — a German CV on file.
    h.tables.documents = { data: [{ id: "cv-1", user_id: "u-ismail", file_name: "ismail_cv.pdf", file_type: "Lebenslauf (DE)", status: "approved", uploaded_at: "2026-01-01", drive_file_id: null, r2_key: "r2/x" }], error: null };

    const r = (await run(buildAssistantTools(SUPREME), "getCvLinks", {
      candidates: ["Ismail Louali", "Hajar", "Nour Eddine Zzz"],
    })) as { results?: { query?: string; status?: string; name?: string; url?: string; matches?: unknown[] }[] };
    const byQ = Object.fromEntries((r.results ?? []).map((x) => [x.query, x]));
    // Full name pins exactly one person (not ambiguous) — the bug was it kept re-asking.
    expect(byQ["Ismail Louali"]?.name).toBe("Ismail Louali");
    expect(["ok", "no_cv"]).toContain(byQ["Ismail Louali"]?.status); // resolved a single candidate
    // Bare first name shared by two people → ambiguous (ask which), not a wrong guess.
    expect(byQ["Hajar"]?.status).toBe("ambiguous");
    expect(byQ["Hajar"]?.matches?.length).toBe(2);
    // Unknown → not_found.
    expect(byQ["Nour Eddine Zzz"]?.status).toBe("not_found");
  });

  it("getB2Status returns per-candidate B2 for NAMED people (resolves full names, flags ambiguous, never dumps the roster)", async () => {
    h.tables.candidate_profiles = {
      data: [
        { user_id: "u-ismail", first_name: "Ismail", last_name: "Louali" },
        { user_id: "u-hajar1", first_name: "Hajar", last_name: "El Kairaa" },
        { user_id: "u-hajar2", first_name: "Hajar", last_name: "Bousfiha" },
      ],
      error: null,
    };
    h.authUsers = [
      { id: "u-ismail", email: "ismail@x.com", user_metadata: { full_name: "Ismail Louali" } },
      { id: "u-hajar1", email: "h1@x.com", user_metadata: { full_name: "Hajar El Kairaa" } },
      { id: "u-hajar2", email: "h2@x.com", user_metadata: { full_name: "Hajar Bousfiha" } },
    ];
    const r = (await run(buildAssistantTools(SUPREME), "getB2Status", { candidates: ["Ismail Louali", "Hajar", "Nobody Xyz"] })) as {
      results?: { query?: string; status?: string; name?: string; b2Stage?: string; detail?: string }[];
    };
    const byQ = Object.fromEntries((r.results ?? []).map((x) => [x.query, x]));
    // Full name → exactly one person, with the detailed B2 fields present.
    expect(byQ["Ismail Louali"]?.status).toBe("ok");
    expect(byQ["Ismail Louali"]?.name).toBe("Ismail Louali");
    expect(typeof byQ["Ismail Louali"]?.b2Stage).toBe("string");
    expect(typeof byQ["Ismail Louali"]?.detail).toBe("string");
    // Bare shared first name → ambiguous (ask which), never a roster dump.
    expect(byQ["Hajar"]?.status).toBe("ambiguous");
    expect(byQ["Nobody Xyz"]?.status).toBe("not_found");
    // Only the 3 requested people come back — not all candidates.
    expect((r.results ?? []).length).toBe(3);
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
    // willFireAt/recurrence are null for an undated, one-shot task.
    expect(r).toEqual({ saved: true, reminderId: "r1", willFireAt: null, recurrence: null });
  });

  it("saveReminder captures a TIME → willFireAt is set (the reminder will actually fire)", async () => {
    h.tables.assistant_reminders = { data: { id: "r2" }, error: null };
    const r = (await run(buildAssistantTools(SUPREME), "saveReminder", { text: "call the embassy", dueAt: "2026-06-19T15:00:00" })) as { saved?: boolean; willFireAt?: string | null };
    expect(r.saved).toBe(true);
    expect(typeof r.willFireAt).toBe("string"); // a real firing instant was captured (was silently dropped before)
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

  it("sendExternalEmail stages a draft (with CC), and rejects bad to/cc emails", async () => {
    const ok = (await run(buildAssistantTools(SUPREME), "sendExternalEmail", { to: "anna.gombert@klinikum.de", toName: "Anna Gombert", subject: "4 Pflegekraft-Profile", body: "Sehr geehrte Frau Gombert, anbei …" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("anna.gombert@klinikum.de");
    expect(ok.summary).toContain("Pflegekraft");
    // CC: staged + shown in the confirm summary.
    const cc = (await run(buildAssistantTools(SUPREME), "sendExternalEmail", { to: "a.gombert@calmaroi.de", cc: "o.musleh@calmaroi.de", subject: "B2-Status", body: "Hallo" })) as { staged?: boolean; summary?: string };
    expect(cc.staged).toBe(true);
    expect(cc.summary).toContain("CC: o.musleh@calmaroi.de");
    // An unresolvable recipient (not an email, not a known name) → asks for the address.
    const bad = await run(buildAssistantTools(SUPREME), "sendExternalEmail", { to: "not-an-email", subject: "x", body: "y" });
    expect(bad).toMatchObject({ error: "no_email_for_recipient", recipient: "not-an-email" });
    const badCc = await run(buildAssistantTools(SUPREME), "sendExternalEmail", { to: "a@b.com", cc: "nope", subject: "x", body: "y" });
    expect(badCc).toEqual({ error: "bad_cc:nope" });
    // Tolerant: two addresses lumped into `to` → first is To, rest fold into CC.
    const lumped = (await run(buildAssistantTools(SUPREME), "sendExternalEmail", { to: "a.gombert@calmaroi.de, o.musleh@calmaroi.de", subject: "B2", body: "Hallo" })) as { staged?: boolean; summary?: string };
    expect(lumped.staged).toBe(true);
    expect(lumped.summary).toContain("To: a.gombert@calmaroi.de");
    expect(lumped.summary).toContain("CC: o.musleh@calmaroi.de");
    // Markdown is stripped in code — no ** ever reaches the email/preview.
    const md = (await run(buildAssistantTools(SUPREME), "sendExternalEmail", { to: "a@b.com", subject: "Hi", body: "Hallo **Anna**, hier `code` und *kursiv*." })) as { staged?: boolean; summary?: string };
    expect(md.staged).toBe(true);
    expect(md.summary).not.toContain("**");
    expect(md.summary).toContain("Hallo Anna");
  });

  it("sendCalendarInvite stages an invite (confirm-first) + rejects bad attendee / time; sub-admin blocked", async () => {
    const ok = (await run(buildAssistantTools(SUPREME), "sendCalendarInvite", { attendees: "anna@klinik.de, omar@calmaroi.de", title: "Interview Ismail", startsAt: "2026-07-10T10:00:00Z", durationMinutes: 45, location: "https://meet.example/x" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Interview Ismail");
    expect(ok.summary).toContain("anna@klinik.de");
    // unresolvable attendee (not an email, not a known name) → asks for the address, nothing staged.
    expect(await run(buildAssistantTools(SUPREME), "sendCalendarInvite", { attendees: "not-an-email", title: "x", startsAt: "2026-07-10T10:00:00Z" })).toMatchObject({ error: "no_email_on_file", unresolved: ["not-an-email"] });
    // bad start time → error.
    expect(await run(buildAssistantTools(SUPREME), "sendCalendarInvite", { attendees: "a@b.com", title: "x", startsAt: "not-a-date" })).toEqual({ error: "bad_start_time" });
    // a sub-admin can't send invites (supreme-only).
    expect(await run(buildAssistantTools(ORG_ADMIN), "sendCalendarInvite", { attendees: "a@b.com", title: "x", startsAt: "2026-07-10T10:00:00Z" })).toEqual({ error: "admin_only" });
  });

  it("native Gmail (searchInbox/replyToEmail) is supreme-only + needs Workspace connected", async () => {
    // sub-admin blocked outright.
    expect(await run(buildAssistantTools(ORG_ADMIN), "searchInbox", { query: "from:anna" })).toEqual({ error: "admin_only" });
    expect(await run(buildAssistantTools(ORG_ADMIN), "replyToEmail", { messageId: "abc123", body: "ok" })).toEqual({ error: "admin_only" });
    expect(await run(buildAssistantTools(ORG_ADMIN), "getEmailAttachments", { messageId: "abc123" })).toEqual({ error: "admin_only" });
    expect(await run(buildAssistantTools(ORG_ADMIN), "forwardEmail", { messageId: "abc123", to: "x@y.de" })).toEqual({ error: "admin_only" });
    expect(await run(buildAssistantTools(ORG_ADMIN), "readThread", { messageId: "abc123" })).toEqual({ error: "admin_only" });
    expect(await run(buildAssistantTools(ORG_ADMIN), "manageEmail", { messageId: "abc123", action: "archive" })).toEqual({ error: "admin_only" });
    expect(await run(buildAssistantTools(ORG_ADMIN), "saveDraft", { to: "x@y.de", subject: "Hi", body: "hi" })).toEqual({ error: "admin_only" });
    expect(await run(buildAssistantTools(ORG_ADMIN), "showPendingAttachments", {})).toEqual({ error: "admin_only" });
    // supreme, but Workspace not connected in the test env → clear not_connected (not a crash).
    expect(await run(buildAssistantTools(SUPREME), "searchInbox", { query: "from:anna" })).toEqual({ error: "workspace_not_connected", hint: expect.any(String) });
    expect(await run(buildAssistantTools(SUPREME), "replyToEmail", { messageId: "abc123", body: "ok" })).toEqual({ error: "workspace_not_connected" });
    expect(await run(buildAssistantTools(SUPREME), "getEmailAttachments", { messageId: "abc123" })).toEqual({ error: "workspace_not_connected" });
  });

  it("setAgencyProfile stages only changed fields, and rejects an empty patch", async () => {
    const ok = (await run(buildAssistantTools(SUPREME), "setAgencyProfile", { firma: "Borivon GmbH", betriebsnummer: "12345678" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Borivon GmbH");
    expect(ok.summary).toContain("betriebsnummer");
    expect(await run(buildAssistantTools(SUPREME), "setAgencyProfile", {})).toEqual({ error: "nothing_to_change" });
  });

  const ORG_UUID = "11111111-1111-1111-1111-111111111111";
  const REQ_UUID = "22222222-2222-2222-2222-222222222222";
  const MATCH_UUID = "33333333-3333-3333-3333-333333333333";

  it("reviewOrgRequest stages an approve/reject with candidate + org names", async () => {
    h.tables.candidate_profiles = { data: { first_name: "Hajar", last_name: "B" }, error: null };
    h.tables.organizations = { data: { name: "UKSH Kiel" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "reviewOrgRequest", { candidateUserId: "cand-1", orgId: ORG_UUID, decision: "approve" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Approve");
    expect(ok.summary).toContain("Hajar");
    expect(ok.summary).toContain("UKSH Kiel");
  });

  it("decideSuggestedMatch stages a pending match, and rejects an already-decided / missing one", async () => {
    h.tables.suggested_matches = { data: { candidate_user_id: "cand-1", org_id: ORG_UUID, status: "pending" }, error: null };
    h.tables.candidate_profiles = { data: { first_name: "Sara", last_name: "L" }, error: null };
    h.tables.organizations = { data: { name: "Charité" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "decideSuggestedMatch", { matchId: MATCH_UUID, action: "accepted" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Accept match");
    expect(ok.summary).toContain("Sara");

    h.tables.suggested_matches = { data: { candidate_user_id: "cand-1", org_id: ORG_UUID, status: "accepted" }, error: null };
    expect(await run(buildAssistantTools(SUPREME), "decideSuggestedMatch", { matchId: MATCH_UUID, action: "skipped" })).toEqual({ error: "already_decided" });

    h.tables.suggested_matches = { data: null, error: null };
    expect(await run(buildAssistantTools(SUPREME), "decideSuggestedMatch", { matchId: MATCH_UUID, action: "skipped" })).toEqual({ error: "match_not_found" });
  });

  it("manageOrgRequirement stages add (org name) and requires the right id per op", async () => {
    h.tables.organizations = { data: { name: "UKSH Kiel" }, error: null };
    const add = (await run(buildAssistantTools(SUPREME), "manageOrgRequirement", { op: "add", orgId: ORG_UUID, specialty: "Intensiv", slots: 3, location: "Kiel" })) as { staged?: boolean; summary?: string };
    expect(add.staged).toBe(true);
    expect(add.summary).toContain("Add need");
    expect(add.summary).toContain("UKSH Kiel");
    expect(add.summary).toContain("Intensiv");
    expect(await run(buildAssistantTools(SUPREME), "manageOrgRequirement", { op: "edit", specialty: "X" })).toEqual({ error: "requirementId_required" });
    const close = (await run(buildAssistantTools(SUPREME), "manageOrgRequirement", { op: "close", requirementId: REQ_UUID })) as { staged?: boolean; summary?: string };
    expect(close.staged).toBe(true);
    expect(close.summary).toContain("Close need");
  });

  it("manageOrganization stages create/edit and validates required fields", async () => {
    const create = (await run(buildAssistantTools(SUPREME), "manageOrganization", { op: "create", name: "Pflege Nord" })) as { staged?: boolean; summary?: string };
    expect(create.staged).toBe(true);
    expect(create.summary).toContain("Create org");
    expect(create.summary).toContain("Pflege Nord");
    expect(await run(buildAssistantTools(SUPREME), "manageOrganization", { op: "create", name: "  " })).toEqual({ error: "name_required" });
    expect(await run(buildAssistantTools(SUPREME), "manageOrganization", { op: "edit", name: "Renamed" })).toEqual({ error: "orgId_required" });
  });

  it("setOrgBranding stages footer + vaccine, and rejects an empty change", async () => {
    h.tables.organizations = { data: { name: "UKSH Kiel" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "setOrgBranding", { orgId: ORG_UUID, footerText: "Powered by Borivon", masern: 2, varizell: 1 })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("UKSH Kiel");
    expect(ok.summary).toContain("Masern 2");
    expect(await run(buildAssistantTools(SUPREME), "setOrgBranding", { orgId: ORG_UUID })).toEqual({ error: "nothing_to_change" });
  });

  it("listOrgNeeds / listAgencies return their shapes for the supreme admin", async () => {
    h.tables.org_requirements = { data: [{ id: REQ_UUID, org_id: ORG_UUID, specialty: "Intensiv", slots: 2, location: "Kiel", start_date: null, notes: null, created_at: "2026-01-01" }], error: null };
    h.tables.organizations = { data: [{ id: ORG_UUID, name: "UKSH Kiel" }], error: null };
    const needs = (await run(buildAssistantTools(SUPREME), "listOrgNeeds", {})) as { count?: number; needs?: { orgName?: string }[] };
    expect(needs.count).toBe(1);
    expect(needs.needs?.[0]?.orgName).toBe("UKSH Kiel");

    h.tables.agencies = { data: [{ id: "ag-1", name: "Calmaroi", created_at: "2026-01-01" }], error: null };
    h.tables.sub_admins = { data: [{ agency_id: "ag-1", is_agency_admin: true }], error: null };
    h.tables.candidate_profiles = { data: [{ agency_id: "ag-1" }, { agency_id: "ag-1" }], error: null };
    const ags = (await run(buildAssistantTools(SUPREME), "listAgencies", {})) as { count?: number; agencies?: { name?: string; adminCount?: number; candidateCount?: number }[] };
    expect(ags.count).toBe(1);
    expect(ags.agencies?.[0]?.name).toBe("Calmaroi");
    expect(ags.agencies?.[0]?.adminCount).toBe(1);
    expect(ags.agencies?.[0]?.candidateCount).toBe(2);
  });

  const SLOT_UUID = "44444444-4444-4444-4444-444444444444";
  const SR_UUID = "55555555-5555-5555-5555-555555555555";

  it("sendSlotRequest stages and auto-derives sign/fill from the slot flags", async () => {
    h.tables.phase_slots = { data: { label: "Arbeitsvertrag", candidate_signs: true, candidate_fills: false }, error: null };
    h.tables.candidate_profiles = { data: { first_name: "Hajar", last_name: "B" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "sendSlotRequest", { slotId: SLOT_UUID, candidateUserId: "cand-1" })) as { staged?: boolean; summary?: string; args?: { needsSign?: boolean; needsFill?: boolean } };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Hajar");
    expect(ok.summary).toContain("sign");
    expect(ok.summary).toContain("Arbeitsvertrag");
    // an unknown slot is rejected
    h.tables.phase_slots = { data: null, error: null };
    expect(await run(buildAssistantTools(SUPREME), "sendSlotRequest", { slotId: SLOT_UUID, candidateUserId: "cand-1" })).toEqual({ error: "slot_not_found" });
  });

  it("reviewSignRequest stages only a SIGNED request, needs feedback to reject, 404s a missing one", async () => {
    h.tables.sign_requests = { data: { candidate_user_id: "cand-1", document_name: "Vollmacht", status: "signed" }, error: null };
    h.tables.candidate_profiles = { data: { first_name: "Sara", last_name: "L" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "reviewSignRequest", { signRequestId: SR_UUID, action: "accept" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Accept");
    expect(ok.summary).toContain("Vollmacht");
    // reject without feedback is refused before any DB read
    expect(await run(buildAssistantTools(SUPREME), "reviewSignRequest", { signRequestId: SR_UUID, action: "reject" })).toEqual({ error: "feedback_required" });
    // a not-yet-signed request can't be reviewed
    h.tables.sign_requests = { data: { candidate_user_id: "cand-1", document_name: "Vollmacht", status: "pending" }, error: null };
    expect(await run(buildAssistantTools(SUPREME), "reviewSignRequest", { signRequestId: SR_UUID, action: "accept" })).toEqual({ error: "not_signed_yet" });
    // missing request
    h.tables.sign_requests = { data: null, error: null };
    expect(await run(buildAssistantTools(SUPREME), "reviewSignRequest", { signRequestId: SR_UUID, action: "accept" })).toEqual({ error: "not_found" });
  });

  it("listSlots / listSignRequests return their shapes for the supreme admin", async () => {
    h.tables.phase_slots = { data: [{ id: SLOT_UUID, label: "Arbeitsvertrag", phase: "visum", position: 1, type: "simple", action_type: "sign", admin_signs: false, candidate_signs: true, admin_fills: false, candidate_fills: false, pdf_has_native_fields: false, template_pdf_path: "slot-templates/x.pdf", org_id: null }], error: null };
    const slots = (await run(buildAssistantTools(SUPREME), "listSlots", { phase: "visum" })) as { count?: number; slots?: { label?: string; candidateSigns?: boolean; hasTemplate?: boolean }[] };
    expect(slots.count).toBe(1);
    expect(slots.slots?.[0]?.label).toBe("Arbeitsvertrag");
    expect(slots.slots?.[0]?.candidateSigns).toBe(true);
    expect(slots.slots?.[0]?.hasTemplate).toBe(true);

    h.tables.sign_requests = { data: [{ id: SR_UUID, document_name: "Vollmacht", note: null, status: "signed", review_status: null, review_feedback: null, signed_at: "2026-02-01", created_at: "2026-01-01" }], error: null };
    const reqs = (await run(buildAssistantTools(SUPREME), "listSignRequests", { candidateUserId: "cand-1" })) as { count?: number; requests?: { documentName?: string; awaitingReview?: boolean }[] };
    expect(reqs.count).toBe(1);
    expect(reqs.requests?.[0]?.documentName).toBe("Vollmacht");
    expect(reqs.requests?.[0]?.awaitingReview).toBe(true);
  });

  const STAFF_ORG = "11111111-1111-1111-1111-111111111111";

  it("inviteSubAdmin mints a self-serve /join/subadmin link (immediate)", async () => {
    const r = (await run(buildAssistantTools(SUPREME), "inviteSubAdmin", {})) as { url?: string; code?: string };
    expect(r.url).toContain("/join/subadmin/");
    expect((r.code ?? "").length).toBeGreaterThan(20);
  });

  it("manageSubAdmin stages create, validates the email", async () => {
    const ok = (await run(buildAssistantTools(SUPREME), "manageSubAdmin", { op: "create", email: "Helper@Borivon.com", name: "Helper One" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Add sub-admin");
    expect(ok.summary).toContain("helper@borivon.com"); // normalized to lowercase in the summary
    expect(await run(buildAssistantTools(SUPREME), "manageSubAdmin", { op: "remove", email: "not-an-email" })).toEqual({ error: "bad_email" });
  });

  it("assignCandidate stages an assign with the candidate's name", async () => {
    h.tables.candidate_profiles = { data: { first_name: "Hajar", last_name: "B" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "assignCandidate", { op: "assign", subAdminEmail: "helper@borivon.com", candidateUserId: "cand-1" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Assign");
    expect(ok.summary).toContain("Hajar");
    expect(ok.summary).toContain("helper@borivon.com");
  });

  it("setCandidateVerified stages grant/revoke", async () => {
    h.tables.candidate_profiles = { data: { first_name: "Sara", last_name: "L" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "setCandidateVerified", { candidateUserId: "cand-1", verified: true })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Grant verified tick");
    expect(ok.summary).toContain("Sara");
  });

  it("manageOrgMember stages add with org name, and requires a role for setRole", async () => {
    h.tables.organizations = { data: { name: "UKSH Kiel" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "manageOrgMember", { op: "add", orgId: STAFF_ORG, email: "m@org.com", role: "owner" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("UKSH Kiel");
    expect(ok.summary).toContain("m@org.com");
    expect(await run(buildAssistantTools(SUPREME), "manageOrgMember", { op: "setRole", orgId: STAFF_ORG, email: "m@org.com" })).toEqual({ error: "role_required" });
  });

  it("listStaff returns sub-admins with assigned counts", async () => {
    h.tables.sub_admins = { data: [{ email: "helper@borivon.com", name: "Helper", label: null, is_agency_admin: false, agency_id: null, created_at: "2026-01-01" }], error: null };
    h.tables.sub_admin_assignments = { data: [{ sub_admin_email: "helper@borivon.com", candidate_user_id: "c1" }, { sub_admin_email: "helper@borivon.com", candidate_user_id: "c2" }], error: null };
    const r = (await run(buildAssistantTools(SUPREME), "listStaff", {})) as { count?: number; staff?: { email?: string; assignedCount?: number; orgScoped?: boolean }[] };
    expect(r.count).toBe(1);
    expect(r.staff?.[0]?.email).toBe("helper@borivon.com");
    expect(r.staff?.[0]?.assignedCount).toBe(2);
    expect(r.staff?.[0]?.orgScoped).toBe(false);
  });

  const EVENT_UUID = "66666666-6666-6666-6666-666666666666";

  it("createCalendarEvent stages a valid event and rejects a bad start", async () => {
    const ok = (await run(buildAssistantTools(SUPREME), "createCalendarEvent", { title: "Networking Night", startsAt: "2026-07-10T18:00:00Z", location: "Berlin", repeatWeekly: 3 })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Networking Night");
    expect(ok.summary).toContain("Berlin");
    expect(ok.summary).toContain("×3 weekly");
    expect(await run(buildAssistantTools(SUPREME), "createCalendarEvent", { title: "X", startsAt: "not-a-date" })).toEqual({ error: "bad_start" });
  });

  it("bookCalendarEvent (founder's own Google Calendar) stages a local-time event and rejects a bad start", async () => {
    const ok = (await run(buildAssistantTools(SUPREME), "bookCalendarEvent", { title: "Erstgespräch", startsAt: "2026-06-15T15:00:00", location: "Büro" })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Erstgespräch");
    expect(ok.summary).toContain("Büro");
    expect(await run(buildAssistantTools(SUPREME), "bookCalendarEvent", { title: "X", startsAt: "not-a-date" })).toEqual({ error: "bad_start" });
  });

  it("deleteCalendarEvent stages with the event title, 404s a missing one", async () => {
    h.tables.calendar_events = { data: { title: "Career Fair", starts_at: "2026-08-01T09:00:00Z" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "deleteCalendarEvent", { eventId: EVENT_UUID })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Career Fair");
    h.tables.calendar_events = { data: null, error: null };
    expect(await run(buildAssistantTools(SUPREME), "deleteCalendarEvent", { eventId: EVENT_UUID })).toEqual({ error: "not_found" });
  });

  it("toggleStageLock stages a lock/unlock with the human stage label", async () => {
    const r = (await run(buildAssistantTools(SUPREME), "toggleStageLock", { candidateUserId: "11111111-1111-1111-1111-111111111111", stage: "visum", unlocked: true })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("Unlock");
    expect(r.summary).toContain("Visum");
  });

  it("deleteOrganization stages with the org name, 404s a missing org", async () => {
    const ORG_UUID = "77777777-7777-7777-7777-777777777777";
    h.tables.organizations = { data: { name: "UKSH" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "deleteOrganization", { orgId: ORG_UUID })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("UKSH");
    h.tables.organizations = { data: null, error: null };
    expect(await run(buildAssistantTools(SUPREME), "deleteOrganization", { orgId: ORG_UUID })).toEqual({ error: "not_found" });
  });

  it("deleteCandidateAccount stages an irreversible delete with the candidate name", async () => {
    h.tables.candidate_profiles = { data: { first_name: "Hajar", last_name: "El Kairaa" }, error: null };
    const r = (await run(buildAssistantTools(SUPREME), "deleteCandidateAccount", { candidateUserId: "11111111-1111-1111-1111-111111111111" })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("Hajar El Kairaa");
    expect(r.summary).toContain("DELETE");
  });

  it("sendExternalEmail attaches CVs by NAME (resolves to real candidates; bad name → clear error, not a garbage id)", async () => {
    h.tables.candidate_profiles = { data: [
      { user_id: "11111111-1111-1111-1111-111111111111", first_name: "Ismail", last_name: "Louali" },
      { user_id: "22222222-2222-2222-2222-222222222222", first_name: "Samira", last_name: "Irsani" },
    ], error: null };
    h.authUsers = [
      { id: "11111111-1111-1111-1111-111111111111", email: "ismail@x.com", user_metadata: { full_name: "Ismail Louali" } },
      { id: "22222222-2222-2222-2222-222222222222", email: "samira@x.com", user_metadata: { full_name: "Samira Irsani" } },
    ];
    const ok = (await run(buildAssistantTools(SUPREME), "sendExternalEmail", {
      to: "anna@klinikum.de", subject: "Candidate CVs", body: "Hi Anna", attachCandidateNames: "Ismail Louali, Samira Irsani",
    })) as { staged?: boolean; summary?: string };
    expect(ok.staged).toBe(true);
    expect(ok.summary).toContain("Ismail Louali");
    expect(ok.summary).toContain("Samira Irsani");
    // An unknown name fails loudly with the NAME — never a silent garbage id.
    expect(await run(buildAssistantTools(SUPREME), "sendExternalEmail", {
      to: "anna@klinikum.de", subject: "x", body: "y", attachCandidateNames: "Nobody Here",
    })).toEqual({ error: "couldnt_find_candidate: Nobody Here" });
  });

  it("setAcademyLevel stages a level change with the candidate name + level", async () => {
    h.tables.candidate_profiles = { data: { first_name: "Doha", last_name: "Zini" }, error: null };
    const r = (await run(buildAssistantTools(SUPREME), "setAcademyLevel", { candidateUserId: "11111111-1111-1111-1111-111111111111", level: "B1" })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("Doha Zini");
    expect(r.summary).toContain("B1");
  });

  it("manageBatch stages a create, setFunnelStage stages a stage change", async () => {
    const created = (await run(buildAssistantTools(SUPREME), "manageBatch", { op: "create", name: "UKSH — Q3 2026", seats: 10 })) as { staged?: boolean; summary?: string };
    expect(created.staged).toBe(true);
    expect(created.summary).toContain("UKSH — Q3 2026");
    expect(created.summary).toContain("10 seats");
    expect(await run(buildAssistantTools(SUPREME), "manageBatch", { op: "edit" })).toEqual({ error: "batchId_required" });

    h.tables.candidate_profiles = { data: { first_name: "Hajar", last_name: "El Kairaa" }, error: null };
    const staged = (await run(buildAssistantTools(SUPREME), "setFunnelStage", { candidateUserId: "11111111-1111-1111-1111-111111111111", stage: "waiting_2nd" })) as { staged?: boolean; summary?: string };
    expect(staged.staged).toBe(true);
    expect(staged.summary).toContain("Hajar El Kairaa");
    expect(staged.summary).toContain("waiting_2nd");
    expect(await run(buildAssistantTools(SUPREME), "setFunnelStage", { candidateUserId: "11111111-1111-1111-1111-111111111111" })).toEqual({ error: "nothing_to_set" });
  });

  it("uploadOrgLogo stages with the org name when a file is attached, no_file without one", async () => {
    const ORG_UUID = "77777777-7777-7777-7777-777777777777";
    h.tables.organizations = { data: { name: "Calmaroi" }, error: null };
    // No attached file → can't set a logo.
    expect(await run(buildAssistantTools(SUPREME), "uploadOrgLogo", { orgId: ORG_UUID })).toEqual({ error: "no_file" });
    // With an attached image → stages.
    const tf = buildAssistantTools(SUPREME, { r2Key: "chat-uploads/a/x.png", mime: "image/png", fileName: "calmaroi.png", sha256: "abc" });
    const r = (await run(tf, "uploadOrgLogo", { orgId: ORG_UUID })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    expect(r.summary).toContain("Calmaroi");
  });

  it("listCalendarEvents returns upcoming events, listCohorts returns cohorts", async () => {
    h.tables.calendar_events = { data: [{ id: EVENT_UUID, title: "Future Event", starts_at: "2099-01-01T00:00:00Z", ends_at: null, location: "Berlin", link_url: null, vip_only: false, attendee_ids: [] }], error: null };
    const evs = (await run(buildAssistantTools(SUPREME), "listCalendarEvents", {})) as { count?: number; events?: { title?: string }[] };
    expect(evs.count).toBe(1);
    expect(evs.events?.[0]?.title).toBe("Future Event");

    h.tables.academy_cohorts = { data: [{ id: "co-1", name: "A1 Basics", target_level: "B2", status: "active", created_at: "2026-01-01" }], error: null };
    h.tables.academy_cohort_members = { data: [{ cohort_id: "co-1", status: "active" }, { cohort_id: "co-1", status: "dropped" }], error: null };
    const cos = (await run(buildAssistantTools(SUPREME), "listCohorts", {})) as { count?: number; cohorts?: { name?: string; activeMembers?: number }[] };
    expect(cos.count).toBe(1);
    expect(cos.cohorts?.[0]?.name).toBe("A1 Basics");
    expect(cos.cohorts?.[0]?.activeMembers).toBe(1); // only the active member counts
  });

  it("getAcademyStanding reports not-enrolled, then a full standing", async () => {
    h.tables.academy_cohort_members = { data: null, error: null };
    expect(await run(buildAssistantTools(SUPREME), "getAcademyStanding", { candidateUserId: "cand-1" })).toEqual({ enrolled: false });

    h.tables.academy_cohort_members = { data: { cohort_id: "co-1", current_level: "A2", status: "active" }, error: null };
    h.tables.academy_cohorts = { data: { name: "A1 Basics" }, error: null };
    h.tables.academy_point_events = { data: [{ points: 10 }, { points: 5 }], error: null };
    h.tables.academy_attendance = { data: [{ status: "present" }, { status: "late" }], error: null };
    h.tables.academy_submissions = { data: [{ on_time: true, passed: true }], error: null };
    const st = (await run(buildAssistantTools(SUPREME), "getAcademyStanding", { candidateUserId: "cand-1" })) as { enrolled?: boolean; cohortName?: string; level?: string; score?: number; attendanceRatePct?: number };
    expect(st.enrolled).toBe(true);
    expect(st.cohortName).toBe("A1 Basics");
    expect(st.level).toBe("A2");
    expect(st.score).toBe(15);
    expect(st.attendanceRatePct).toBe(100); // present+late / non-excused
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

  // Regression: the setAutomation enum used to omit these 3 keys, so the founder
  // could NOT turn off the SLA pings / follow-up chase / doc reminders from chat.
  it("setAutomation accepts inbox_sla, followup_chase and doc_reminders (enum no longer drifts)", async () => {
    for (const key of ["inbox_sla", "followup_chase", "doc_reminders"] as const) {
      const set = (await run(buildAssistantTools(SUPREME), "setAutomation", { key, enabled: false })) as { ok?: boolean; key?: string; error?: string };
      expect(set.error).toBeUndefined();
      expect(set.ok).toBe(true);
      expect(set.key).toBe(key);
    }
  });

  // ── Wave: leads lifecycle + academy enrol + signature roster ────────────────
  it("setLeadStatus writes the status (supreme); sub-admin is blocked", async () => {
    h.tables.leads = { data: { id: "lead1" }, error: null };
    const ok = (await run(buildAssistantTools(SUPREME), "setLeadStatus", { leadId: "11111111-1111-1111-1111-111111111111", status: "contacted" })) as { ok?: boolean; status?: string };
    expect(ok.ok).toBe(true);
    expect(ok.status).toBe("contacted");
    expect(await run(buildAssistantTools(ORG_ADMIN), "setLeadStatus", { leadId: "11111111-1111-1111-1111-111111111111", status: "dead" })).toEqual({ error: "admin_only" });
  });

  it("listLeads filters by status in code (tolerates missing column)", async () => {
    h.tables.leads = { data: [{ id: "a", status: "new" }, { id: "b", status: "contacted" }, { id: "c" }], error: null };
    const r = (await run(buildAssistantTools(SUPREME), "listLeads", { status: "new" })) as { leads: { id: string }[] };
    // 'a' (new) + 'c' (no column → treated as 'new'); 'b' (contacted) excluded.
    expect(r.leads.map((l) => l.id).sort()).toEqual(["a", "c"]);
  });

  it("manageCohortMember enrolls (supreme) and 404s an unknown cohort", async () => {
    h.tables.academy_cohorts = { data: { id: "c1", name: "June B2" }, error: null };
    h.tables.academy_cohort_members = { data: null, error: null }; // no existing membership → insert path
    const ok = (await run(buildAssistantTools(SUPREME), "manageCohortMember", { candidateUserId: "22222222-2222-2222-2222-222222222222", cohortId: "33333333-3333-3333-3333-333333333333", op: "enroll" })) as { ok?: boolean; cohortName?: string };
    expect(ok.ok).toBe(true);
    expect(ok.cohortName).toBe("June B2");
    h.tables.academy_cohorts = { data: null, error: null };
    expect(await run(buildAssistantTools(SUPREME), "manageCohortMember", { candidateUserId: "22222222-2222-2222-2222-222222222222", cohortId: "33333333-3333-3333-3333-333333333333", op: "enroll" })).toEqual({ error: "cohort_not_found" });
  });

  it("the new supreme-only tools reject a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "getAcademyOverview", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "listPendingSignatures", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "getFunnelStageCounts", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "editLead", { leadId: "44444444-4444-4444-4444-444444444444", name: "x" })).toEqual({ error: "admin_only" });
    // Wave 3
    expect(await run(t, "checkAvailability", { from: "2026-06-20T15:00:00", to: "2026-06-20T16:00:00" })).toEqual({ error: "admin_only" });
    expect(await run(t, "markAllThreadsRead", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "searchMessages", { q: "flight" })).toEqual({ error: "admin_only" });
    expect(await run(t, "listOrgMembers", { orgId: "55555555-5555-5555-5555-555555555555" })).toEqual({ error: "admin_only" });
    expect(await run(t, "getCandidateAccess", { candidateUserId: "66666666-6666-6666-6666-666666666666" })).toEqual({ error: "admin_only" });
    expect(await run(t, "getSubscriptionSummary", {})).toEqual({ error: "admin_only" });
  });

  it("wave-5 supreme-only tools reject a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "convertLead", { leadId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" })).toEqual({ error: "admin_only" });
    expect(await run(t, "createLeadsBatch", { leads: [{ name: "X" }] })).toEqual({ error: "admin_only" });
    expect(await run(t, "getPeriodComparison", { period: "week" })).toEqual({ error: "admin_only" });
  });

  it("convertLead mints an invite link and reports the lead", async () => {
    h.tables.leads = { data: { name: "Sara Alami", email: "sara@x.com" }, error: null };
    h.tables.invite_tokens = { data: null, error: null };
    const r = (await run(buildAssistantTools(SUPREME), "convertLead", { leadId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" })) as { url?: string; leadName?: string };
    expect(r.url).toMatch(/\/join\/candidate\//);
    expect(r.leadName).toBe("Sara Alami");
  });

  it("createLeadsBatch bulk-inserts (supreme)", async () => {
    h.tables.leads = { data: [{ id: "L1" }, { id: "L2" }], error: null };
    const r = (await run(buildAssistantTools(SUPREME), "createLeadsBatch", { leads: [{ name: "A" }, { name: "B", phone: "+212600" }] })) as { ok?: boolean; added?: number };
    expect(r.ok).toBe(true);
    expect(r.added).toBe(2);
  });

  it("getSubscriptionSummary reports stripe_not_configured without a key", async () => {
    const prev = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    expect(await run(buildAssistantTools(SUPREME), "getSubscriptionSummary", {})).toEqual({ error: "stripe_not_configured" });
    if (prev !== undefined) process.env.STRIPE_SECRET_KEY = prev;
  });

  it("listOrgMembers returns members joined to sub_admins (supreme), excluding the supreme admin", async () => {
    h.tables.organization_members = { data: [{ sub_admin_email: "x@org.com", role: "owner", created_at: "2026-01-01" }, { sub_admin_email: "admin@borivon.com", role: "owner", created_at: "2026-01-01" }], error: null };
    h.tables.sub_admins = { data: [{ email: "x@org.com", name: "Xavier", label: "Recruiter" }], error: null };
    const r = (await run(buildAssistantTools(SUPREME), "listOrgMembers", { orgId: "55555555-5555-5555-5555-555555555555" })) as { count: number; members: { email: string; name: string }[] };
    expect(r.count).toBe(1); // admin@borivon.com (the supreme admin) is filtered out
    expect(r.members[0]).toMatchObject({ email: "x@org.com", name: "Xavier · Recruiter" });
  });

  it("storeCandidateDocument translated:true files the _de variant", async () => {
    // Stage path needs a pending file; build tools with one attached.
    const tools = buildAssistantTools(SUPREME, { r2Key: "k", mime: "application/pdf", fileName: "diploma.pdf", sha256: "abc" });
    h.tables.candidate_profiles = { data: { first_name: "Sara", last_name: "A" }, error: null };
    h.tables.assistant_pending_actions = { data: { id: "p1" }, error: null };
    const r = (await run(tools, "storeCandidateDocument", { candidateUserId: "77777777-7777-7777-7777-777777777777", docKey: "diploma", translated: true })) as { staged?: boolean; summary?: string };
    expect(r.staged).toBe(true);
    // Filed under the diploma-TRANSLATION label (the _de variant is marked with a
    // German-translation tag — "(Allemand)" / "(German)" / "(Deutsch)" / "übersetzt").
    expect(r.summary ?? "").toMatch(/dipl/i);
    expect(r.summary ?? "").toMatch(/allemand|german|deutsch|übersetz|uebersetz|translat|traduit/i);
  });

  // ── Wave 4: broadcast + funnel/academy reports + reassign + anerkennung sync ──
  it("wave-4 supreme-only tools reject a sub-admin", async () => {
    const t = buildAssistantTools(ORG_ADMIN);
    expect(await run(t, "broadcastMessage", { text: "hi", by: "all" })).toEqual({ error: "admin_only" });
    expect(await run(t, "getConversionFunnel", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "getAcademyLevelCounts", {})).toEqual({ error: "admin_only" });
    expect(await run(t, "reassignCandidates", { fromSubAdminEmail: "a@x.com", toSubAdminEmail: "b@x.com" })).toEqual({ error: "admin_only" });
  });

  it("reassignCandidates rejects same-person and bad emails", async () => {
    const t = buildAssistantTools(SUPREME);
    expect(await run(t, "reassignCandidates", { fromSubAdminEmail: "a@x.com", toSubAdminEmail: "a@x.com" })).toEqual({ error: "same_person" });
    expect(await run(t, "reassignCandidates", { fromSubAdminEmail: "nope", toSubAdminEmail: "b@x.com" })).toEqual({ error: "bad_email" });
  });

  it("broadcastMessage requires a value for a non-'all' segment", async () => {
    expect(await run(buildAssistantTools(SUPREME), "broadcastMessage", { text: "hi", by: "batch" })).toEqual({ error: "value_required" });
  });

  it("archiveDocument soft-retires a doc (supreme); sub-admin blocked; needs_migration surfaced", async () => {
    h.tables.documents = { data: { user_id: "cand-x", file_name: "wrong.pdf", file_type: "Reisepass" }, error: null };
    // sub-admin can't
    expect(await run(buildAssistantTools(ORG_ADMIN), "archiveDocument", { docId: "88888888-8888-8888-8888-888888888888" })).toEqual({ error: "admin_only" });
    // supreme: the update returns no error → archived
    const ok = (await run(buildAssistantTools(SUPREME), "archiveDocument", { docId: "88888888-8888-8888-8888-888888888888" })) as { archived?: boolean };
    expect(ok.archived).toBe(true);
  });

  it("listCandidateDocuments hides archived (superseded_at) rows", async () => {
    h.tables.documents = { data: [
      { id: "d1", file_name: "good.pdf", file_type: "Reisepass", status: "approved", uploaded_at: "2026-01-02" },
      { id: "d2", file_name: "wrong.pdf", file_type: "Reisepass", status: "approved", uploaded_at: "2026-01-01", superseded_at: "2026-06-19T00:00:00Z" },
    ], error: null };
    const r = (await run(buildAssistantTools(SUPREME), "listCandidateDocuments", { candidateUserId: "99999999-9999-9999-9999-999999999999" })) as { documents: { docId: string }[] };
    expect(r.documents.map((d) => d.docId)).toEqual(["d1"]); // d2 archived → hidden
  });

  it("getAcademyLevelCounts tallies active members by level over the scoped roster", async () => {
    // SUPREME roster is built from authUsers; seed two candidates + their active levels.
    h.authUsers = [
      { id: "cand-a", email: "a@cand.com", user_metadata: { full_name: "Cand A" } },
      { id: "cand-b", email: "b@cand.com", user_metadata: { full_name: "Cand B" } },
    ];
    h.tables.candidate_profiles = { data: [{ user_id: "cand-a", first_name: "Cand", last_name: "A" }, { user_id: "cand-b", first_name: "Cand", last_name: "B" }], error: null };
    h.tables.academy_cohort_members = { data: [{ current_level: "B2", status: "active" }, { current_level: "A2", status: "active" }], error: null };
    const r = (await run(buildAssistantTools(SUPREME), "getAcademyLevelCounts", {})) as { atB2: number; belowB2: number; total: number };
    expect(r.atB2).toBe(1);
    expect(r.belowB2).toBe(1);
    expect(r.total).toBe(2);
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
