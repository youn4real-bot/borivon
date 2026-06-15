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
import { stripEmailFormatting } from "@/lib/emailFormat";
import { getStoredSignatureHtml } from "@/lib/gmailSignature";

/** Base URL for the logo image (the Playfair wordmark PNG — see app/email-logo). */
const SITE = (process.env.NEXT_PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/+$/, "");

/** From address (must be on the verified borivon.com domain to send via Resend). */
export const OUTBOUND_FROM_EMAIL = (process.env.OUTBOUND_FROM_EMAIL || "youness.taoufiq@borivon.com").trim();
// The sender's display name — appears as "Youness Taoufiq <youness.taoufiq@…>".
export const OUTBOUND_FROM_NAME = (process.env.OUTBOUND_FROM_NAME || "Youness Taoufiq").trim();

// Email signature. Gmail's web/app signature is NOT applied to App-Password/SMTP
// sends (it's only added when you compose in the Gmail UI) — so we reproduce the
// founder's signature here: greeting, CEO line, address, the "Borivon." wordmark,
// and the German confidentiality disclaimer. The wordmark is the /email-logo PNG
// (the EXACT site font — Playfair Display Italic 700 — rendered to an image,
// because email clients strip custom fonts so text can never match the logo).
// A plain-text twin rides along as the text/plain part. Override either via the
// OUTBOUND_SIGNATURE / OUTBOUND_SIGNATURE_HTML env.
export const OUTBOUND_SIGNATURE_TEXT = (process.env.OUTBOUND_SIGNATURE ?? [
  "Mit freundlichen Grüßen,",
  "Youness Taoufiq",
  "CEO @ Borivon.com",
  "youness.taoufiq@borivon.com",
  "",
  "77 Boulevard Mohamed Smiha",
  "20080 Casablanca, Marokko",
  "",
  "Borivon.",
  "",
  "Diese E-Mail und ihre Anhänge sind vertraulich und ausschließlich für den/die Empfänger/in bestimmt.",
  "Ohne ausdrückliche Zustimmung darf der Inhalt weder weitergegeben noch veröffentlicht werden.",
  "Sollten Sie diese Nachricht irrtümlich erhalten haben, löschen Sie sie bitte sofort und informieren Sie den Absender.",
].join("\n")).trim();

export const OUTBOUND_SIGNATURE_HTML = (process.env.OUTBOUND_SIGNATURE_HTML ?? `
<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5;">
  <div>Mit freundlichen Grüßen,</div>
  <div>Youness Taoufiq</div>
  <div>CEO @ <a href="https://borivon.com" style="color:#1155cc;text-decoration:none;">Borivon.com</a></div>
  <div><a href="mailto:youness.taoufiq@borivon.com" style="color:#1155cc;text-decoration:none;">youness.taoufiq@borivon.com</a></div>
  <div style="height:14px;line-height:14px;">&nbsp;</div>
  <div>77 Boulevard Mohamed Smiha</div>
  <div>20080 Casablanca, Marokko</div>
  <div style="height:18px;line-height:18px;">&nbsp;</div>
  <img src="${SITE}/email-logo" alt="Borivon" width="150" height="48" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
  <div style="height:18px;line-height:18px;">&nbsp;</div>
  <div style="font-style:italic;font-size:12px;color:#8a8a85;line-height:1.5;">
    <div>Diese E-Mail und ihre Anhänge sind vertraulich und ausschließlich für den/die Empfänger/in bestimmt.</div>
    <div>Ohne ausdrückliche Zustimmung darf der Inhalt weder weitergegeben noch veröffentlicht werden.</div>
    <div>Sollten Sie diese Nachricht irrtümlich erhalten haben, löschen Sie sie bitte sofort und informieren Sie den Absender.</div>
  </div>
</div>`).trim();

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

// Common e-mail closings (DE/EN/FR). If the model wrote one of these near the end
// of the body, cut from there so the official signature below isn't duplicated.
const SIGNOFF_RE =
  /^(mit freundlichen gr[üu](ß|ss)en|mit besten gr[üu](ß|ss)en|beste gr[üu](ß|ss)e|herzliche gr[üu](ß|ss)e|viele gr[üu](ß|ss)e|liebe gr[üu](ß|ss)e|freundliche gr[üu](ß|ss)e|best regards|kind regards|warm regards|regards|sincerely|cordialement|bien (à|a) vous|best,|lg,?|vg,?)\b/i;

/** Crude HTML→plain for the text/plain alternative when we use the real Gmail sig. */
function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripTrailingSignoff(text: string): string {
  const lines = text.split("\n");
  // Look only in the last 8 lines so we never cut into the real message body.
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 8); i--) {
    if (SIGNOFF_RE.test(lines[i].trim())) return lines.slice(0, i).join("\n").trimEnd();
  }
  return text.trimEnd();
}

export async function sendOutboundEmail(opts: {
  to: string;
  toName?: string;
  cc?: string[]; // optional CC recipients
  subject: string;
  body: string; // plain text (newlines preserved)
  attachments?: OutboundAttachment[];
  icalEvent?: { method: "REQUEST" | "CANCEL"; content: string }; // a calendar invitation (.ics)
}): Promise<OutboundResult> {
  const subject = stripEmailFormatting(opts.subject).replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  // Plain-text body, with any model-written sign-off trimmed so the signature
  // replaces it (Gmail SMTP never adds the saved web signature itself).
  const cleanBody = stripTrailingSignoff(stripEmailFormatting(opts.body));
  // Prefer the founder's REAL Gmail signature (pulled live + cached once connected);
  // fall back to the built-in Playfair-logo signature if not connected / it dropped.
  const realSigHtml = await getStoredSignatureHtml().catch(() => null);
  const sigHtml = realSigHtml || OUTBOUND_SIGNATURE_HTML;
  const sigText = realSigHtml ? htmlToPlain(realSigHtml) : OUTBOUND_SIGNATURE_TEXT;
  const text = `${cleanBody.trimEnd()}\n\n${sigText}`;
  const html = `${textToHtml(cleanBody)}<br/>${sigHtml}`;
  const atts = opts.attachments ?? [];
  const cc = (opts.cc ?? []).map((c) => c.trim()).filter(Boolean);

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
        ...(cc.length ? { cc } : {}),
        subject,
        text,
        html,
        attachments: atts.map((a) => ({ filename: a.filename, content: a.content })),
        // A real calendar invitation: nodemailer emits the proper text/calendar
        // alternative so recipients get Yes/Maybe/No + it lands in their calendar.
        ...(opts.icalEvent ? { icalEvent: { method: opts.icalEvent.method, filename: "invite.ics", content: opts.icalEvent.content } } : {}),
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
    // Carry the invite as a text/calendar attachment on the Resend fallback (the
    // .ics already has METHOD inside, so clients still treat it as an invitation).
    const resendAtts = atts.map((a) => ({ filename: a.filename, content: a.content.toString("base64") }));
    if (opts.icalEvent) {
      // The .ics carries METHOD:REQUEST/CANCEL inside, so a plain attachment still
      // opens as an invitation; filename .ics → text/calendar in the client.
      resendAtts.push({ filename: "invite.ics", content: Buffer.from(opts.icalEvent.content, "utf8").toString("base64") });
    }
    const { error } = await resend.emails.send({
      from: `${OUTBOUND_FROM_NAME} <${OUTBOUND_FROM_EMAIL}>`,
      to: opts.to,
      ...(cc.length ? { cc } : {}),
      replyTo: OUTBOUND_FROM_EMAIL,
      subject,
      text,
      html,
      attachments: resendAtts,
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
