import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { scoreRoadmap } from "@/lib/roadmap/score";
import { renderRoadmapPdf } from "@/lib/roadmap/pdf";
import { LANGS, type Lang } from "@/lib/roadmap/content";

/**
 * GET /api/roadmap/sample?lang=de — an example Fahrplan for a made-up care home,
 * so visitors (and the founder) can see what they get before they answer.
 * Clearly labelled as an example on the cover; no personal data involved.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "roadmap-sample", { limit: 20, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
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
      "cache-control": "public, max-age=3600",
    },
  });
}
