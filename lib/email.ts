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

/**
 * A custom message from the Borivon team to a candidate — e.g. sent from the
 * admin's Telegram bot ("tell X their interview is Monday"). Returns whether it
 * was dispatched (false if RESEND_API_KEY is unset). `body` is admin free text →
 * esc() it and turn newlines into <br/>.
 */
export async function sendCandidateMessageEmail(to: string, firstName: string, body: string): Promise<boolean> {
  const r = getResend(); if (!r) return false;
  const safeBody = esc(body).replace(/\n/g, "<br/>");
  try {
    await r.emails.send({
      from: FROM,
      to,
      subject: `💬 Eine Nachricht von Borivon`,
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#fff;">${firstName ? `Hallo ${esc(firstName)},` : "Hallo,"}</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#e0e0da;line-height:1.6;">${safeBody}</p>
        <a href="${BASE}/portal/dashboard" style="display:inline-block;background:#c9a240;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
          Zum Portal →
        </a>
      `),
    });
    return true;
  } catch (e) { console.warn("[email] sendCandidateMessageEmail failed:", e); return false; }
}

/**
 * Manual nudge: a candidate has unread/unanswered Borivon messages. Admin-
 * triggered only, throttled to 1/72h per candidate (see the route). Returns
 * whether an email was actually dispatched — false when RESEND_API_KEY is unset
 * (so the caller doesn't stamp the throttle or claim success).
 */
export async function sendUnreadMessagesReminderEmail(to: string, firstName: string): Promise<boolean> {
  const r = getResend(); if (!r) return false;
  try {
    await r.emails.send({
      from: FROM,
      to,
      subject: `💬 Du hast eine Nachricht — Borivon`,
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#fff;">Du hast eine Nachricht auf Borivon</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#a0a09a;line-height:1.6;">
          ${firstName ? `Hallo ${esc(firstName)}, ` : "Hallo, "}das Borivon-Team hat dir geschrieben und wartet auf deine Antwort.
          Bitte logge dich ein, um sie zu lesen und zu antworten.
        </p>
        <a href="${BASE}/portal/dashboard" style="display:inline-block;background:#c9a240;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
          Meine Nachrichten öffnen →
        </a>
      `),
    });
    return true;
  } catch (e) { console.warn("[email] sendUnreadMessagesReminderEmail failed:", e); return false; }
}

/* ── Booking emails ────────────────────────────────────────────────────────────
 * The Google Calendar invite Google sends is plain and easy to miss. These are
 * the Borivon-branded ones, and — critically — they carry the reschedule/cancel
 * link. Someone who can move their own call reschedules instead of not turning
 * up, which is the single biggest lever on no-shows.
 * ---------------------------------------------------------------------------- */

/** Long local date+time, in the recipient's language. */
function whenLine(startsAt: string, lang: "fr" | "en" | "de"): string {
  const loc = lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB";
  try {
    return new Intl.DateTimeFormat(loc, {
      weekday: "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit", timeZone: "Africa/Casablanca",
    }).format(new Date(startsAt)) + (lang === "de" ? " (Marokko)" : lang === "fr" ? " (Maroc)" : " (Morocco)");
  } catch { return startsAt; }
}

function manageBlock(token: string, lang: "fr" | "en" | "de"): string {
  const label = lang === "de" ? "Termin verschieben oder absagen"
    : lang === "fr" ? "Reporter ou annuler le rendez-vous"
    : "Reschedule or cancel";
  return `
    <p style="margin:22px 0 0;font-size:13px;color:#7a7a74;line-height:1.6;">
      <a href="${BASE}/book/manage/${esc(token)}" style="color:#c9a240;text-decoration:none;">${label} →</a>
    </p>`;
}

