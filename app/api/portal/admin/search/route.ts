import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { resolveAssistantScope } from "@/lib/assistantScope";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { assembleSearchableCandidateSet } from "@/lib/candidateSearchData";
import { compileCandidateQuery, describeQuery, keywordParseQuery, isEmptyQuery, type CandidateQuery } from "@/lib/candidateSearch";
import { parseQueryWithAI, type ParsedQuery } from "@/lib/candidateSearchAI";
import { answerCandidateQuestion } from "@/lib/adminAssistant";

/**
 * NATURAL-LANGUAGE CANDIDATE SEARCH — POST /api/portal/admin/search
 *
 * Body: { query: string, lang?: "en"|"fr"|"de" }
 *
 * The founder types plain language; this returns REAL candidates. Grounding is
 * structural: the model only fills a filter (parseQueryWithAI), and the candidates
 * come out of compileCandidateQuery running over the actual, org-scoped set
 * (assembleSearchableCandidates). The model never sees a candidate and never emits
 * one — so it can't hallucinate a person into the results.
 *
 * Scope: resolveAssistantScope → assemble already limits the set to what this admin
 * may see (LAW #25). A scoped-out caller searches an empty set, never a wider one.
 *
 * Degradation: no model / a timeout / unparseable output all fall back to the
 * keyword parser, so the bar always answers. PII stays home — only the typed query
 * ever reaches the model, never candidate data.
 *
 * "Always answers" never meant "always says a number". A failed read is reported
 * as 503 { ok:false, code:"READ_FAILED", matched:null, total:null } — the same
 * contract /api/portal/phase-slots uses — because the alternative, which this
 * route shipped, was a 200 carrying results:[] and matched:0: the bar told the
 * founder in a calm voice that nobody matched, when the truth was that the
 * candidate directory had not loaded. Unknown is not empty, and a count that was
 * never taken is null, not zero.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 60s: list mode is fast, but ask mode runs a multi-step read-only tool loop.
export const maxDuration = 60;

const LANGS = new Set(["en", "fr", "de"]);

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const rawQuery = typeof body.query === "string" ? body.query.trim() : "";
  const lang = typeof body.lang === "string" && LANGS.has(body.lang) ? body.lang : "en";
  if (rawQuery.length > 500) return NextResponse.json({ error: "Query too long" }, { status: 400 });

  // The search runs the model AND a full candidate assembly, so cap it — 30/min per
  // admin is generous for typing yet stops a runaway loop from burning Vertex spend.
  const gate = await enforceUserRateLimit("candidate-search", auth.userId, { limit: 30, windowMs: 60_000 });
  if (!gate.ok) return NextResponse.json({ error: "Too many searches — give it a moment." }, { status: 429 });

  // Belt-and-suspenders: the assembler already guards every read internally and the
  // parser never throws, but a search must NEVER 500 (the founder's alarm channel is
  // muted — a broken search must degrade, not error). Any unexpected throw returns a
  // clean "temporarily unavailable" the bar can show.
  try {
    const scope = await resolveAssistantScope(auth);
    const nowMs = Date.now();

    // Assemble the scoped set + classify the query concurrently. For a filter this
    // overlaps the slow assembly with the model call; if the model instead
    // classifies it as an ASK, the assembled set is simply unused (ask is heavier
    // anyway). The default (blank query) is a filter that shows everyone.
    const [set, parsed] = await Promise.all([
      assembleSearchableCandidateSet(scope),
      rawQuery ? parseQueryWithAI(rawQuery, nowMs) : Promise.resolve<ParsedQuery | null>({ mode: "filter", filter: {} }),
    ]);
    const candidates = set.candidates;

    // The set is a FLOOR, not the roster: the directory read did not finish.
    // Filtering it would produce a number, and the bar would present that
    // number as the answer — "no candidates match" said in the same calm voice
    // it uses when that is true. A failed read is not a result, so it does not
    // get rendered as one; the client shows "couldn't check" plus a retry.
    // 503 (not 200) so no caller can mistake it for an answer by status alone.
    if (!set.ok) {
      return NextResponse.json({
        ok: false,
        mode: "list",
        code: "READ_FAILED",
        error: "Couldn't check who matches — the candidate list didn't load.",
        results: [], filter: [], matched: null, total: null, usedAI: false, empty: false,
      }, { status: 503 });
    }

    // ── ASK MODE — a question about a specific candidate / a summary. The read-only
    // assistant answers in prose, grounded in real tool reads (it can change nothing).
    if (parsed?.mode === "ask") {
      const ans = await answerCandidateQuestion(scope, rawQuery, lang, nowMs);
      if (!("error" in ans)) {
        return NextResponse.json({ ok: true, mode: "ask", answer: ans.answer, candidates: ans.candidates });
      }
      // Classifier said "question" but the assistant couldn't run (no model / failure)
      // → fall back to a plain candidate search so the bar still returns something.
      const q = keywordParseQuery(rawQuery);
      const r = compileCandidateQuery(q, candidates, nowMs, lang);
      return NextResponse.json({ ok: true, mode: "list", usedAI: false, empty: isEmptyQuery(q), filter: describeQuery(q, lang), results: r.hits, matched: r.matched, total: r.total });
    }

    // ── LIST MODE — deterministic filter → real candidates.
    const query: CandidateQuery = parsed?.mode === "filter" ? parsed.filter : (rawQuery ? keywordParseQuery(rawQuery) : {});
    const usedAI = parsed?.mode === "filter";
    const { hits, matched, total } = compileCandidateQuery(query, candidates, nowMs, lang);

    return NextResponse.json({
      ok: true,
      mode: "list",
      usedAI,
      empty: isEmptyQuery(query),
      filter: describeQuery(query, lang),
      results: hits,
      matched,
      total,
    });
  } catch (e) {
    console.error("[candidate-search] unexpected failure:", e instanceof Error ? e.message : e);
    // Was 200 with matched:0, total:0, empty:true — a crash dressed as a
    // finished search that found nobody. Same shape, same 503, same retry.
    // matched/total are null, not 0: nothing was counted, so there is no count.
    return NextResponse.json(
      { ok: false, mode: "list", code: "READ_FAILED", error: "Search is temporarily unavailable — try again.", results: [], filter: [], matched: null, total: null, usedAI: false, empty: false },
      { status: 503 },
    );
  }
}
