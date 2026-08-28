import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { resolveAssistantScope } from "@/lib/assistantScope";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { assembleSearchableCandidates } from "@/lib/candidateSearchData";
import { buildFacets, sanitizeSelection } from "@/lib/adminFacets";

/**
 * ADVANCED FILTERS — POST /api/portal/admin/facets
 * Body: { selection?: Record<string,string[]>, lang?: "en"|"fr"|"de" }
 *
 * Deterministic Booking.com-style faceted search (no AI). Returns the full facet
 * catalog with LIVE per-option counts + the matching candidates. Runs over the
 * already-org-scoped set (assembleSearchableCandidates, LAW #25). Never 500s.
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
    const candidates = await assembleSearchableCandidates(scope);
    const result = buildFacets(candidates, selection, Date.now(), lang);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[admin-facets] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: true, groups: [], results: [], total: 0, shown: 0 });
  }
}
