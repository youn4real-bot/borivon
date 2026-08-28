import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { resolveAssistantScope } from "@/lib/assistantScope";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { assembleSearchableCandidates } from "@/lib/candidateSearchData";
import { compileCandidateQuery, describeQuery, keywordParseQuery, isEmptyQuery, type CandidateQuery } from "@/lib/candidateSearch";
import { parseQueryWithAI } from "@/lib/candidateSearchAI";

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
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

    // Assemble the scoped set + translate the query concurrently — they're independent
    // and the assembly (auth walk + joins) is the slow part, so overlap them.
    const [candidates, aiQuery] = await Promise.all([
      assembleSearchableCandidates(scope),
      rawQuery ? parseQueryWithAI(rawQuery, nowMs) : Promise.resolve<CandidateQuery | null>({}),
    ]);

    // AI first; keyword fallback when the model produced nothing usable.
    let query: CandidateQuery;
    let usedAI: boolean;
    if (aiQuery) { query = aiQuery; usedAI = true; }
    else { query = rawQuery ? keywordParseQuery(rawQuery) : {}; usedAI = false; }

    const { hits, matched, total } = compileCandidateQuery(query, candidates, nowMs, lang);

    return NextResponse.json({
      ok: true,
      usedAI,
      empty: isEmptyQuery(query),
      filter: describeQuery(query, lang),
      results: hits,
      matched,
      total,
    });
  } catch (e) {
    console.error("[candidate-search] unexpected failure:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { ok: false, error: "Search is temporarily unavailable — try again.", results: [], filter: [], matched: 0, total: 0, usedAI: false, empty: true },
      { status: 200 },
    );
  }
}
