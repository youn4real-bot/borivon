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
import { isBotQuiet } from "@/lib/botQuiet";
import { runInboxSlaNudge } from "@/lib/inboxSlaRun";
import { runCommitmentScan, runCommitmentChase } from "@/lib/commitmentsRun";
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
  if (!telegramConfigured() || !chatId) return Response.json({ skipped: "telegram_not_configured" });

  // QUIET GATE FIRST — including for the dropped-promise scan.
  //
  // The scan used to run BEFORE this gate, deliberately: it is silent, and the
  // reasoning was that "what is everyone owing me?" should still have data to
  // answer from while the bot is muted. But it costs A MODEL CALL PER EMAIL, so
  // "quiet" silenced the messages while quietly continuing to spend — which is
  // the opposite of what someone muting the bot expects, and the founder asked
  // for it to stop draining tokens, not just stop talking.
  //
  // Quiet now means QUIET: no messages and no model spend. The trade is that
  // promises made while muted are not captured, so the commitments list will
  // have a gap covering the mute; that is the correct trade when the explicit
  // instruction is to stop spending.
  if (await isBotQuiet()) return Response.json({ skipped: "quiet" });

  const commitAdminId = (await getAdminUserId()) ?? "";
  if (commitAdminId && (req.nextUrl.searchParams.get("slot") || "").toLowerCase() === "evening") {
    await runCommitmentScan(commitAdminId).catch(() => 0);
  }

  // Fire any now-due personal reminders first — independent of every toggle below.
  const reminders = await fireDueReminders(chatId, await getAdminUserId()).catch(() => ({ fired: 0 }));

  // 6-hour email SLA — runs on this pass INDEPENDENTLY of the briefing toggle
  // (Hobby caps crons at once/day, so the SLA rides the midday + evening nudge
  // runs). Gated by its own inbox_sla switch; nudges each email once.
  const sla = await runInboxSlaNudge(chatId).catch(() => ({ sent: false, count: 0, skipped: "error" as const }));
  // Outbound follow-up chase — also rides this pass (its own ~12h gate + toggle).
  const followups = await runFollowupChase(chatId).catch(() => ({ sent: false, nudged: 0, resolved: 0, skipped: "error" as const }));
  // Chase the promises that went past due (the scan already ran above, before
  // the quiet gate). Own toggle + 20h gate + 4-nudge cap.
  const commitments = commitAdminId
    ? await runCommitmentChase(chatId, commitAdminId).catch(() => ({ sent: false, count: 0, skipped: "error" as const }))
    : { sent: false, count: 0, skipped: "no_admin" as const };

  // The all-day nudge is the same "what needs you today" list re-pinged — it
  // rides on the briefing switch, so turning the briefing off silences it too.
  if (!(await isAutomationEnabled("daily_briefing"))) return Response.json({ skipped: "disabled", sla, followups, commitments, reminders });

  const slot = (req.nextUrl.searchParams.get("slot") || "").toLowerCase();
  const adminUserId = await getAdminUserId();
  const { text, count } = await computeBriefing(adminUserId);
  // Silence = you cleared it. Only re-ping while something's still open.
  if (count === 0) return Response.json({ sent: false, count: 0, slot, sla, followups, commitments, reminders });

  const prefix = slot === "evening"
    ? "🌙 End of day — still open. Clear these before you log off:\n\n"
    : "⏳ Midday check — still on your plate:\n\n";
  await tgSend(chatId, prefix + text);
  return Response.json({ sent: true, count, slot, sla, followups, reminders });
}
