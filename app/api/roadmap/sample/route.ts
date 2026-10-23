import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { scoreRoadmap } from "@/lib/roadmap/score";
import { renderRoadmapPdf } from "@/lib/roadmap/pdf";
import { LANGS, type Lang } from "@/lib/roadmap/content";

/**
 * GET /api/roadmap/sample?lang=de — an example Fahrplan for a made-up care
 * home. ADMIN ONLY since 2026-10-23: the founder wants the plan to be reached
 * ONLY through the email (every reader is a captured lead), so the public
 * "see an example" link is gone and this answers 401 to everyone else.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const q = req.nextUrl.searchParams.get("lang");
  const lang: Lang = LANGS.includes(q as Lang) ? (q as Lang) : "de";
  const result = scoreRoadmap({
    facilityType: "care_home", staff: 42, openPosts: 4, leftLastYear: 6,
    agency: "mid", foreign: "tried_left", onboarding: ["plan"], pain: "leaving",
  });
  const label = lang === "de" ? "Beispiel: Seniorenzentrum Am Park" : lang === "fr" ? "Exemple : Résidence du Parc" : "Example: Park Care Home";
  const pdf = await renderRoadmapPdf({ result, lang, firstName: "Beispiel", facility: label, date: new Date() });
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Borivon-Fahrplan-Beispiel.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
