/**
 * Build the FILTERED read-only tool object for the in-app dashboard assistant.
 *
 * The Telegram bot's buildAssistantTools() exposes ~180 tools, many of which MUTATE
 * data. Two facts make an allowlist (not a denylist) the only safe design:
 *   • ~24 tools write directly inside execute() — withholding scope.requestId does
 *     NOT stop them (that gate only covers the ~55 confirm-first "staged" writes).
 *   • staged rows are keyed by scope.userId, so a write staged here could later be
 *     confirmed by that same admin in Telegram.
 * So the dashboard bar gets an EXPLICIT keep-list (lib/assistantReadOnly). Anything
 * new added to buildAssistantTools defaults to EXCLUDED until deliberately listed;
 * the read ∩ write disjointness is asserted in tests/adminAssistant.test.ts.
 */
import { buildAssistantTools } from "@/lib/assistantTools";
import type { AssistantScope } from "@/lib/assistantScope";
import { readToolKeysForScope } from "@/lib/assistantReadOnly";

export { ASSISTANT_READ_TOOLS, WRITE_TOOL_NAMES } from "@/lib/assistantReadOnly";

/**
 * Instantiate the full tool set (each tool still closes over `scope`, so
 * per-candidate access stays gated by canActOnCandidate / scope.inScope — LAW #25),
 * then keep only the read tools this scope is allowed. readToolKeysForScope gives a
 * bounded org-admin ONLY per-candidate tools; roster/aggregate reads and the daily
 * briefing are withheld unless the caller sees all candidates (defence against a
 * roster read leaking out-of-scope PII into an answer).
 */
export function buildReadOnlyAssistantTools(scope: AssistantScope) {
  const all = buildAssistantTools(scope) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of readToolKeysForScope(scope)) {
    if (all[key]) out[key] = all[key];
  }
  return out as ReturnType<typeof buildAssistantTools>;
}
