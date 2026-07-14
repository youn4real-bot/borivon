/**
 * Daily briefing cron → pushes "what needs you today" to the founder's Telegram.
 * Scheduled in vercel.json (crons). Vercel automatically sends
 * Authorization: Bearer <CRON_SECRET> when the CRON_SECRET env var is set, which
 * we verify so the endpoint can't be triggered by anyone else.
 *
 * Inert until TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are configured.
 */
import { NextRequest } from "next/server";
import { computeBriefing } from "@/lib/briefing";
import { tgSend, getAdminUserId, telegramConfigured } from "@/lib/telegram";
import { isAutomationEnabled } from "@/lib/automationSettings";
import { isBotQuiet } from "@/lib/botQuiet";
import { runFollowupChase } from "@/lib/followupsRun";
import { fireDueReminders } from "@/lib/reminderFire";

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
  if (await isBotQuiet()) return Response.json({ skipped: "quiet" }); // founder silenced all proactive messages

  // Fire any now-due personal reminders FIRST — independent of the briefing toggle
  // (a reminder isn't the briefing; it should ping even if the briefing is muted).
  const adminUserId = await getAdminUserId();
  const reminders = await fireDueReminders(chatId, adminUserId).catch(() => ({ fired: 0 }));

  // Outbound follow-up chase rides this morning pass (≈12h from the evening nudge
  // run), independent of the briefing toggle — gated by its own followup_chase switch.
  const followups = await runFollowupChase(chatId).catch(() => ({ sent: false, nudged: 0, resolved: 0, skipped: "error" as const }));

  if (!(await isAutomationEnabled("daily_briefing"))) {
    return Response.json({ skipped: "disabled", followups, reminders });
  }

  const { text, count } = await computeBriefing(adminUserId);
  await tgSend(chatId, text);
  return Response.json({ sent: true, count, followups, reminders });
}
