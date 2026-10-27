import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { tgSend } from "@/lib/telegram";
import { clipText } from "@/lib/clipText";
import { sendRoadmapDeliveryEmail } from "@/lib/email";
import { scoreRoadmap, normalizeAnswers, type RoadmapAnswers } from "@/lib/roadmap/score";
import { renderRoadmapPdf, formatEuro } from "@/lib/roadmap/pdf";
import { renderAgencyCheckPdf } from "@/lib/roadmap/bonusPdf";
import { FACILITY } from "@/lib/roadmap/types";
import { deliveryMail } from "@/lib/roadmap/emails";
import { LEVELS, BOTTLENECK, pick, LANGS, type Lang } from "@/lib/roadmap/content";
import { isFreeMail } from "@/lib/roadmap/freeMail";
import { addLeadToList } from "@/lib/roadmap/resendList";
import type { Level } from "@/lib/roadmap/score";
import { signLeadToken, tokensEnabled } from "@/lib/roadmap/token";
import { keepAlive } from "@/lib/keepAlive";

/**
 * POST /api/roadmap — the free Pflege-Fahrplan (borivon.com/fahrplan).
 *
 * Answers in → Stufe + money numbers → personal PDF by email → lead in the
 * portal (kind "roadmap", everything else in `details`) → founder pinged on
 * Telegram. The visitor sees the Stufe and the numbers right away; the PDF goes
 * to the inbox (that is also what proves the address is real).
 *
 * The PDF + mail + Telegram run AFTER the response (keepAlive → waitUntil):
 * measured on Workers, rendering the PDF took 4-10 s per request, and the
 * visitor was staring at "sending…" for all of it. The lead is saved first, so
 * a failed mail is never a lost lead, and Telegram says when the mail failed.
 *
 * The plan itself is ONLY delivered by email (founder, 2026-10-23): the
 * response carries the level and the ladder for the "you are at" screen, never
 * the plan, the numbers or the PDF. Business emails only (lib/roadmap/
 * freeMail.ts), and the privacy box must be ticked (consent: true); both are
 * checked here as well as in the page.
 *
 * The follow-up series needs BOTH the ticked box AND a click on the confirm link
 * in this mail (double opt-in) — see /api/roadmap/confirm and the cron.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const S = (v: unknown, n: number) => clipText((typeof v === "string" ? v : "").trim(), n);

export async function POST(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "roadmap", { limit: 6, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  if (Number(req.headers.get("content-length") ?? 0) > 8 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  // Honeypot: real people never see this field.
  if (S(body.website, 200)) return NextResponse.json({ ok: true, result: null });

  const lang: Lang = LANGS.includes(body.lang as Lang) ? (body.lang as Lang) : "de";
  const email = S(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  if (isFreeMail(email)) return NextResponse.json({ error: "business_email" }, { status: 400 });
  if (body.consent !== true) return NextResponse.json({ error: "consent_required" }, { status: 400 });
  const firstName = S(body.firstName, 60);
  const lastName = S(body.lastName, 80);
  const city = S(body.city, 80);
  const heardFrom = S(body.heardFrom, 40);
  const facility = S(body.facility, 120);
  const role = S(body.role, 80);
  const phone = S(body.phone, 40);
  const wantsTips = body.tips === true;

  const answers = normalizeAnswers((body.answers ?? {}) as Partial<RoadmapAnswers>);
  const result = scoreRoadmap(answers);

  // 1 · keep the lead (never lose it to a mail hiccup)
  const db = getServiceSupabase();
  const details = {
    source: "roadmap",
    lang, facility, city, role, firstName, lastName, heardFrom,
    answers,
    result: { level: result.level, score: result.score, bottleneck: result.bottleneck, openCostMonth: result.openCostMonth, turnoverCostYear: result.turnoverCostYear, totalYear: result.totalYear },
    // privacyAcceptedAt = proof the required box was ticked (Art. 7(1) GDPR)
    consent: { privacyAcceptedAt: new Date().toISOString(), tipsAsked: wantsTips, askedAt: new Date().toISOString(), confirmedAt: null as string | null },
    seq: { step: 0, lastSentAt: null as string | null },
    unsubscribedAt: null as string | null,
  };
  let leadId: string | null = null;
  try {
    const { data, error } = await db.from("leads").insert({
      kind: "roadmap", email, name: [firstName, lastName].filter(Boolean).join(" "), phone,
      message: clipText(`Stufe ${result.level} · ${facility}${city ? ` (${city})` : ""}`, 300),
      details,
    }).select("id").single();
    if (error) console.error("[roadmap] lead insert failed:", error.message);
    else leadId = (data as { id: string } | null)?.id ?? null;
  } catch (e) { console.error("[roadmap] lead insert threw:", e instanceof Error ? e.message : e); }

  // 2 · the PDF by email, then 3 · tell the founder — both after the response
  keepAlive(async () => {
    let emailed = false;
    try {
      const [pdf, bonus] = await Promise.all([renderRoadmapPdf({ result, lang, firstName, facility, date: new Date() }), renderAgencyCheckPdf(lang)]);
      const confirmUrl = wantsTips && leadId && tokensEnabled()
        ? `https://borivon.com/api/roadmap/confirm?id=${encodeURIComponent(leadId)}&t=${await signLeadToken("confirm", leadId)}`
        : undefined;
      const m = deliveryMail({ lang, firstName, facility, result, confirmUrl });
      const fname = (lang === "de" ? "Pflege-Fahrplan" : lang === "fr" ? "Plan-infirmier" : "Nurse-staffing-roadmap") + "-Borivon.pdf";
      const bonusName = (lang === "de" ? "Agentur-Check" : lang === "fr" ? "Check-agence" : "Agency-check") + "-Borivon.pdf";
      emailed = await sendRoadmapDeliveryEmail({ to: email, subject: m.subject, html: m.html, text: m.text, pdf, filename: fname, extra: [{ filename: bonusName, pdf: bonus }] });
    } catch (e) { console.error("[roadmap] pdf/email failed:", e instanceof Error ? e.message : e); }

    // the email list (Resend contacts): on the list, not subscribed until double opt-in
    const listed = await addLeadToList({ email, firstName, lastName });
    if (!listed.ok) console.error("[roadmap] email list add failed:", listed.status ?? "no key/network");

    const tgChat = (process.env.TELEGRAM_CHAT_ID || "").trim();
    if (tgChat) {
      const lines = [
        `🧭 Neuer Fahrplan-Lead — Stufe ${result.level} (${pick(LEVELS[result.level].name, "de")})`,
        "",
        facility ? `Einrichtung: ${facility}${city ? ` · ${city}` : ""}` : null,
        `Name    : ${[firstName, lastName].filter(Boolean).join(" ")}${role ? ` · ${role}` : ""}`,
        heardFrom ? `Quelle  : ${heardFrom}` : null,
        `E-Mail  : ${email}`,
        phone ? `Telefon : ${phone}` : null,
        `Art     : ${pick(FACILITY[result.facilityType].name, "de")}`,
      `Zahlen  : ${answers.staff} Pflegekräfte · ${answers.openPosts} offen · ${answers.leftLastYear} gegangen`,
        `Verlust : ${formatEuro(result.totalYear, "de")} pro Jahr`,
        `Engpass : ${pick(BOTTLENECK[result.bottleneck].t, "de")}`,
        `Tipps   : ${wantsTips ? "ja (wartet auf Bestätigung)" : "nein"}`,
        emailed ? null : "⚠️ PDF-Mail NICHT versendet",
        leadId ? null : "⚠️ Nicht im Portal gespeichert",
        "",
        "→ /portal/admin/leads",
      ].filter((l) => l !== null).join("\n");
      try { await tgSend(tgChat, lines); } catch (e) { console.error("[roadmap] telegram failed:", e instanceof Error ? e.message : e); }
    }
  });

  return NextResponse.json({
    ok: true,
    emailed: true, // queued; a failure shows up on Telegram
    result: {
      level: result.level,
      levelName: pick(LEVELS[result.level].name, lang),
      levelLine: pick(LEVELS[result.level].line, lang),
    },
    ladder: ([result.level - 1, result.level, result.level + 1] as number[])
      .filter((l) => l >= 1 && l <= 5)
      .map((l) => ({ level: l, name: pick(LEVELS[l as Level].name, lang), line: pick(LEVELS[l as Level].line, lang), current: l === result.level })),
  });
}
