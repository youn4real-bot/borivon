/**
 * Inbox SLA cron → during the day, pings the founder (Telegram) about any inbound
 * email left UNANSWERED for SLA_HOURS (6h)+. Unlike the once-a-morning
 * inbox-reminder, this runs every few hours so a same-day email that's been
 * sitting gets surfaced WHILE there's still time to reply. Each email is nudged
 * exactly ONCE (deduped in inbox_sla_nudges). Read-only on the mailbox — it never
 * sends or modifies mail. Gated by the inbox_sla automation switch.
 *
 * Inert unless the Gmail App-Password creds are set + IMAP is enabled
 * (getUnansweredEmails returns null → skip), and silent until the
 * inbox_sla_nudges migration is run (filterUnnudged fails safe → []).
 */
import { NextRequest } from "next/server";
import { getUnansweredEmails } from "@/lib/gmailInbox";
import { tgSend, telegramConfigured } from "@/lib/telegram";
import { isAutomationEnabled } from "@/lib/automationSettings";
import { SLA_HOURS, hoursOld, filterUnnudged, recordNudged, formatSlaEmails } from "@/lib/inboxSla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!telegramConfigured() || !chatId) return Response.json({ skipped: "telegram_not_configured" });
  if (!(await isAutomationEnabled("inbox_sla"))) return Response.json({ skipped: "disabled" });

  // Unread, real-person emails from the last few days (the morning briefing owns
  // the long backlog; the SLA targets fresh same-day breaches).
  const emails = await getUnansweredEmails(40, 3);
  if (emails === null) return Response.json({ skipped: "gmail_read_unavailable" });

  const now = Date.now();
  const breached = emails.filter((e) => hoursOld(e, now) >= SLA_HOURS);
  const fresh = await filterUnnudged(breached);
  if (fresh.length === 0) return Response.json({ sent: false, breached: breached.length });

  await tgSend(chatId, formatSlaEmails(fresh, now));
  await recordNudged(fresh);
  return Response.json({ sent: true, count: fresh.length });
}
