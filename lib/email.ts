/**
 * Transactional email via Resend.
 * All sends are fire-and-forget — never block the API response on email.
 * If RESEND_API_KEY is not set, emails are skipped silently.
 */

import { Resend } from "resend";

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

const FROM = "Borivon <noreply@borivon.com>";
const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.borivon.com";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * SECURITY (2026-05 review): every value interpolated into an email body below
 * is candidate-controlled (docType comes from the upload `fileType` form field;
 * firstName from signup; orgName/feedback from admin input). Without escaping, a
 * candidate could store HTML/links in those fields → HTML injection rendered in
 * the recipient's webmail. esc() neutralizes it; subj() strips CR/LF from any
 * value used in a Subject line. ALWAYS wrap interpolated user text in esc().
 */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function subj(s: unknown): string {
  return String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
}

function baseHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Borivon</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0e;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:28px;">
          <span style="font-size:26px;font-style:italic;color:#fff;letter-spacing:-0.01em;">
            Borivon<span style="color:#c9a240;">.</span>
          </span>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:#1a1a18;border-radius:20px;padding:36px 32px;">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td align="center" style="padding-top:24px;">
          <p style="margin:0;font-size:11px;color:#555550;">
            © 2025 Borivon · <a href="${BASE}/portal/terms" style="color:#555550;text-decoration:none;">Terms</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Email senders ─────────────────────────────────────────────────────────────

export async function sendDocApprovedEmail(to: string, docType: string): Promise<void> {
  const r = getResend(); if (!r) return;
  try {
    await r.emails.send({
      from: FROM,
      to,
      subject: `✅ ${subj(docType)} approved — Borivon`,
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#fff;">Document approved</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#a0a09a;line-height:1.6;">
          Your <strong style="color:#fff;">${esc(docType)}</strong> has been reviewed and approved.
          Check your dashboard to see your updated progress.
        </p>
        <a href="${BASE}/portal/dashboard" style="display:inline-block;background:#c9a240;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
          View dashboard →
        </a>
      `),
    });
  } catch (e) { console.warn("[email] sendDocApprovedEmail failed:", e); }
}

export async function sendDocRejectedEmail(to: string, docType: string, feedback: string | null): Promise<void> {
  const r = getResend(); if (!r) return;
  try {
    await r.emails.send({
      from: FROM,
      to,
      subject: `❌ ${subj(docType)} needs attention — Borivon`,
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#fff;">Document needs attention</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#a0a09a;line-height:1.6;">
          Your <strong style="color:#fff;">${esc(docType)}</strong> was not accepted.
          Please log in, upload a corrected version, and resubmit.
        </p>
        ${feedback ? `
        <div style="background:#1f1f1d;border:1px solid #2e2e2c;border-radius:12px;padding:14px 18px;margin-bottom:20px;">
          <p style="margin:0;font-size:12px;font-weight:600;color:#a0a09a;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Feedback</p>
          <p style="margin:0;font-size:13px;color:#e0e0da;line-height:1.5;">${esc(feedback)}</p>
        </div>` : ""}
        <a href="${BASE}/portal/dashboard" style="display:inline-block;background:#c9a240;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
          Fix my documents →
        </a>
      `),
    });
  } catch (e) { console.warn("[email] sendDocRejectedEmail failed:", e); }
}

