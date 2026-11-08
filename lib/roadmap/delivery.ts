/**
 * Sends the Fahrplan PDF (+ the Agentur-Check bonus) to a lead who confirmed.
 * Used by the confirm click (/api/roadmap/confirm) and by the daily job, which
 * retries a failed send (leadState.deliveryDue, at most 3 tries).
 *
 * The attempt is written BEFORE rendering, so a crash mid-render (Workers
 * limits) counts as a try and can never loop forever.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { sendRoadmapDeliveryEmail, sendAdminAlertEmail } from "@/lib/email";
import { renderRoadmapPdf } from "./pdf";
import { renderAgencyCheckPdf } from "./bonusPdf";
import { deliveryMail } from "./emails";
import { scoreRoadmap, normalizeAnswers, type RoadmapAnswers } from "./score";
import { LANGS, type Lang } from "./content";
import { asSalutation, addressName } from "./consent";
import { signLeadToken } from "./token";
import { calcUrl } from "./calc";
import { MAX_DELIVERY_ATTEMPTS, type RoadmapDetails } from "./leadState";

type Db = ReturnType<typeof getServiceSupabase>;
const SITE = "https://borivon.com";

export async function confirmLink(id: string): Promise<string> {
  return `${SITE}/api/roadmap/confirm?id=${encodeURIComponent(id)}&t=${await signLeadToken("confirm", id)}`;
}
export async function unsubscribeLink(id: string): Promise<string> {
  return `${SITE}/api/roadmap/unsubscribe?id=${encodeURIComponent(id)}&t=${await signLeadToken("unsub", id)}`;
}

export function leadLang(d: RoadmapDetails): Lang {
  return LANGS.includes(d.lang as Lang) ? (d.lang as Lang) : "de";
}

export async function deliverRoadmap(db: Db, lead: { id: string; email: string; details: RoadmapDetails }): Promise<{ ok: boolean; details: RoadmapDetails }> {
  const d = lead.details;
  const attempts = Number(d.delivery?.attempts ?? 0) + 1;
  const attemptAt = new Date().toISOString();
  const trying: RoadmapDetails = { ...d, delivery: { attempts, lastAttemptAt: attemptAt, sentAt: null } };
  const { error: markErr } = await db.from("leads").update({ details: trying }).eq("id", lead.id);
  if (markErr) { console.error("[roadmap] delivery mark failed:", lead.id, markErr.message); return { ok: false, details: d }; }

  const lang = leadLang(d);
  const salutation = asSalutation(d.salutation);
  const lastName = String(d.lastName ?? "");
  const facility = String(d.facility ?? "");
  let ok = false;
  try {
    const answers = normalizeAnswers((d.answers ?? {}) as Partial<RoadmapAnswers>);
    const result = scoreRoadmap(answers);
    const calc = await calcUrl({ lang, facilityType: answers.facilityType, openPosts: answers.openPosts, leftLastYear: answers.leftLastYear, leadId: lead.id });
    const [pdf, bonus] = await Promise.all([
      renderRoadmapPdf({ result, lang, name: addressName(lang, salutation, lastName), facility, date: new Date(), calcUrl: calc }),
      renderAgencyCheckPdf(lang),
    ]);
    const unsubscribeUrl = await unsubscribeLink(lead.id);
    const m = deliveryMail({ lang, salutation, lastName, facility, result, unsubscribeUrl });
    const fname = (lang === "de" ? "Pflege-Fahrplan" : lang === "fr" ? "Plan-infirmier" : "Nurse-staffing-roadmap") + "-Borivon.pdf";
    const bonusName = (lang === "de" ? "Agentur-Check" : lang === "fr" ? "Check-agence" : "Agency-check") + "-Borivon.pdf";
    ok = await sendRoadmapDeliveryEmail({ to: lead.email, subject: m.subject, html: m.html, text: m.text, pdf, filename: fname, unsubscribeUrl, extra: [{ filename: bonusName, pdf: bonus }] });
  } catch (e) { console.error("[roadmap] pdf/email failed:", e instanceof Error ? e.message : e); }

  const next: RoadmapDetails = { ...d, delivery: { attempts, lastAttemptAt: attemptAt, sentAt: ok ? new Date().toISOString() : null } };
  const { error: saveErr } = await db.from("leads").update({ details: next }).eq("id", lead.id);
  if (saveErr) console.error("[roadmap] delivery save failed:", lead.id, saveErr.message);
  if (!ok) {
    const left = MAX_DELIVERY_ATTEMPTS - attempts;
    await sendAdminAlertEmail(
      `Fahrplan-PDF NICHT versendet (${lead.email})`,
      `Der Fahrplan an ${lead.email} (${facility || "ohne Einrichtung"}) ging nicht raus. Versuch ${attempts} von ${MAX_DELIVERY_ATTEMPTS}.` +
      (left > 0 ? " Der tägliche Job versucht es morgen früh noch einmal." : " Keine weiteren automatischen Versuche: bitte von Hand schicken.") +
      `\n\n${SITE}/portal/admin/leads`,
    );
  }
  return { ok, details: next };
}
