/**
 * Outbound email from the bot to ARBITRARY recipients — e.g. "send these 4 CVs
 * to Anna Gombert". Two channels, auto-selected:
 *
 *   1) Gmail SMTP via an App Password (GMAIL_USER + GMAIL_APP_PASSWORD) — sends
 *      truly as the founder and LANDS IN THEIR GMAIL "SENT" FOLDER. Preferred.
 *   2) Resend fallback — from the verified borivon.com domain (the OUTBOUND_FROM
 *      address), reply-to the same. Works immediately even before the App
 *      Password is set; just doesn't show up in the Gmail Sent folder.
 *
 * The bot layer gates this to the supreme admin and stages every send for the
 * admin's one-tap approval before it goes out (confirm-first).
 */
import nodemailer from "nodemailer";
import { Resend } from "resend";

/** From address (must be on the verified borivon.com domain to send via Resend). */
export const OUTBOUND_FROM_EMAIL = (process.env.OUTBOUND_FROM_EMAIL || "youness.taoufiq@borivon.com").trim();
export const OUTBOUND_FROM_NAME = (process.env.OUTBOUND_FROM_NAME || "Youness — Borivon").trim();

export type OutboundAttachment = { filename: string; content: Buffer };
export type OutboundResult =
  | { ok: true; channel: "gmail" | "resend" }
  | { ok: false; error: string };

export function gmailConfigured(): boolean {
  return !!process.env.GMAIL_USER && !!process.env.GMAIL_APP_PASSWORD;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function textToHtml(text: string): string {
  return `<div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">${escHtml(text).replace(/\n/g, "<br/>")}</div>`;
}

export async function sendOutboundEmail(opts: {
  to: string;
  toName?: string;
  subject: string;
  body: string; // plain text (newlines preserved)
  attachments?: OutboundAttachment[];
}): Promise<OutboundResult> {
  const subject = opts.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const text = opts.body;
  const html = textToHtml(opts.body);
  const atts = opts.attachments ?? [];

  // 1) Gmail (App Password) — true Sent-folder send as the founder.
  if (gmailConfigured()) {
    try {
      const transport = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
      });
      await transport.sendMail({
        from: `"${OUTBOUND_FROM_NAME}" <${process.env.GMAIL_USER}>`,
        to: opts.toName ? `"${opts.toName}" <${opts.to}>` : opts.to,
        subject,
        text,
        html,
        attachments: atts.map((a) => ({ filename: a.filename, content: a.content })),
      });
      return { ok: true, channel: "gmail" };
    } catch (e) {
      console.error("[outboundEmail] gmail send failed:", e instanceof Error ? e.message : e);
      // fall through to Resend so the email still goes out
    }
  }

  // 2) Resend fallback — from the verified borivon.com domain.
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: gmailConfigured() ? "gmail_send_failed" : "no_email_channel" };
  try {
    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      from: `${OUTBOUND_FROM_NAME} <${OUTBOUND_FROM_EMAIL}>`,
      to: opts.to,
      replyTo: OUTBOUND_FROM_EMAIL,
      subject,
      text,
      html,
      attachments: atts.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
    });
    if (error) {
      console.error("[outboundEmail] resend error:", error);
      return { ok: false, error: "resend_failed" };
    }
    return { ok: true, channel: "resend" };
  } catch (e) {
    console.error("[outboundEmail] resend send failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "resend_failed" };
  }
}