export async function sendVerifiedEmail(to: string, firstName: string): Promise<void> {
  const r = getResend(); if (!r) return;
  try {
    await r.emails.send({
      from: FROM,
      to,
      subject: `🎉 Your profile is verified — Borivon`,
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#c9a240;">You're verified!</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#a0a09a;line-height:1.6;">
          ${firstName ? `Hi ${esc(firstName)}, ` : ""}your profile has passed our review and is now officially verified.
          Your next step is to complete your <strong style="color:#fff;">Lebenslauf</strong> in the CV builder.
        </p>
        <a href="${BASE}/portal/cv-builder" style="display:inline-block;background:#c9a240;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
          Build my CV →
        </a>
      `),
    });
  } catch (e) { console.warn("[email] sendVerifiedEmail failed:", e); }
}

export async function sendPlacedEmail(to: string, orgName: string): Promise<void> {
  const r = getResend(); if (!r) return;
  try {
    await r.emails.send({
      from: FROM,
      to,
      subject: `🏢 You've been matched — Borivon`,
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0095F6;">You've been matched!</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#a0a09a;line-height:1.6;">
          Great news — you've been matched with <strong style="color:#fff;">${esc(orgName)}</strong>.
          Log in to your dashboard to see the details and next steps.
        </p>
        <a href="${BASE}/portal/dashboard" style="display:inline-block;background:#0095F6;color:#fff;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
          Go to dashboard →
        </a>
      `),
    });
  } catch (e) { console.warn("[email] sendPlacedEmail failed:", e); }
}

// ── Calendar event invite (auto-adds to the recipient's calendar) ──────────────
// The .ics attachment with METHOD:REQUEST is what makes Gmail / Apple Mail /
// Outlook drop the event straight into the recipient's calendar — no app to
// connect, no subscription, no onboarding. They just receive the email.

function icsStampUTC(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function icsEsc(s: unknown): string {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function icsFold(line: string): string {
  const out: string[] = [];
  let s = line;
  while (s.length > 73) { out.push(s.slice(0, 73)); s = " " + s.slice(73); }
  out.push(s);
  return out.join("\r\n");
}

export type EventInvite = {
  id: string;
  title: string;
  description?: string | null;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  link_url?: string | null;
  /** Monotonic version — bump on every edit so calendars REPLACE, not duplicate. */
  sequence?: number;
  cancelled?: boolean;
};

function buildInviteICS(ev: EventInvite, toEmail: string): string {
  const start = new Date(ev.starts_at);
  const end = ev.ends_at ? new Date(ev.ends_at) : new Date(start.getTime() + 60 * 60 * 1000);
  const desc: string[] = [];
  if (ev.description) desc.push(ev.description);
  if (ev.link_url) desc.push(`Link: ${ev.link_url}`);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Borivon//Calendar//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${ev.cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${ev.id}@borivon.com`,
    `SEQUENCE:${Math.max(0, Math.floor(ev.sequence ?? 0))}`,
    `DTSTAMP:${icsStampUTC(start)}`,
    `DTSTART:${icsStampUTC(start)}`,
    `DTEND:${icsStampUTC(end)}`,
    icsFold(`SUMMARY:${icsEsc(ev.title)}`),
    icsFold(`DESCRIPTION:${icsEsc(desc.join("\n\n"))}`),
    icsFold(`LOCATION:${icsEsc(ev.location || ev.link_url || "")}`),
    "ORGANIZER;CN=Borivon:mailto:noreply@borivon.com",
    icsFold(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${toEmail}`),
    `STATUS:${ev.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/**
 * Email a calendar invite to one recipient. The event auto-lands in their
 * calendar (Gmail/Apple/Outlook parse the attached REQUEST). Re-sending with a
 * higher `sequence` updates it in place; `cancelled:true` removes it.
 * Fire-and-forget; never throws.
 */
export async function sendEventInviteEmail(to: string, ev: EventInvite): Promise<void> {
  const r = getResend(); if (!r || !to) return;
  try {
    const ics = buildInviteICS(ev, to);
    const start = new Date(ev.starts_at);
    const when = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Casablanca", weekday: "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(start);
    const verb = ev.cancelled ? "Cancelled" : "Invitation";
    await r.emails.send({
      from: FROM,
      to,
      subject: `📅 ${verb}: ${subj(ev.title)} — Borivon`,
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#c9a240;">${ev.cancelled ? "Event cancelled" : "You're invited"}</h1>
        <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#fff;">${esc(ev.title)}</p>
        <p style="margin:0 0 4px;font-size:14px;color:#a0a09a;">🗓️ ${esc(when)} · Casablanca</p>
        ${ev.location ? `<p style="margin:0 0 4px;font-size:14px;color:#a0a09a;">📍 ${esc(ev.location)}</p>` : ""}
        ${ev.description ? `<p style="margin:14px 0 0;font-size:13px;color:#e0e0da;line-height:1.6;white-space:pre-wrap;">${esc(ev.description)}</p>` : ""}
        ${ev.link_url ? `<p style="margin:18px 0 0;"><a href="${esc(ev.link_url)}" style="display:inline-block;background:#c9a240;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">Join event →</a></p>` : ""}
        <p style="margin:20px 0 0;font-size:12px;color:#555550;">${ev.cancelled ? "This event has been removed from your calendar." : "This invite has been added to your calendar automatically."}</p>
      `),
      attachments: [{
        filename: "invite.ics",
        content: Buffer.from(ics, "utf-8").toString("base64"),
        contentType: `text/calendar; method=${ev.cancelled ? "CANCEL" : "REQUEST"}; charset=UTF-8`,
      }],
    });
  } catch (e) { console.warn("[email] sendEventInviteEmail failed:", e); }
}
