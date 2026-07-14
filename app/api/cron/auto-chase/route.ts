/**
 * Auto-chase cron → each morning, surfaces candidates who may need a nudge
 * (went quiet / didn't re-submit a rejected doc) to the founder's Telegram.
 * DRAFT → APPROVE: this only SURFACES — the founder approves the actual nudge
 * (nudgeStuckCandidates / sendCandidateMessage, both confirm-first). Gated by
 * the auto_chase automation switch. Scheduled in vercel.json (crons).
 */
import { NextRequest } from "next/server";
import { computeStuckCandidates } from "@/lib/autoChase";
import { tgSend, getAdminUserId, telegramConfigured } from "@/lib/telegram";
import { isAutomationEnabled } from "@/lib/automationSettings";
import { isBotQuiet } from "@/lib/botQuiet";
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
  if (await isBotQuiet()) return Response.json({ skipped: "quiet" });

  // Fire any now-due personal reminders first — independent of the auto_chase toggle.
  const reminders = await fireDueReminders(chatId, await getAdminUserId()).catch(() => ({ fired: 0 }));

  if (!(await isAutomationEnabled("auto_chase"))) {
    return Response.json({ skipped: "disabled", reminders });
  }
  // The morning briefing now FOLDS IN the stuck-candidate list, so when it's on
  // this separate push would just be a duplicate — skip it. It only fires
  // standalone if the briefing is turned off but auto_chase is left on.
  if (await isAutomationEnabled("daily_briefing")) {
    return Response.json({ skipped: "covered_by_briefing", reminders });
  }

  const { text, count } = await computeStuckCandidates();
  // Only ping when there's actually someone to chase — no daily "nobody's stuck" noise.
  if (count === 0) return Response.json({ sent: false, count: 0, reminders });
  await tgSend(chatId, text);
  return Response.json({ sent: true, count, reminders });
}
