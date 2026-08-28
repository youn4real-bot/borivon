/**
 * PURE, dependency-light core for the read-only in-app assistant: the read/write
 * tool-name catalogs and the candidate-id collector. Kept free of the heavy
 * buildAssistantTools import so the invariants here (read ∩ write = ∅, id
 * harvesting) are unit-testable without loading the whole tool layer.
 */
import { UUID_RE } from "@/lib/uuid";

/** Pure-read tools the dashboard assistant may call. Every name verified read-only. */
export const ASSISTANT_READ_TOOLS: readonly string[] = [
  // find / identity / dossier
  "searchCandidates", "listAllCandidates", "getCandidateById", "getCandidateDossier",
  "getCandidatePipeline", "getCandidatePhone", "getNurseProfile", "getCandidateAccess",
  // documents & what's MISSING (the core "what does X still need")
  "getCandidateChecklist", "listCandidateDocuments", "listCandidateCVs",
  "findDocumentsAcrossCandidates", "getVaccineStatus", "readCvDraft",
  "getCandidateSlotStatus", "listSignRequests", "listPendingSignatures", "listExpiringPassports",
  // B2 language status
  "getB2Status", "getB2Overview", "listB2ExamsDue",
  // pipeline / funnel / cohorts / lists ("who is at stage X")
  "listCandidatesByFunnelStage", "listCandidatesIn", "listCandidatesByProfile",
  "getPipelineBoard", "getFunnelStageCounts", "listStuckCandidates", "listCriticalDates",
  "listRecentSignups", "listStalledSignups", "listAssignedTasks", "getAcademyStanding",
  // notes (read) + light reports + "what's new / updates"
  "listCandidateNotes", "getFunnelSnapshot", "getConversionFunnel", "getTodayBriefing",
] as const;

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
