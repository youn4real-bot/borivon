/**
 * IN-APP ADMIN ASSISTANT (ask-mode) — the grounded answer path of the smart bar.
 *
 * When the founder asks ABOUT a candidate ("what document is missing on Hajar now
 * that she passed the 2nd interview?", "what's the next step for X?", "what's new
 * this week?"), this runs the Telegram bot's proven brain — but with a hard
 * READ-ONLY tool subset (lib/adminAssistantTools) so it can look anything up and
 * change NOTHING. Every fact in the answer came from a real tool reading the real
 * DB; the model reasons over those facts, it does not invent them.
 *
 * Scope (LAW #25): the tools close over `scope`, so a sub-admin's assistant only
 * ever reads their own candidates. Names in the answer resolve to clickable cards
 * only for candidate ids the caller may actually see.
 */
import { generateText, stepCountIs } from "ai";
import { vertexModel, GEMINI_SAFETY } from "@/lib/vertexModel";
import { buildReadOnlyAssistantTools } from "@/lib/adminAssistantTools";
import { collectCandidateIds } from "@/lib/assistantReadOnly";
import type { AssistantScope } from "@/lib/assistantScope";
import { resolveAuthNames } from "@/lib/admin-auth";

export type AnswerResult = { answer: string; candidates: { uid: string; name: string }[] };

// Under the route's maxDuration=60 with headroom for the fallback list search.
const ASK_TIMEOUT_MS = 45_000;

function systemPrompt(nowMs: number, lang: string): string {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const language = lang === "fr" ? "French" : lang === "de" ? "German" : "English";
  return [
    "You are Borivon's in-app assistant for the admin dashboard (Borivon places Moroccan nurses in Germany).",
    "You ANSWER questions about candidates using the read tools — you cannot change anything.",
    `Today is ${today}. Reply in ${language}, in plain text (NO markdown, no ** or #), short and direct.`,
    "",
    "RULES:",
    "- Ground every claim in a tool result. NEVER invent a candidate, a document, a date, or a status. If a tool returns nothing, say you couldn't find it.",
    "- To answer 'what is missing' / 'what does X still need', call getCandidateChecklist (it lists missing/pending/rejected documents from real records) and combine with getCandidateDossier / getCandidatePipeline for their current stage.",
    "- If a name matches more than one candidate, ask which one — do not guess.",
    "- For 'what's new' / 'updates' / 'what needs me', use getTodayBriefing.",
    "- Be concise: answer the question, list the specific items, stop.",
  ].join("\n");
}

/**
 * Answer one candidate question. Returns the text + the candidates it touched (for
 * clickable cards), or an error string the caller surfaces.
 */
export async function answerCandidateQuestion(
  scope: AssistantScope,
  question: string,
  lang: string,
  nowMs: number,
): Promise<AnswerResult | { error: string }> {
  const q = (question || "").trim();
  if (!q) return { error: "empty" };
  const model = vertexModel("flash");
  if (!model) return { error: "assistant_unconfigured" };

  // HARD wall-clock cap, comfortably under the route's maxDuration=60. Without it a
  // stalled model or a long 10-step tool loop would run past the platform limit and
  // the request would be KILLED (504 / dead spinner) — the route's ask→list fallback
  // only fires when this returns {error}. On timeout we abort the underlying call so
  // it stops eating a worker, then the caller degrades to a plain list search.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ASK_TIMEOUT_MS);
  let result;
  try {
    result = await generateText({
      model,
      system: systemPrompt(nowMs, lang),
      prompt: q.slice(0, 800),
      tools: buildReadOnlyAssistantTools(scope),
      temperature: 0.3,
      maxOutputTokens: 3072,
      maxRetries: 1,
      stopWhen: stepCountIs(10),
      abortSignal: ac.signal,
      providerOptions: { vertex: { safetySettings: GEMINI_SAFETY }, google: { safetySettings: GEMINI_SAFETY } },
    });
  } catch (e) {
    console.error("[admin-assistant] generateText failed:", e instanceof Error ? e.message : e);
    return { error: ac.signal.aborted ? "assistant_timeout" : "assistant_failed" };
  } finally {
    clearTimeout(timer);
  }

  const answer = (result.text || "").trim();
  // Resolve touched candidates to clickable cards — but ONLY those in scope.
  const touched = collectCandidateIds(result).filter((id) => scope.inScope(id));
  let candidates: { uid: string; name: string }[] = [];
  if (touched.length) {
    try {
      const names = await resolveAuthNames(touched);
      candidates = touched.slice(0, 12).map((uid) => ({ uid, name: names[uid]?.name || names[uid]?.email || uid }));
    } catch { /* names are a nicety — never fail the answer over them */ }
  }
  return { answer: answer || "—", candidates };
}