export async function sendBookingConfirmedEmail(opts: {
  to: string; name: string; startsAt: string; meetLink: string | null;
  manageToken: string; lang?: "fr" | "en" | "de";
}): Promise<void> {
  const r = getResend(); if (!r) return;
  const lang = opts.lang ?? "en";
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  try {
    await r.emails.send({
      from: FROM,
      to: opts.to,
      subject: subj(T("Your call with Borivon is confirmed", "Ihr Termin bei Borivon ist bestätigt", "Votre rendez-vous Borivon est confirmé")),
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#fff;">
          ${T("You're booked", "Termin bestätigt", "Rendez-vous confirmé")}
        </h1>
        <p style="margin:0 0 6px;font-size:14px;color:#a0a09a;line-height:1.6;">
          ${T("Hi", "Hallo", "Bonjour")} ${esc(opts.name)},
        </p>
        <p style="margin:0 0 18px;font-size:16px;color:#fff;font-weight:600;">
          ${esc(whenLine(opts.startsAt, lang))}
        </p>
        ${opts.meetLink ? `
        <a href="${esc(opts.meetLink)}" style="display:inline-block;background:#c9a240;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
          ${T("Join the video call", "Zum Videoanruf", "Rejoindre la visio")} →
        </a>
        <p style="margin:16px 0 0;font-size:12px;color:#7a7a74;">
          ${T("The same link is in your calendar invitation.", "Derselbe Link steht in Ihrer Kalendereinladung.", "Le même lien figure dans votre invitation.")}
        </p>` : `
        <p style="margin:0;font-size:13px;color:#a0a09a;line-height:1.6;">
          ${T("A calendar invitation with the video link is on its way.", "Eine Kalendereinladung mit dem Video-Link folgt.", "Une invitation avec le lien visio arrive.")}
        </p>`}
        ${manageBlock(opts.manageToken, lang)}
      `),
    });
  } catch (e) { console.warn("[email] sendBookingConfirmedEmail failed:", e); }
}

export async function sendBookingReminderEmail(opts: {
  to: string; name: string; startsAt: string; meetLink: string | null;
  manageToken: string; lang?: "fr" | "en" | "de";
}): Promise<void> {
  const r = getResend(); if (!r) return;
  const lang = opts.lang ?? "en";
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  try {
    await r.emails.send({
      from: FROM,
      to: opts.to,
      subject: subj(T("Tomorrow: your call with Borivon", "Morgen: Ihr Termin bei Borivon", "Demain : votre rendez-vous Borivon")),
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#fff;">
          ${T("See you tomorrow", "Bis morgen", "À demain")}
        </h1>
        <p style="margin:0 0 18px;font-size:16px;color:#fff;font-weight:600;">
          ${esc(whenLine(opts.startsAt, lang))}
        </p>
        ${opts.meetLink ? `
        <a href="${esc(opts.meetLink)}" style="display:inline-block;background:#c9a240;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
          ${T("Join the video call", "Zum Videoanruf", "Rejoindre la visio")} →
        </a>` : ""}
        <p style="margin:20px 0 0;font-size:13px;color:#a0a09a;line-height:1.6;">
          ${T("If the time no longer suits you, please move it rather than missing it — it takes ten seconds.",
              "Falls der Termin nicht mehr passt, verschieben Sie ihn bitte, statt ihn ausfallen zu lassen — es dauert zehn Sekunden.",
              "Si l'horaire ne vous convient plus, déplacez-le plutôt que de le manquer — cela prend dix secondes.")}
        </p>
        ${manageBlock(opts.manageToken, lang)}
      `),
    });
  } catch (e) { console.warn("[email] sendBookingReminderEmail failed:", e); }
}

export async function sendBookingChangedEmail(opts: {
  to: string; name: string; startsAt: string; cancelled: boolean;
  manageToken: string; lang?: "fr" | "en" | "de";
}): Promise<void> {
  const r = getResend(); if (!r) return;
  const lang = opts.lang ?? "en";
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  try {
    await r.emails.send({
      from: FROM,
      to: opts.to,
      subject: subj(opts.cancelled
        ? T("Your Borivon call is cancelled", "Ihr Borivon-Termin ist abgesagt", "Votre rendez-vous Borivon est annulé")
        : T("Your Borivon call has moved", "Ihr Borivon-Termin wurde verschoben", "Votre rendez-vous Borivon a été déplacé")),
      html: baseHtml(`
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#fff;">
          ${opts.cancelled
            ? T("Cancelled", "Abgesagt", "Annulé")
            : T("New time confirmed", "Neuer Termin bestätigt", "Nouvel horaire confirmé")}
        </h1>
        ${opts.cancelled ? `
        <p style="margin:0 0 20px;font-size:14px;color:#a0a09a;line-height:1.6;">
          ${T("Your call has been cancelled. You're welcome to book another time whenever suits you.",
              "Ihr Termin wurde abgesagt. Sie können jederzeit einen neuen buchen.",
              "Votre rendez-vous a été annulé. Vous pouvez en réserver un autre quand vous voulez.")}
        </p>
        <a href="${BASE}/book" style="display:inline-block;background:#c9a240;color:#131312;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none;">
          ${T("Book another time", "Neuen Termin buchen", "Réserver un autre créneau")} →
        </a>` : `
        <p style="margin:0 0 18px;font-size:16px;color:#fff;font-weight:600;">
          ${esc(whenLine(opts.startsAt, lang))}
        </p>
        <p style="margin:0;font-size:13px;color:#a0a09a;line-height:1.6;">
          ${T("Your calendar invitation has been updated.", "Ihre Kalendereinladung wurde aktualisiert.", "Votre invitation a été mise à jour.")}
        </p>
        ${manageBlock(opts.manageToken, lang)}`}
      `),
    });
  } catch (e) { console.warn("[email] sendBookingChangedEmail failed:", e); }
}
