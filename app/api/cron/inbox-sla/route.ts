/**
 * Inbox SLA cron → pings the founder (Telegram) about any inbound email left
 * UNANSWERED for 6h+, each one exactly ONCE. Read-only on the mailbox.
 *
 * NOTE: on the Hobby plan crons are once-per-day only, so the SLA is normally
 * driven from the existing midday + evening nudge cron (see runInboxSlaNudge
 * called in /api/cron/nudge). This standalone route stays for a MANUAL trigger
 * and so a Vercel-Pro account can point a dedicated every-3h cron at it.
 */
import { NextRequest } from "next/server";
import { telegramConfigured } from "@/lib/telegram";
import { runInboxSlaNudge } from "@/lib/inboxSlaRun";

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
  return Response.json(await runInboxSlaNudge(chatId));
}
