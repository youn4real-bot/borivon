/**
 * Assistant scope — resolved ONCE per request from the authenticated admin, then
 * frozen into every assistant tool's closure so a tool can never widen what the
 * caller may see (LAW #25). The Gemini model chooses WHICH tool to call and fills
 * the args; this object is the gate that decides what those calls are allowed to
 * touch — the model can ask for any candidate id, but `inScope` / canActOnCandidate
 * is the authority.
 */
import { getVisibleCandidateIds, type AdminAuthResult } from "@/lib/admin-auth";

export type AssistantScope = {
  role: "admin" | "sub_admin";
  email: string;
  userId: string;
  /** null = sees ALL candidates (supreme admin / HQ sub-admin); array = only these ids; [] = locked out. */
  visibleIds: string[] | null;
  /** True iff the caller may see this candidate (cheap pre-filter; canActOnCandidate is the per-action gate). */
  inScope: (candidateUserId: string) => boolean;
  /**
   * A per-inbound-message token (set by the webhook / in-app route once per
   * request). The confirm-first machine stamps it onto a staged action and
   * REFUSES to execute that action within the SAME request — so a model can
   * never stage AND confirm a write in one turn (e.g. driven by injected text
   * in a candidate's data). Confirmation must arrive in a later admin message.
   */
  requestId?: string;
};

export async function resolveAssistantScope(
  auth: Extract<AdminAuthResult, { ok: true }>,
): Promise<AssistantScope> {
  // Supreme admin sees all — short-circuit the DB lookup. Everyone else goes
  // through getVisibleCandidateIds, which fails CLOSED (returns [] on a blip).
  const visibleIds = auth.role === "admin" ? null : await getVisibleCandidateIds(auth.email);
  const idSet = visibleIds === null ? null : new Set(visibleIds);
  return {
    role: auth.role,
    email: auth.email,
    userId: auth.userId,
    visibleIds,
    inScope: (candidateUserId: string) =>
      idSet === null ? true : (!!candidateUserId && idSet.has(candidateUserId)),
  };
}
