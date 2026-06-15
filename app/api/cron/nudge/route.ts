/**
 * All-day nudger → re-pings the founder midday + evening with ONLY what's still
 * open from today's "what needs you today" list, until it's cleared. This is the
 * "beat my ass all day until I get it done" loop the founder asked for.
 *
 * The list is live-recomputed from computeBriefing, so items that got resolved
 * since the morning (a date confirmed, a candidate warmed/logged in, a doc
 * reviewed) naturally fall off — when count hits 0 we stay silent (silence =
 * you cleared it). Rides on the daily_briefing switch; ?slot=midday|evening only
 * changes the tone. Scheduled in vercel.json.
 */
import { NextRequest } from "next/server";
import { computeBriefing } from "@/lib/briefing";
import { tgSend, getAdminUserId, telegramConfigured } from "@/lib/telegram";
import { isAutomationEnabled } from "@/lib/automationSettings";
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

  // 6-hour email SLA — runs on this pass INDEPENDENTLY of the briefing toggle
  // (Hobby caps crons at once/day, so the SLA rides the midday + evening nudge
  // runs). Gated by its own inbox_sla switch; nudges each email once.
  const sla = await runInboxSlaNudge(chatId).catch(() => ({ sent: false, count: 0, skipped: "error" as const }));

  // The all-day nudge is the same "what needs you today" list re-pinged — it
  // rides on the briefing switch, so turning the briefing off silences it too.
  if (!(await isAutomationEnabled("daily_briefing"))) return Response.json({ skipped: "disabled", sla });

  const slot = (req.nextUrl.searchParams.get("slot") || "").toLowerCase();
  const adminUserId = await getAdminUserId();
  const { text, count } = await computeBriefing(adminUserId);
  // Silence = you cleared it. Only re-ping while something's still open.
  if (count === 0) return Response.json({ sent: false, count: 0, slot, sla });

  const prefix = slot === "evening"
    ? "🌙 End of day — still open. Clear these before you log off:\n\n"
    : "⏳ Midday check — still on your plate:\n\n";
  await tgSend(chatId, prefix + text);
  return Response.json({ sent: true, count, slot, sla });
}
