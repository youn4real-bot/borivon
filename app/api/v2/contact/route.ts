import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { sendOutboundEmail } from "@/lib/outboundEmail";

/**
 * Public lead form for the /v2 marketing site ("talk to an expert").
 * No auth (public), but defended: per-IP rate limit + honeypot + strict
 * validation + length caps. Emails the lead to the Borivon inbox (ADMIN_EMAIL)
 * via the existing Gmail/Resend channel. Never stores anything.
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

  const to = (process.env.ADMIN_EMAIL || "").trim();
  if (!to) {
    console.error("[v2/contact] ADMIN_EMAIL not set — cannot route lead");
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

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
    subject: `[Borivon] Nouvelle demande — ${name}${company ? ` · ${company}` : ""}`,
    body: text,
  });

  if (!res.ok) {
    console.error("[v2/contact] send failed:", res.error);
    return NextResponse.json({ error: "Send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
