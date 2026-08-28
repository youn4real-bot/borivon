import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { resolveAssistantScope } from "@/lib/assistantScope";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { assembleSearchableCandidates } from "@/lib/candidateSearchData";
import { computeNeeds } from "@/lib/needsPanel";

/**
 * "NEEDS YOU" — GET /api/portal/admin/needs?lang=en|fr|de
 *
 * The proactive triage panel: everything across the admin's candidates that needs
 * attention, grouped + clickable, computed the moment the dashboard loads — so the
 * founder stops searching and guessing.
 *
 * Grounded + scoped: it runs over assembleSearchableCandidates(scope), the same
 * already-org-scoped set the search uses (LAW #25), then computeNeeds derives the
 * groups purely. Never 500s — any failure returns an empty panel.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LANGS = new Set(["en", "fr", "de"]);

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const langParam = req.nextUrl.searchParams.get("lang");
  const lang = langParam && LANGS.has(langParam) ? langParam : "en";

  // Cheap guard — the assembly walks auth users + joins; cap polling.
  const gate = await enforceUserRateLimit("admin-needs", auth.userId, { limit: 40, windowMs: 60_000 });
  if (!gate.ok) return NextResponse.json({ ok: true, groups: [], total: 0 });

  try {
    const scope = await resolveAssistantScope(auth);
    const candidates = await assembleSearchableCandidates(scope);
    const { groups, total } = computeNeeds(candidates, Date.now(), lang);
    return NextResponse.json({ ok: true, groups, total });
  } catch (e) {
    console.error("[admin-needs] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: true, groups: [], total: 0 });
  }
}
