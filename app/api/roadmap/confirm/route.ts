import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { verifyLeadToken } from "@/lib/roadmap/token";
import { parseDetails } from "@/lib/roadmap/leadState";
import { linkPage } from "@/lib/roadmap/linkPage";

/**
 * /api/roadmap/confirm?id=&t= — the double opt-in from the delivery mail.
 *
 * GET only SHOWS a button; the POST from that button confirms. Mail security
 * scanners (Outlook Safe Links and friends) open every link in a mail by
 * themselves; a GET that confirmed would sign people up who never clicked —
 * worthless as proof of consent under §7 UWG. Only after the POST does the
 * follow-up series start (cron /api/cron/roadmap-followups).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TXT = {
  de: { ask: ["Tipps bestätigen", "Ein Klick, und Sie bekommen in den nächsten Tagen ein paar kurze Tipps zu Pflegekräften, die bleiben."], btn: "Ja, Tipps senden", done: ["Bestätigt", "Sie bekommen in den nächsten Tagen ein paar kurze Tipps. Sie können sie jederzeit abbestellen."] },
  en: { ask: ["Confirm tips", "One click and you get a few short tips on nurses who stay over the next days."], btn: "Yes, send tips", done: ["Confirmed", "You will get a few short tips over the next days. You can unsubscribe at any time."] },
  fr: { ask: ["Confirmer les conseils", "Un clic, et vous recevrez quelques conseils courts sur les infirmières qui restent."], btn: "Oui, envoyer les conseils", done: ["C'est confirmé", "Vous recevrez quelques conseils courts dans les prochains jours. Vous pouvez vous désabonner à tout moment."] },
} as const;

async function load(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const t = req.nextUrl.searchParams.get("t") ?? "";
  if (!(await verifyLeadToken("confirm", id, t))) return null;
  const db = getServiceSupabase();
  const { data, error } = await db.from("leads").select("id,details").eq("id", id).eq("kind", "roadmap").maybeSingle();
  if (error || !data) return null;
  const d = parseDetails((data as { details: unknown }).details);
  const lang = (d.lang === "fr" || d.lang === "en" ? d.lang : "de") as keyof typeof TXT;
  return { id, d, lang, db };
}

export async function GET(req: NextRequest) {
  const x = await load(req);
  if (!x) return linkPage("de", "Link ungültig", "Dieser Link ist ungültig oder abgelaufen.", 400);
  const T = TXT[x.lang];
  if (x.d.consent?.confirmedAt) return linkPage(x.lang, T.done[0], T.done[1]);
  return linkPage(x.lang, T.ask[0], T.ask[1], 200, { label: T.btn });
}

export async function POST(req: NextRequest) {
  const x = await load(req);
  if (!x) return linkPage("de", "Link ungültig", "Dieser Link ist ungültig oder abgelaufen.", 400);
  const T = TXT[x.lang];
  if (!x.d.unsubscribedAt && !x.d.consent?.confirmedAt) {
    const next = { ...x.d, consent: { ...(x.d.consent ?? {}), tipsAsked: true, confirmedAt: new Date().toISOString() } };
    const { error } = await x.db.from("leads").update({ details: next }).eq("id", x.id);
    if (error) return linkPage(x.lang, "…", x.lang === "de" ? "Kurzer Fehler. Bitte noch einmal klicken." : x.lang === "fr" ? "Petite erreur. Merci de réessayer." : "Small error. Please click again.", 500, { label: T.btn });
  }
  return linkPage(x.lang, T.done[0], T.done[1]);
}
