import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { clipText } from "@/lib/clipText";
import { sendRoadmapConfirmEmail, sendAdminAlertEmail } from "@/lib/email";
import { scoreRoadmap, normalizeAnswers, type RoadmapAnswers } from "@/lib/roadmap/score";
import { formatEuro } from "@/lib/roadmap/pdf";
import { confirmMail } from "@/lib/roadmap/emails";
import { LEVELS, BOTTLENECK, pick, LANGS, type Lang } from "@/lib/roadmap/content";
import { isFreeMail } from "@/lib/roadmap/freeMail";
import { CONSENT_TEXT, asSalutation, leadName, clientIp } from "@/lib/roadmap/consent";
import { confirmLink } from "@/lib/roadmap/delivery";
import type { Level } from "@/lib/roadmap/score";
import { tokensEnabled } from "@/lib/roadmap/token";
import { keepAlive } from "@/lib/keepAlive";
import { isFormV2, normalizeForm, toModel, facilityLine, formSummaryDe } from "@/lib/roadmap/form";
import { findConfirmedPrior, supersedeOlder } from "@/lib/roadmap/repeat";
import { deliverRoadmap } from "@/lib/roadmap/delivery";
import { readTrack, trackServer } from "@/lib/track/server";

/**
 * POST /api/roadmap — the free Pflege-Fahrplan (borivon.com/fahrplan).
 *
 * Double opt-in for everything (founder, 2026-11-07):
 *   1 · here: answers + the ticked box (exact text, time, IP) are saved, and
 *       ONE mail goes out: the confirm link. No PDF yet.
 *   2 · /api/roadmap/confirm (POST from the button): subscribed on the Resend
 *       list, then the PDF + bonus by email (lib/roadmap/delivery.ts).
 *   3 · the daily job: the tips series, each mail with an unsubscribe link.
 *
 * The visitor sees the Stufe right away; the plan itself only ever comes by
 * email. Business emails only (lib/roadmap/freeMail.ts) and the box must be
 * ticked (consent: true); both are checked here as well as in the page.
 * The founder gets an internal email per request (Telegram was removed).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const S = (v: unknown, n: number) => clipText((typeof v === "string" ? v : "").trim(), n);
const SAL_DE = { frau: "Frau", herr: "Herr", none: "keine Angabe" } as const;

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
  const salutation = asSalutation(body.salutation);
  const lastName = S(body.lastName, 80);
  const firstName = S(body.firstName, 80);
  // v2 form (founder spec 2026-11-08): no facility name, Vorname + Nachname, Anrede required
  const form = isFormV2(body.answers) ? normalizeForm(body.answers as Record<string, unknown>) : null;
  const facility = form ? facilityLine(form, lang) : S(body.facility, 120);
  const heardFrom = S(body.heardFrom, 40);
  if (!lastName || (form && !firstName)) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (form && !["frau", "herr", "none"].includes(String(body.salutation))) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!facility) return NextResponse.json({ error: "facility_required" }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  if (isFreeMail(email)) return NextResponse.json({ error: "business_email" }, { status: 400 });
  if (body.consent !== true) return NextResponse.json({ error: "consent_required" }, { status: 400 });

  const answers = form ? toModel(form) : normalizeAnswers((body.answers ?? {}) as Partial<RoadmapAnswers>);
  const result = scoreRoadmap(answers);
  const now = new Date().toISOString();

  // 1 · keep the request + the proof of the ticked box (Art. 7(1) GDPR)
  const db = getServiceSupabase();
  const ip = clientIp(req.headers);
  // Same email, already confirmed before → no second confirm mail (lib/roadmap/repeat.ts)
  const prior = form ? await findConfirmedPrior(db, email) : null;
  // where this visitor came from (tracked link / utm / referrer), for the founder's analytics
  const track = readTrack(body.track);
  const details = {
    source: "roadmap",
    track,
    lang, salutation, firstName, lastName, facility, heardFrom,
    ...(form ? { form } : {}),
    ...(prior?.delivered ? { previousLeadId: prior.id } : {}),
    answers,
    result: { level: result.level, score: result.score, bottleneck: result.bottleneck, openCostMonth: result.openCostMonth, turnoverCostYear: result.turnoverCostYear, totalYear: result.totalYear },
    consent: prior
      ? { text: CONSENT_TEXT[lang], givenAt: now, ip, confirmedAt: now as string | null, confirmIp: ip, confirmedVia: prior.id }
      : { text: CONSENT_TEXT[lang], givenAt: now, ip, confirmedAt: null as string | null },
    delivery: { sentAt: null as string | null, attempts: 0 },
    seq: { step: 0, lastSentAt: null as string | null },
    unsubscribedAt: null as string | null,
  };
  let leadId: string | null = null;
  try {
    const { data, error } = await db.from("leads").insert({
      kind: "roadmap", email, name: leadName(salutation, lastName), phone: "",
      message: clipText(`Stufe ${result.level} · ${facility}`, 300),
      details,
    }).select("id").single();
    if (error) console.error("[roadmap] lead insert failed:", error.message);
    else leadId = (data as { id: string } | null)?.id ?? null;
  } catch (e) { console.error("[roadmap] lead insert threw:", e instanceof Error ? e.message : e); }
  // Without a saved lead there is nothing to confirm: say so, the visitor can retry.
  if (!leadId) return NextResponse.json({ error: "save_failed" }, { status: 503 });
  const id = leadId;

  // 2 · the confirm mail, then 3 · tell the founder — both after the response
  keepAlive(async () => {
    await trackServer(req, { ...track, path: "/fahrplan", lid: id }, [{ type: "form_submit", name: `Stufe ${result.level}`, lead_id: id }]);
    let mailed = false;
    if (prior) {
      // known, confirmed address: the new plan goes straight out, the old series stops
      await supersedeOlder(db, email, id);
      mailed = (await deliverRoadmap(db, { id, email, details })).ok;
    } else if (tokensEnabled()) {
      try {
        const m = confirmMail({ lang, salutation, lastName, firstName, facility: form ? "" : facility, confirmUrl: await confirmLink(id) });
        mailed = await sendRoadmapConfirmEmail({ to: email, subject: m.subject, html: m.html, text: m.text });
      } catch (e) { console.error("[roadmap] confirm mail failed:", e instanceof Error ? e.message : e); }
    } else console.error("[roadmap] DL_TOKEN_SECRET missing: no confirm link possible");

    const lines = [
      `Neue Fahrplan-Anfrage — Stufe ${result.level} (${pick(LEVELS[result.level].name, "de")})`,
      "",
      `Einrichtung : ${facility}`,
      `Name        : ${[firstName, lastName].filter(Boolean).join(" ")} (${SAL_DE[salutation]})`,
      `E-Mail      : ${email}`,
      heardFrom ? `Quelle      : ${heardFrom}` : null,
      ...(form ? formSummaryDe(form).map(([k, v]) => `${(k + "            ").slice(0, 12)}: ${v}`) : [`Zahlen      : ${answers.staff} Pflegekräfte · ${answers.openPosts} offen · ${answers.leftLastYear} gegangen`]),
      `Verlust     : ${formatEuro(result.totalYear, "de")} pro Jahr`,
      `Engpass     : ${pick(BOTTLENECK[result.bottleneck].t, "de")}`,
      `Status      : ${prior ? (mailed ? "Schon bestätigt (frühere Anfrage): neuer Fahrplan direkt verschickt." : "Schon bestätigt, aber Fahrplan NICHT verschickt (Job versucht es erneut).") : mailed ? "Bestätigungs-Mail raus, wartet auf Klick. Erst dann geht das PDF raus." : "ACHTUNG: Bestätigungs-Mail NICHT versendet."}`,
      "",
      "https://borivon.com/portal/admin/leads",
    ].filter((l) => l !== null).join("\n");
    const noticed = await sendAdminAlertEmail(`Fahrplan: ${facility} (Stufe ${result.level})`, lines);
    if (!noticed) console.error("[roadmap] internal notice email failed (ADMIN_EMAIL set?)");
  });

  return NextResponse.json({
    ok: true,
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
