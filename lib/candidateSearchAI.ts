/**
 * The AI translator: plain language → a flat CandidateQuery filter.
 *
 * This is the ONLY place a model touches search, and it is deliberately powerless:
 * it never sees candidate data and never emits a candidate — it only fills a filter
 * that the deterministic compiler then runs over the real, scoped set. So the model
 * literally cannot hallucinate a person into the results. Its worst failure is a
 * wrong filter, which the founder sees echoed as chips and can correct.
 *
 * Reuses the shared brain (Gemini 2.5 Flash on Vertex-Frankfurt — EU/GDPR, and
 * Workers-safe via the /edge WebCrypto path in lib/vertexModel). Returns null on
 * ANY failure — not configured, timeout, bad JSON — so the caller falls back to the
 * keyword parser and the bar always works.
 */
import { generateText } from "ai";
import { vertexModel, GEMINI_SAFETY } from "@/lib/vertexModel";
import { sanitizeQuery, isEmptyQuery, extractFilterJson, type CandidateQuery } from "@/lib/candidateSearch";
import { B2_STAGES } from "@/lib/b2Journey";
import { FUNNEL_STAGE_KEYS } from "@/lib/batchBoard";
import { NURSE_SPECIALTIES } from "@/lib/nurseSpecialties";

const AI_TIMEOUT_MS = 7000;

/** The instruction the model fills. Built from the live enums so it never drifts. */
function buildSystemPrompt(nowMs: number): string {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const b2 = B2_STAGES.map((s) => s.key).join(" | ");
  const funnel = FUNNEL_STAGE_KEYS.join(" | ");
  const spec = NURSE_SPECIALTIES.map((s) => `${s.key} (${s.label.en})`).join(", ");
  return [
    "You convert a recruiter's plain-language search into a JSON filter for a database of nursing candidates (Morocco → Germany placement). You do NOT answer the question or name any candidate — you ONLY output the filter. Real candidates are selected by code from the filter.",
    `Today is ${today}. Convert every relative time to a whole number of days (\"last year\"→365, \"last month\"→30, \"next week\"→7, \"this week\"→7, \"tomorrow\"→2, \"today\"→1).`,
    "",
    'CLASSIFY FIRST. If the request asks ABOUT ONE specific candidate (what documents they are missing, what they still need, their next step, their current status) OR asks for a summary / \"what is new\" / \"what needs me today\", it is NOT a filter — respond with exactly {\"ask\":true} and nothing else. If instead it selects a GROUP of candidates by attributes (even when phrased as \"who has an interview next week\"), produce a filter as below.',
    "",
    "Output ONLY a JSON object — no prose, no markdown, no code fences. Include ONLY the fields the query actually constrains; omit everything else. Empty query → {}.",
    "",
    "Fields (all optional):",
    '  text (string): free-text name / keyword when the query is a person\'s name or something not covered below.',
    "  b2Certified (bool): holds the B2 certificate. b2CertifiedWithinDays (int): certificate obtained within the last N days.",
    `  b2Stage (string): one of ${b2}. b2Failed (bool): failed B2 at least once. b2ExamWithinDays (int): B2 exam within the next N days.`,
    "  interviewWithinDays (int): interview within the next N days. hasUpcomingInterview (bool). interviewPassed (bool).",
    `  funnelStage (string): one of ${funnel}. visaWithinDays (int): visa appointment within the next N days.`,
    `  specialty (string): one of ${spec}. minYearsExperience (int). workplacePref (string): altenheim | klinik | either. availableWithinDays (int).`,
    "  nationality (string), cityOfBirth (string), cityOfResidence (string), sex ('m'|'f'), maritalStatus (string).",
    "  passportPending (bool): passport awaiting review. passportStatus (string): approved | pending | rejected. passportExpired (bool): passport already lapsed (past). passportExpiringWithinDays (int): expiring within the next N days.",
    "  placementReady (bool), verified (bool), hasEmployer (bool), orgName (string).",
    "  signedUpWithinDays (int): registered within the last N days. inactiveForDays (int): no login for at least N days.",
    "  sortBy (string): recent | name | b2CertDate | interview | signup | experience. limit (int).",
    "",
    'Examples:',
    '  "candidates who got the B2 certificate in the last year" → {"b2Certified":true,"b2CertifiedWithinDays":365}',
    '  "who has an interview scheduled next week" → {"interviewWithinDays":7}',
    '  "moroccan ICU nurses with 3+ years waiting for visa" → {"nationality":"morocco","specialty":"intensive","minYearsExperience":3,"funnelStage":"passed"}',
    '  "everyone stuck at passport review" → {"passportPending":true}',
    '  "hajar" → {"text":"hajar"}',
    '  "what documents is Hajar missing" → {"ask":true}',
    '  "what is the next step for Yassine" → {"ask":true}',
    '  "what needs me today" → {"ask":true}',
  ].join("\n");
}

/** The model either produces a list FILTER or classifies the query as an ASK
 *  (a question about a specific candidate / a summary), which the caller routes to
 *  the answer assistant instead of the deterministic compiler. */
export type ParsedQuery = { mode: "filter"; filter: CandidateQuery } | { mode: "ask" };

/**
 * Translate a query with the model. Returns the classified filter/ask, or null to
 * signal "use the keyword fallback" (list mode). Never throws.
 */
export async function parseQueryWithAI(query: string, nowMs: number): Promise<ParsedQuery | null> {
  const text = (query || "").trim();
  if (!text) return null;
  const model = vertexModel("flash");
  if (!model) return null; // no brain configured → keyword fallback

  try {
    const gen = generateText({
      model,
      system: buildSystemPrompt(nowMs),
      prompt: text.slice(0, 500),
      temperature: 0,
      maxOutputTokens: 400,
      maxRetries: 1,
      providerOptions: { vertex: { safetySettings: GEMINI_SAFETY }, google: { safetySettings: GEMINI_SAFETY } },
    });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS));
    const result = await Promise.race([gen, timeout]);
    if (!result) return null; // timed out
    const obj = extractFilterJson(result.text ?? "");
    if (!obj) return null;
    // The model classified this as a question about a specific candidate / a summary.
    if (obj.ask === true || obj.intent === "ask") return { mode: "ask" };
    const q = sanitizeQuery(obj);
    // An AI reply that sanitizes to nothing is indistinguishable from a parse miss;
    // let the keyword parser have a go rather than silently "show everyone".
    return isEmptyQuery(q) && !q.text ? null : { mode: "filter", filter: q };
  } catch {
    return null;
  }
}
