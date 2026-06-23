/**
 * Gmail INBOX reader (SERVER ONLY) — read-only IMAP over the founder's EXISTING
 * Gmail App Password (the same GMAIL_USER / GMAIL_APP_PASSWORD already used for
 * outbound SMTP in lib/outboundEmail.ts). Powers the "remind me of unanswered
 * emails" feature (cron push + the listUnansweredEmails bot tool).
 *
 * FAIL-SAFE: returns null on ANY config / connection / parse error so every
 * caller degrades quietly (the bot says it couldn't read the inbox; the cron
 * skips). NEVER throws.
 *
 * "Unanswered" heuristic: messages in INBOX that are UNREAD (\Seen absent) and
 * NOT from an automated / no-reply sender, received within a lookback window.
 * Unread-in-inbox is the clearest "you haven't dealt with this yet" signal, and
 * skipping notification/no-reply senders keeps the reminder to REAL people who
 * are waiting on a reply. Oldest-first so the most overdue is at the top.
 *
 * Requires IMAP enabled on the Gmail account (Gmail → Settings → Forwarding and
 * POP/IMAP → Enable IMAP). App Passwords authenticate over IMAP regardless of
 * 2-Step Verification — no extra credential needed beyond what outbound already
 * uses.
 */
import { ImapFlow } from "imapflow";

export type UnansweredEmail = {
  from: string; // sender email (lowercased)
  fromName: string; // sender display name (falls back to the email)
  subject: string;
  date: string; // ISO 8601
  ageDays: number; // whole days since received
};

/** True when the Gmail App-Password creds are present (same check as outbound). */
export function gmailReadConfigured(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

// Local-part patterns that mark a sender as automated → never a "you must reply"
// email. Kept deliberately broad on the unambiguous machine senders only.
const AUTOMATED_RE =
  /(^|[._-])(no-?reply|do-?not-?reply|donotreply|do-not-respond|notifications?|notify|alerts?|alerting|mailer|mailer-daemon|postmaster|bounce|bounces|automated|auto-?confirm|newsletter|news|updates?|digest|unsubscribe|receipts?|billing|invoices?)@/i;

// On Cloudflare Workers, raw IMAP (imapflow / TCP + App Password) doesn't work, so we read
// "unanswered" via the Gmail API instead (the same shim path that powers search). Vercel keeps
// the proven IMAP path. (this is false on Vercel/Node.)
const ON_WORKERS = typeof navigator !== "undefined" && (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

/** Workers path: unread, non-automated inbox mail via the Gmail API (gmailSearch → shim). */
async function getUnansweredViaGmailApi(limit: number, lookbackDays: number): Promise<UnansweredEmail[] | null> {
  const { gmailSearch } = await import("@/lib/gmailApi");
  const res = await gmailSearch(`in:inbox is:unread -in:chats -in:spam newer_than:${lookbackDays}d`, Math.min(Math.max(limit * 2, 10), 25));
  if (res === null) return null;
  const out: UnansweredEmail[] = [];
  for (const m of res) {
    const email = (m.from || "").toLowerCase().trim();
    if (!email || AUTOMATED_RE.test(email)) continue;
    const when = m.date ? new Date(m.date) : null;
    const valid = when && !Number.isNaN(when.getTime());
    out.push({
      from: email,
      fromName: (m.fromName || email).slice(0, 120),
      subject: (m.subject || "(kein Betreff)").slice(0, 200),
      date: valid ? when!.toISOString() : new Date().toISOString(),
      ageDays: valid ? Math.max(0, Math.floor((Date.now() - when!.getTime()) / 86_400_000)) : 0,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date)); // oldest (most overdue) first
  return out.slice(0, limit);
}

/**
 * Read up to `limit` unanswered (unread, non-automated) INBOX emails received in
 * the last `lookbackDays`. Returns [] when the inbox is clear, or null when the
 * inbox could not be read (creds missing, IMAP disabled, connection failure).
 */
export async function getUnansweredEmails(limit = 20, lookbackDays = 45): Promise<UnansweredEmail[] | null> {
  if (ON_WORKERS) return getUnansweredViaGmailApi(limit, lookbackDays); // IMAP is dead on Workers
  if (!gmailReadConfigured()) return null;

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER as string, pass: process.env.GMAIL_APP_PASSWORD as string },
    logger: false,
    // Bound every phase so a hung socket can never stall the cron / tool call.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 25_000,
  });

  try {
    await client.connect();
    const out: UnansweredEmail[] = [];
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - lookbackDays * 86_400_000);
      // UID search for unread messages received within the window.
      const uids = await client.search({ seen: false, since }, { uid: true });
      if (!uids || uids.length === 0) return [];
      // Cap the fetch so a huge unread pile can't blow the function budget; we
      // take the newest slice, then sort oldest-first below.
      const cap = Math.min(uids.length, Math.max(limit * 3, 60));
      const take = (uids as number[]).slice(-cap);
      for await (const msg of client.fetch(take, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
        const env = msg.envelope;
        if (!env) continue;
        const fromAddr = env.from?.[0];
        const email = (fromAddr?.address || "").toLowerCase().trim();
        if (!email || AUTOMATED_RE.test(email)) continue;
        const whenRaw = msg.internalDate ?? env.date ?? null;
        const when = whenRaw ? new Date(whenRaw) : null;
        if (!when || Number.isNaN(when.getTime())) continue;
        out.push({
          from: email,
          fromName: (fromAddr?.name || email).slice(0, 120),
          subject: (env.subject || "(kein Betreff)").slice(0, 200),
          date: when.toISOString(),
          ageDays: Math.max(0, Math.floor((Date.now() - when.getTime()) / 86_400_000)),
        });
      }
    } finally {
      lock.release();
    }
    out.sort((a, b) => a.date.localeCompare(b.date)); // oldest (most overdue) first
    return out.slice(0, limit);
  } catch (e) {
    console.error("[gmailInbox] read failed:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        /* already gone */
      }
    }
  }
}

/** Telegram-friendly plain-text summary of the unanswered inbox. */
export function formatUnansweredEmails(emails: UnansweredEmail[]): string {
  if (emails.length === 0) return "📭 Inbox clear — no unanswered emails.";
  const lines = [`📧 ${emails.length} unanswered email${emails.length > 1 ? "s" : ""} waiting on you:`, ""];
  for (const e of emails.slice(0, 15)) {
    const age = e.ageDays === 0 ? "today" : e.ageDays === 1 ? "1 day ago" : `${e.ageDays} days ago`;
    lines.push(`• ${e.fromName} — ${e.subject} (${age})`);
  }
  if (emails.length > 15) lines.push(`…and ${emails.length - 15} more.`);
  return lines.join("\n");
}
