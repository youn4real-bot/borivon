import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { verifyLeadToken } from "@/lib/roadmap/token";
import { parseDetails } from "@/lib/roadmap/leadState";
import { linkPage } from "@/lib/roadmap/linkPage";

/**
 * Unsubscribe from the Fahrplan tips. GET = the link in the mail; POST = the
 * mail client's one-click button (List-Unsubscribe-Post). Either way the series
 * stops for good.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function unsubscribe(req: NextRequest): Promise<{ ok: boolean; lang: string }> {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const t = req.nextUrl.searchParams.get("t") ?? "";
  if (!(await verifyLeadToken("unsub", id, t))) return { ok: false, lang: "de" };
  const db = getServiceSupabase();
  const { data } = await db.from("leads").select("id,details").eq("id", id).eq("kind", "roadmap").maybeSingle();
  if (!data) return { ok: false, lang: "de" };
  const d = parseDetails((data as { details: unknown }).details);
  const lang = d.lang === "fr" || d.lang === "en" ? d.lang : "de";
  if (!d.unsubscribedAt) {
    const { error } = await db.from("leads").update({ details: { ...d, unsubscribedAt: new Date().toISOString() } }).eq("id", id);
    if (error) return { ok: false, lang };
  }
  return { ok: true, lang };
}

export async function GET(req: NextRequest) {
  const r = await unsubscribe(req);
  if (!r.ok) return linkPage(r.lang, "Link ungültig", "Dieser Link ist ungültig. Schreiben Sie uns: contact@borivon.com", 400);
  const T = r.lang === "fr" ? ["Désabonné", "Vous ne recevrez plus de conseils de notre part."]
    : r.lang === "en" ? ["Unsubscribed", "You will not get any more tips from us."]
    : ["Abbestellt", "Sie bekommen keine Tipps mehr von uns."];
  return linkPage(r.lang, T[0], T[1]);
}

export async function POST(req: NextRequest) {
  const r = await unsubscribe(req);
  return new Response(null, { status: r.ok ? 200 : 400 });
}
