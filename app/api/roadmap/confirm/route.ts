import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { verifyLeadToken } from "@/lib/roadmap/token";
import { parseDetails, deliveryDue } from "@/lib/roadmap/leadState";
import { linkPage } from "@/lib/roadmap/linkPage";
import { setListSubscribed } from "@/lib/roadmap/resendList";
import { clientIp } from "@/lib/roadmap/consent";
import { deliverRoadmap, leadLang } from "@/lib/roadmap/delivery";
import { lastDelivered, supersedeOlder } from "@/lib/roadmap/repeat";
import { viewLink } from "@/lib/roadmap/hosted";
import { keepAlive } from "@/lib/keepAlive";
import { trackServer } from "@/lib/track/server";

/**
 * /api/roadmap/confirm?id=&t= — the double opt-in link from the first mail.
 *
 * GET only SHOWS a button; the POST from that button confirms. Mail security
 * scanners (Outlook Safe Links and friends) open every link in a mail by
 * themselves; a GET that confirmed would sign people up who never clicked —
 * worthless as proof of consent under §7 UWG.
 *
 * After the POST, and only then (founder, 2026-11-07): the contact is
 * subscribed on the Resend list and the Fahrplan PDF goes out.
 *
 * Since 2026-11-14 (founder: "once they click and verify, they get their roadmap immediately"): the POST
 * answers with a redirect to the viewer page (/fahrplan/plan, signed link), which renders the plan itself
 * if it is not stored yet. The e-mail still goes out after the answer (keepAlive) as the copy to keep; a
 * failed send is retried by the daily job. Nobody waits on an inbox any more.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TXT = {
  de: {
    ask: ["Ihr Fahrplan ist fertig", "Ein Klick, und er öffnet sich sofort hier. Eine Kopie schicken wir Ihnen zusätzlich per E-Mail."], btn: "Fahrplan jetzt öffnen",
    done: ["Ihr Fahrplan ist fertig", "Er öffnet sich hier, sofort. Eine Kopie ist auf dem Weg in Ihr Postfach."],
    sent: ["Ihr Fahrplan ist fertig", "Öffnen Sie ihn hier. Eine Kopie liegt auch in Ihrem Postfach."], open: "Fahrplan öffnen",
    off: ["Abgemeldet", "Sie haben sich abgemeldet. Wir schicken Ihnen nichts mehr."],
    err: "Kurzer Fehler. Bitte noch einmal klicken.",
  },
  en: {
    ask: ["Your roadmap is ready", "One click and it opens right here. We also send a copy to your inbox."], btn: "Open my roadmap now",
    done: ["Your roadmap is ready", "It opens here, right away. A copy is on its way to your inbox."],
    sent: ["Your roadmap is ready", "Open it here. A copy is in your inbox as well."], open: "Open my roadmap",
    off: ["Unsubscribed", "You unsubscribed. We will not send you anything else."],
    err: "Small error. Please click again.",
  },
  fr: {
    ask: ["Votre plan est prêt", "Un clic, et il s'ouvre ici, tout de suite. Nous vous en envoyons aussi une copie par e-mail."], btn: "Ouvrir mon plan",
    done: ["Votre plan est prêt", "Il s'ouvre ici, tout de suite. Une copie arrive dans votre boîte mail."],
    sent: ["Votre plan est prêt", "Ouvrez-le ici. Une copie est aussi dans votre boîte mail."], open: "Ouvrir mon plan",
    off: ["Désabonné", "Vous vous êtes désabonné. Nous ne vous enverrons plus rien."],
    err: "Petite erreur. Merci de réessayer.",
  },
} as const;

async function load(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const t = req.nextUrl.searchParams.get("t") ?? "";
  if (!(await verifyLeadToken("confirm", id, t))) return null;
  const db = getServiceSupabase();
  const { data, error } = await db.from("leads").select("id,email,details").eq("id", id).eq("kind", "roadmap").maybeSingle();
  if (error || !data) return null;
  const d = parseDetails((data as { details: unknown }).details);
  if (d.anonymizedAt) return null;
  return { id, d, lang: leadLang(d), db, email: String((data as { email?: unknown }).email ?? "") };
}

const invalid = () => linkPage("de", "Link ungültig", "Dieser Link ist ungültig oder abgelaufen. Fordern Sie den Fahrplan einfach neu an: borivon.com/fahrplan", 400);

export async function GET(req: NextRequest) {
  const x = await load(req);
  if (!x) return invalid();
  const T = TXT[x.lang];
  if (x.d.unsubscribedAt) return linkPage(x.lang, T.off[0], T.off[1]);
  if (x.d.consent?.confirmedAt) { const m = x.d.delivery?.sentAt ? T.sent : T.done; return linkPage(x.lang, m[0], m[1], 200, undefined, { label: T.open, href: await viewLink(x.id, x.lang, "plan") }); }
  return linkPage(x.lang, T.ask[0], T.ask[1], 200, { label: T.btn });
}

export async function POST(req: NextRequest) {
  const x = await load(req);
  if (!x) return invalid();
  const T = TXT[x.lang];
  if (x.d.unsubscribedAt) return linkPage(x.lang, T.off[0], T.off[1]);
  let d = x.d;
  if (!d.consent?.confirmedAt) {
    const at = new Date().toISOString();
    d = { ...d, consent: { ...(d.consent ?? {}), confirmedAt: at, confirmIp: clientIp(req.headers) } };
    const { error } = await x.db.from("leads").update({ details: d }).eq("id", x.id);
    if (error) return linkPage(x.lang, "…", T.err, 500, { label: T.btn });
    const confirmed = d;
    keepAlive(() => trackServer(req, { path: "/fahrplan/bestaetigt", src: String(((confirmed as Record<string, unknown>).track as { src?: unknown } | undefined)?.src ?? ""), lid: x.id }, [{ type: "confirm", lead_id: x.id }]));
    // double opt-in done: now (and only now) on the Resend list, subscribed
    if (x.email) {
      const r = await setListSubscribed(x.email, true, fetch, { lastName: String(d.lastName ?? "") });
      if (r.ok) {
        d = { ...d, list: { state: "subscribed", at } };
        await x.db.from("leads").update({ details: d }).eq("id", x.id);
      } else console.error("[roadmap] list subscribe failed:", r.status ?? "no key/network");
    }
  }
  // straight to the plan on the website (303: the browser follows with a GET)
  const open = () => viewLink(x.id, x.lang, "plan").then((to) => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } }));
  if (d.delivery?.sentAt) return open();
  // the PDF: first click, or a retry after a failed send (not twice in 30 min)
  if (deliveryDue(d, new Date())) {
    const lead = { id: x.id, email: x.email, details: d };
    keepAlive(async () => {
      // same email asked before: link the earlier plan, stop its tips (lib/roadmap/repeat.ts)
      if (x.email) {
        const prev = await lastDelivered(x.db, x.email, x.id);
        if (prev && !lead.details.previousLeadId) lead.details = { ...lead.details, previousLeadId: prev };
        await supersedeOlder(x.db, x.email, x.id);
      }
      await deliverRoadmap(x.db, lead);
    });
  }
  return open();
}
