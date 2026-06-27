import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { sendOutboundEmail } from "@/lib/outboundEmail";
import { getServiceSupabase } from "@/lib/supabase";
import { tgSend } from "@/lib/telegram";

/**
 * Public ENTERPRISE lead form for the /v2 marketing site ("Book a needs audit").
 * No auth (public), but defended: per-IP rate limit + honeypot + strict
 * validation + length caps. Three independent, best-effort sinks so one outage
 * can never lose a lead:
 *   1. stores it in the dedicated `enterprise_leads` table — B2B ONLY, fully
 *      separate from candidates and from the homepage `leads` funnel;
 *   2. pings the founder on Telegram instantly (TELEGRAM_CHAT_ID);
 *   3. emails it to the Borivon inbox (ADMIN_EMAIL).
 * Returns ok if the lead landed in at least one durable sink (db or email).
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

export async function POST(req: NextRequest) {
  // 5 submissions / minute / IP — generous for a human, brutal for a bot.
  const rl = enforceRateLimit(req, "v2-contact", { limit: 5, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const body = await req.json().catch(() => ({}));

  // Honeypot: real users never see/fill `website`. If present, pretend success
  // (don't tip off the bot) and drop it.
  if (clip(body?.website, 200)) return NextResponse.json({ ok: true });

  const name = clip(body?.name, 120);
  const email = clip(body?.email, 160);
  const message = clip(body?.message, 4000);
  const company = clip(body?.company, 160);
  const role = clip(body?.role, 120);
  const phone = clip(body?.phone, 60);
  const headcount = clip(body?.headcount, 60);
  const situations = clip(body?.situations, 300);
  const lang = ["fr", "en", "de"].includes(body?.lang) ? body.lang : "—";

  // Enterprise lead: name, work email, company and message are required.
  if (!name || !company || !message || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // ── 1) Store in the dedicated enterprise_leads table (B2B ONLY; best-effort) ─
  let dbOk = false;
  try {
    const { error } = await getServiceSupabase()
      .from("enterprise_leads")
      .insert({ name, email, company, role, phone, headcount, situations, message, lang, source: "v2-contact" });
    if (error) console.error("[v2/contact] enterprise_leads insert failed:", error.message);
    else dbOk = true;
  } catch (e) {
    console.error("[v2/contact] enterprise_leads insert threw:", e instanceof Error ? e.message : e);
  }

  // ── 2) Telegram ping to the founder — instant "someone signed up" alert ─────
  const tgChat = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (tgChat) {
    const tgText = [
      "🟢 Nouvelle demande ENTREPRISE — borivon.com",
      "",
      `Entreprise : ${company}`,
      `Contact    : ${name}${role ? ` (${role})` : ""}`,
      `E-mail     : ${email}`,
      phone ? `Téléphone  : ${phone}` : null,
      headcount ? `À former   : ${headcount}` : null,
      situations ? `Situations : ${situations}` : null,
      "",
      message,
    ].filter(Boolean).join("\n");
    try { await tgSend(tgChat, tgText); } catch (e) { console.error("[v2/contact] telegram ping failed:", e instanceof Error ? e.message : e); }
  }

  // ── 3) Email to the Borivon inbox (durable record + reply thread) ───────────
  let emailOk = false;
  const to = (process.env.ADMIN_EMAIL || "").trim();
  if (to) {
    const text = [
      "Nouvelle demande entreprise depuis le site (borivon.com).",
      "",
      `Nom        : ${name}`,
      `Entreprise : ${company}`,
      role ? `Fonction   : ${role}` : null,
      `E-mail     : ${email}`,
      phone ? `Téléphone  : ${phone}` : null,
      headcount ? `À former   : ${headcount}` : null,
      situations ? `Situations : ${situations}` : null,
      `Langue     : ${lang}`,
      "",
      "Message :",
      message,
      "",
      `— Répondre directement à : ${email}`,
    ].filter(Boolean).join("\n");
    const res = await sendOutboundEmail({
      to,
      subject: `[Borivon] Demande entreprise — ${company} · ${name}`,
      body: text,
    });
    emailOk = res.ok;
    if (!res.ok) console.error("[v2/contact] email send failed:", res.error);
  }

  // Succeed if the lead landed in at least one durable sink (db or email).
  // Telegram is a bonus alert and never gates the response.
  if (!dbOk && !emailOk) {
    return NextResponse.json({ error: "Send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
