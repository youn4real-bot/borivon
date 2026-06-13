/**
 * Inbox-reminder cron → each morning, reminds the founder (via Telegram) of
 * UNANSWERED emails: unread messages in their Gmail inbox from real people
 * (no-reply / automated senders are skipped). Read-only — it never sends or
 * touches mail, only surfaces what's waiting. Gated by the inbox_reminder
 * automation switch. Scheduled in vercel.json (crons).
 *
 * Inert unless the Gmail App-Password creds (GMAIL_USER + GMAIL_APP_PASSWORD)
 * are set AND IMAP is enabled on the account — otherwise getUnansweredEmails
 * returns null and we skip quietly.
 */
import { NextRequest } from "next/server";
import { getUnansweredEmails, formatUnansweredEmails } from "@/lib/gmailInbox";
import { tgSend, telegramConfigured } from "@/lib/telegram";
import { isAutomationEnabled } from "@/lib/automationSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!telegramConfigured() || !chatId) {
    return Response.json({ skipped: "telegram_not_configured" });
  }
  if (!(await isAutomationEnabled("inbox_reminder"))) {
    return Response.json({ skipped: "disabled" });
  }
  // The morning briefing now FOLDS IN the unanswered-email list, so when it's on
  // this separate push would just be a duplicate — skip it. It only fires
  // standalone if the briefing is turned off but inbox_reminder is left on.
  if (await isAutomationEnabled("daily_briefing")) {
    return Response.json({ skipped: "covered_by_briefing" });
  }

  const emails = await getUnansweredEmails(20);
  if (emails === null) return Response.json({ skipped: "gmail_read_unavailable" });
  // Only ping when there's actually something waiting — no daily "inbox clear" noise.
  if (emails.length === 0) return Response.json({ sent: false, count: 0 });

  await tgSend(chatId, formatUnansweredEmails(emails));
  return Response.json({ sent: true, count: emails.length });
}
