/**
 * PURE, dependency-light core for the read-only in-app assistant: the read/write
 * tool-name catalogs and the candidate-id collector. Kept free of the heavy
 * buildAssistantTools import so the invariants here (read ∩ write = ∅, id
 * harvesting) are unit-testable without loading the whole tool layer.
 */
import { UUID_RE } from "@/lib/uuid";

// The read allowlist is PARTITIONED by scope, because "read-only" is not the same
// as "in-scope". Some read tools take a candidateUserId and gate on THAT candidate
// (canActOnCandidate / scope.inScope) — safe for anyone. Others read ACROSS the
// roster or aggregate globally — safe only for a caller who legitimately sees ALL
// candidates. A bounded org-admin who got a roster/briefing read would receive
// out-of-scope names + PII in the answer prose (a real LAW #25 leak found in review).

/** Per-candidate reads — each gates on the specific candidate, so safe for ANY admin. */
export const CANDIDATE_SCOPED_READ_TOOLS: readonly string[] = [
  "searchCandidates",          // resolves a name → id via the SCOPED roster (in-scope only)
  "getCandidateById", "getCandidateDossier", "getCandidatePipeline", "getCandidatePhone",
  "getNurseProfile", "getCandidateAccess", "getCandidateChecklist", "listCandidateDocuments",
  "listCandidateCVs", "getVaccineStatus", "readCvDraft", "getCandidateSlotStatus",
  "getB2Status", "listCandidateNotes", "getAcademyStanding",
] as const;

/** Roster / aggregate reads — exposed ONLY to callers who see every candidate
 *  (scope.visibleIds === null: supreme admin / HQ sub-admin). */
export const GLOBAL_READ_TOOLS: readonly string[] = [
  "listAllCandidates", "findDocumentsAcrossCandidates", "listExpiringPassports",
  "listCandidatesByFunnelStage", "listCandidatesIn", "listCandidatesByProfile",
  "getPipelineBoard", "getFunnelStageCounts", "getFunnelSnapshot", "getConversionFunnel",
  "listStuckCandidates", "listCriticalDates", "listRecentSignups", "listStalledSignups",
  "listAssignedTasks", "listSignRequests", "listPendingSignatures",
  "getB2Overview", "listB2ExamsDue",
] as const;

/** Reads exposed to the SUPREME admin only. getTodayBriefing additionally surfaces
 *  the founder's own Google calendar, so it never goes to any sub-admin. */
export const SUPREME_ONLY_READ_TOOLS: readonly string[] = ["getTodayBriefing"] as const;

/** The full union — used by the read ∩ write disjointness test. */
export const ASSISTANT_READ_TOOLS: readonly string[] = [
  ...CANDIDATE_SCOPED_READ_TOOLS, ...GLOBAL_READ_TOOLS, ...SUPREME_ONLY_READ_TOOLS,
];

/**
 * The read tools a given scope may use. A bounded org-admin (visibleIds is an
 * array) gets ONLY per-candidate tools; a caller who sees all candidates also gets
 * the roster/aggregate reads; only the supreme admin gets the daily briefing.
 */
export function readToolKeysForScope(scope: { role: string; visibleIds: string[] | null }): string[] {
  const keys = [...CANDIDATE_SCOPED_READ_TOOLS];
  if (scope.visibleIds === null) keys.push(...GLOBAL_READ_TOOLS);
  if (scope.role === "admin") keys.push(...SUPREME_ONLY_READ_TOOLS);
  return keys;
}

/**
 * Every tool that mutates (staged confirm-first writes + immediate writes + external
 * side-effects). Used ONLY by the test that asserts the read allowlist never
 * intersects it — a tripwire against a future edit dropping a write name into reads.
 */
export const WRITE_TOOL_NAMES: readonly string[] = [
  // immediate writes (mutate inside execute)
  "addCandidateNote", "setWorkplacePreference", "deleteCandidateNote", "setTestAccount",
  "saveReminder", "completeReminder", "updateReminder", "clearReminders", "bulkSnoozeReminders",
  "rememberAboutMe", "editRule", "forgetMemory", "setLeadStatus", "editLead", "convertLead",
  "createLeadsBatch", "markThreadRead", "markAllThreadsRead", "cancelSlotRequest", "inviteSubAdmin",
  "reassignCandidates", "manageCohortMember", "archiveDocument", "createCandidateInviteLink",
  "mirrorCandidateDocsToDrive", "syncCandidatesSheet", "cleanSheetHeaders", "upgradeSheetFromUrl",
  // staged confirm-first writes
  "setInterviewResult", "setInterviewDate", "setCandidateMilestone", "setB2Status",
  "sendCandidateMessage", "createLead", "deleteLead", "broadcastMessage", "storeCandidateDocument",
  "setAnerkennungStage", "setNurseProfile", "sendFollowUpNudge", "manageJourneyItem",
  "reviewDocument", "editCandidateProfileField", "setPassportDataStatus", "rotateDocument",
  "editCvDraft", "setCvBrandingMode", "sendExternalEmail", "replyToEmail", "forwardEmail",
  "saveDraft", "sendDraft", "sendCalendarInvite", "generateAndPublishCv", "assignEmployer",
  "upsertEmployer", "linkCandidateToOrg", "nudgeStuckCandidates", "setAgencyProfile",
  "reviewOrgRequest", "decideSuggestedMatch", "manageOrganization", "setOrgBranding",
  "manageOrgRequirement", "sendSlotRequest", "reviewSignRequest", "manageSubAdmin",
  "assignCandidate", "setCandidateVerified", "manageOrgMember", "createCalendarEvent",
  "bookCalendarEvent", "confirmPendingWrite", "cancelPendingWrite", "setAutomation",
  "setQuietMode", "stopFollowup", "resolveCommitment", "toggleStageLock", "deleteOrganization",
  "uploadOrgLogo", "deleteCandidateAccount", "setAcademyLevel", "manageBatch", "setFunnelStage",
  "rescheduleCalendarEvent", "cancelMyCalendarEvent", "cancelMyCalendarEventsInWindow",
  "deleteCalendarEvent", "resendEmail",
] as const;

/**
 * Harvest every candidateUserId the turn actually touched — from tool CALL args
 * (readers take candidateUserId as input) AND tool RESULTS (list/search tools echo
 * candidateUserId). Scans ONLY the `candidateUserId` key, so it never picks up the
 * admin's own id or unrelated user ids. Pure.
 */
export function collectCandidateIds(result: unknown): string[] {
  const ids = new Set<string>();
  const scan = (obj: unknown, depth: number): void => {
    if (!obj || depth > 5) return;
    if (Array.isArray(obj)) { for (const x of obj) scan(x, depth + 1); return; }
    if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (k === "candidateUserId" && typeof v === "string" && UUID_RE.test(v)) ids.add(v);
        else scan(v, depth + 1);
      }
    }
  };
  const steps = (result as { steps?: unknown[] })?.steps ?? [];
  for (const step of steps) {
    const s = step as { toolCalls?: unknown[]; toolResults?: unknown[] };
    for (const c of s.toolCalls ?? []) scan((c as { input?: unknown; args?: unknown }).input ?? (c as { args?: unknown }).args, 0);
    for (const r of s.toolResults ?? []) scan((r as { output?: unknown; result?: unknown }).output ?? (r as { result?: unknown }).result, 0);
  }
  return [...ids];
}
