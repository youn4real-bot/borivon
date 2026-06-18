/**
 * Reminder-firing endpoint → pushes any now-due personal reminders to the founder's
 * Telegram, exactly once each. This is the TIME-PRECISE trigger.
 *
 * We're on Vercel Hobby (crons run at most daily), so the founder gets to-the-minute
 * reminders one of two ways — both hit THIS endpoint:
 *   • An external uptime pinger (e.g. cron-job.org) every minute, OR
 *   • Supabase pg_cron + pg_net (recommended — stays in the existing stack, $0, no new
 *     account): see supabase/reminders_pg_cron.sql.
 * (The existing daily briefing/nudge/auto-chase/inbox crons ALSO fire reminders, and
 * every inbound Telegram message flushes due ones — so even with no pinger, reminders
 * still land; the pinger just makes the timing exact.)
 *
 * Auth: accepts the secret either as `Authorization: Bearer <CRON_SECRET>` (Vercel's
 * own cron style) OR as `?secret=<CRON_SECRET>` (external pingers / pg_net can't set
 * arbitrary headers easily). Inert until TELEGRAM_CHAT_ID + CRON_SECRET are configured.
 */
import { NextRequest } from "next/server";
import { getAdminUserId, telegramConfigured } from "@/lib/telegram";
import { fireDueReminders } from "@/lib/reminderFire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const headerOk = req.headers.get("authorization") === `Bearer ${cronSecret}`;
    const queryOk = req.nextUrl.searchParams.get("secret") === cronSecret;
    if (!headerOk && !queryOk) return new Response("forbidden", { status: 403 });
  }

  const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!telegramConfigured() || !chatId) return Response.json({ skipped: "telegram_not_configured" });

  const reminders = await fireDueReminders(chatId, await getAdminUserId()).catch(() => ({ fired: 0, skipped: "error" as const }));
  return Response.json({ ok: true, ...reminders });
}
