/**
 * Weekly business report cron → pushes the Monday "state of the business" to the
 * founder's Telegram. Scheduled in vercel.json (crons). Gated by the
 * weekly_report automation switch (toggle from the bot: setAutomation).
 *
 * Inert until TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are configured. Auth via the
 * Vercel-injected Authorization: Bearer <CRON_SECRET>, same as /api/cron/briefing.
 */
import { NextRequest } from "next/server";
import { computeWeeklyReport } from "@/lib/weeklyReport";
import { tgSend, telegramConfigured } from "@/lib/telegram";
import { isAutomationEnabled } from "@/lib/automationSettings";
import { isBotQuiet } from "@/lib/botQuiet";

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
  if (await isBotQuiet()) return Response.json({ skipped: "quiet" });
  if (!(await isAutomationEnabled("weekly_report"))) {
    return Response.json({ skipped: "disabled" });
  }

  const { text, count } = await computeWeeklyReport();
  await tgSend(chatId, text);
  return Response.json({ sent: true, count });
}
