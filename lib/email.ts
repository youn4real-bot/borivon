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
            Borivon<span style="color:#d4af37;">.</span>
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
      subject: `✅ ${docType} approved — Borivon`,
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#fff;">Document approved</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#a0a09a;line-height:1.6;">
          Your <strong style="color:#fff;">${docType}</strong> has been reviewed and approved.
          Check your dashboard to see your updated progress.
        </p>
        <a href="${BASE}/portal/dashboard" style="display:inline-block;background:#d4af37;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
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
      subject: `❌ ${docType} needs attention — Borivon`,
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#fff;">Document needs attention</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#a0a09a;line-height:1.6;">
          Your <strong style="color:#fff;">${docType}</strong> was not accepted.
          Please log in, upload a corrected version, and resubmit.
        </p>
        ${feedback ? `
        <div style="background:#1f1f1d;border:1px solid #2e2e2c;border-radius:12px;padding:14px 18px;margin-bottom:20px;">
          <p style="margin:0;font-size:12px;font-weight:600;color:#a0a09a;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Feedback</p>
          <p style="margin:0;font-size:13px;color:#e0e0da;line-height:1.5;">${feedback}</p>
        </div>` : ""}
        <a href="${BASE}/portal/dashboard" style="display:inline-block;background:#d4af37;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
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
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#d4af37;">You're verified!</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#a0a09a;line-height:1.6;">
          ${firstName ? `Hi ${firstName}, ` : ""}your profile has passed our review and is now officially verified.
          Your next step is to complete your <strong style="color:#fff;">Lebenslauf</strong> in the CV builder.
        </p>
        <a href="${BASE}/portal/cv-builder" style="display:inline-block;background:#d4af37;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
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
          Great news — you've been matched with <strong style="color:#fff;">${orgName}</strong>.
          Log in to your dashboard to see the details and next steps.
        </p>
        <a href="${BASE}/portal/dashboard" style="display:inline-block;background:#0095F6;color:#fff;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
          Go to dashboard →
        </a>
      `),
    });
  } catch (e) { console.warn("[email] sendPlacedEmail failed:", e); }
}
