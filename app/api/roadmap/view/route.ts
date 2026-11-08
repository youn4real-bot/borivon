import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { verifyLeadToken } from "@/lib/roadmap/token";
import { parseDetails } from "@/lib/roadmap/leadState";
import { getHosted, pdfLinks, fileName, type HostedDoc } from "@/lib/roadmap/hosted";
import { LANGS, type Lang } from "@/lib/roadmap/content";

/**
 * GET /api/roadmap/view?id=&t=[&doc=bonus][&links=1][&dl=1]
 * The Fahrplan on the website (borivon.com/fahrplan/plan): the PDF inline,
 * `links=1` → its clickable areas as JSON, `dl=1` → as a download.
 * Signed personal link only, and only after the double opt-in.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "roadmap-view", { limit: 120, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id") ?? "", t = sp.get("t") ?? "";
  if (!(await verifyLeadToken("view", id, t))) return NextResponse.json({ error: "invalid_link" }, { status: 403 });
  const db = getServiceSupabase();
  const { data } = await db.from("leads").select("id,details").eq("id", id).eq("kind", "roadmap").maybeSingle();
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const d = parseDetails((data as { details: unknown }).details);
  if (d.anonymizedAt || !d.consent?.confirmedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const doc: HostedDoc = sp.get("doc") === "bonus" ? "bonus" : "plan";
  const bytes = await getHosted(id, d, doc);
  if (sp.get("links") === "1") {
    return NextResponse.json({ links: await pdfLinks(bytes) }, { headers: { "Cache-Control": "private, max-age=300" } });
  }
  const lang: Lang = LANGS.includes(d.lang as Lang) ? (d.lang as Lang) : "de";
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${sp.get("dl") === "1" ? "attachment" : "inline"}; filename="${fileName(doc, lang)}"`,
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
