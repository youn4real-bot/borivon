import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { resolveAssistantScope } from "@/lib/assistantScope";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { assembleSearchableCandidateSet } from "@/lib/candidateSearchData";
import { buildFacets, sanitizeSelection } from "@/lib/adminFacets";

/**
 * ADVANCED FILTERS — POST /api/portal/admin/facets
 * Body: { selection?: Record<string,string[]>, lang?: "en"|"fr"|"de" }
 *
 * Deterministic Booking.com-style faceted search (no AI). Returns the full facet
 * catalog with LIVE per-option counts + the matching candidates. Runs over the
 * already-org-scoped set (assembleSearchableCandidateSet, LAW #25). Never 500s.
 *
 * It does answer 503 { ok:false, code:"READ_FAILED" } when the candidate set is
 * UNKNOWN rather than empty. It used to answer ok:true with every count at zero,
 * which reads as "no candidate fits any of these filters" — a statement about
 * 93 nurses that nothing had actually checked.
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

  const lang = typeof body.lang === "string" && LANGS.has(body.lang) ? body.lang : "en";
  const selection = sanitizeSelection(body.selection);

  const gate = await enforceUserRateLimit("admin-facets", auth.userId, { limit: 90, windowMs: 60_000 });
  if (!gate.ok) return NextResponse.json({ error: "Too many filters — give it a moment." }, { status: 429 });

  try {
    const scope = await resolveAssistantScope(auth);
    const set = await assembleSearchableCandidateSet(scope);
    // Counting a floor produces per-option counts that are all wrong and a
    // "0 candidates" headline that is not an answer. Every facet would read
    // zero and the founder would conclude nobody fits — see the search route.
    if (!set.ok) {
      return NextResponse.json({
        ok: false, code: "READ_FAILED",
        error: "Couldn't load the filters — the candidate list didn't load.",
        groups: [], results: [], total: null, shown: null,
      }, { status: 503 });
    }
    const result = buildFacets(set.candidates, selection, Date.now(), lang);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[admin-facets] failed:", e instanceof Error ? e.message : e);
    // This said ok:TRUE over a crash, with total:0 — the filter panel drew
    // itself empty and called that the result. Nothing was counted, so the
    // totals are null rather than 0, and the status says unknown.
    return NextResponse.json({
      ok: false, code: "READ_FAILED",
      error: "Couldn't load the filters — try again.",
      groups: [], results: [], total: null, shown: null,
    }, { status: 503 });
  }
}
