/**
 * Auto-chase cron → each morning, surfaces candidates who may need a nudge
 * (went quiet / didn't re-submit a rejected doc) to the founder's Telegram.
 * DRAFT → APPROVE: this only SURFACES — the founder approves the actual nudge
 * (nudgeStuckCandidates / sendCandidateMessage, both confirm-first). Gated by
 * the auto_chase automation switch. Scheduled in vercel.json (crons).
 */
import { NextRequest } from "next/server";
import { computeStuckCandidates } from "@/lib/autoChase";
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
  if (!(await isAutomationEnabled("auto_chase"))) {
    return Response.json({ skipped: "disabled" });
  }

  const { text, count } = await computeStuckCandidates();
  // Only ping when there's actually someone to chase — no daily "nobody's stuck" noise.
  if (count === 0) return Response.json({ sent: false, count: 0 });
  await tgSend(chatId, text);
  return Response.json({ sent: true, count });
}
