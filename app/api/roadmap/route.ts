import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { tgSend } from "@/lib/telegram";
import { clipText } from "@/lib/clipText";
import { sendRoadmapDeliveryEmail } from "@/lib/email";
import { scoreRoadmap, normalizeAnswers, type RoadmapAnswers } from "@/lib/roadmap/score";
import { renderRoadmapPdf, formatEuro } from "@/lib/roadmap/pdf";
import { deliveryMail } from "@/lib/roadmap/emails";
import { LEVELS, BOTTLENECK, CLIMB, PLAN_90, REASONS, pick, LANGS, type Lang } from "@/lib/roadmap/content";
import { STAGES } from "@/lib/roadmap/stages";
import { iconSvg, REASON_ICONS, type IconName } from "@/lib/roadmap/icons";
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
    consent: { tipsAsked: wantsTips, askedAt: new Date().toISOString(), confirmedAt: null as string | null },
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
      const pdf = await renderRoadmapPdf({ result, lang, firstName, facility, date: new Date() });
      const confirmUrl = wantsTips && leadId && tokensEnabled()
        ? `https://borivon.com/api/roadmap/confirm?id=${encodeURIComponent(leadId)}&t=${await signLeadToken("confirm", leadId)}`
        : undefined;
      const m = deliveryMail({ lang, firstName, facility, result, confirmUrl });
      const fname = (lang === "de" ? "Pflege-Fahrplan" : lang === "fr" ? "Plan-infirmier" : "Nurse-staffing-roadmap") + "-Borivon.pdf";
      emailed = await sendRoadmapDeliveryEmail({ to: email, subject: m.subject, html: m.html, text: m.text, pdf, filename: fname });
    } catch (e) { console.error("[roadmap] pdf/email failed:", e instanceof Error ? e.message : e); }

    const tgChat = (process.env.TELEGRAM_CHAT_ID || "").trim();
    if (tgChat) {
      const lines = [
        `🧭 Neuer Fahrplan-Lead — Stufe ${result.level} (${pick(LEVELS[result.level].name, "de")})`,
        "",
        facility ? `Haus    : ${facility}${city ? ` · ${city}` : ""}` : null,
        `Name    : ${[firstName, lastName].filter(Boolean).join(" ")}${role ? ` · ${role}` : ""}`,
        heardFrom ? `Quelle  : ${heardFrom}` : null,
        `E-Mail  : ${email}`,
        phone ? `Telefon : ${phone}` : null,
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
      score: result.score,
      levelName: pick(LEVELS[result.level].name, lang),
      levelLine: pick(LEVELS[result.level].line, lang),
      bottleneck: pick(BOTTLENECK[result.bottleneck].t, lang),
      openCostMonth: result.openCostMonth,
      openCostYear: result.openCostYear,
      turnoverCostYear: result.turnoverCostYear,
      totalYear: result.totalYear,
      perNurseMonth: result.perNurseMonth,
    },
    ladder: ([result.level - 1, result.level, result.level + 1] as number[])
      .filter((l) => l >= 1 && l <= 5)
      .map((l) => ({ level: l, name: pick(LEVELS[l as Level].name, lang), line: pick(LEVELS[l as Level].line, lang), current: l === result.level })),
    plan: {
      goal: pick(CLIMB[result.level].goal, lang),
      steps: CLIMB[result.level].steps.map((st) => ({ t: pick(st.t, lang), d: pick(st.d, lang) })),
      trap: pick(LEVELS[result.level].trap, lang),
      bottleneckTitle: pick(BOTTLENECK[result.bottleneck].t, lang),
      bottleneckText: pick(BOTTLENECK[result.bottleneck].d, lang),
    },
    stage: { bottom: pick(STAGES[result.level].bottom, lang), gradBy: pick(STAGES[result.level].gradBy, lang) },
    plan90: PLAN_90.map((b) => ({ when: pick(b.when, lang), items: b.items.map((it) => pick(it, lang)) })),
    reasons: REASONS.map((r, i) => ({ why: pick(r.why, lang), fix: pick(r.fix, lang), icon: REASON_ICONS[i] })),
    // the same drawings as the PDF (lib/roadmap/icons.ts), as inline SVG
    icons: Object.fromEntries((["bed", "door", "heart", "target", "warning", "calendar", "chat", ...REASON_ICONS] as IconName[]).map((n) => [n, iconSvg(n)])),
  });
}
