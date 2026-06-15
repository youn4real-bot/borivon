/**
 * Orchestration for the 6-hour email SLA — kept separate from the PURE helpers in
 * lib/inboxSla.ts (which stay import-light + unit-tested). This reads the inbox,
 * keeps 6h+ breaches, dedupes, and pings the founder ONCE per email.
 *
 * Driven from the existing midday + evening nudge cron (the Hobby plan caps crons
 * at once-per-day, so we ride the runs that already fire rather than add a
 * high-frequency cron). On Vercel Pro this can also be wired to a dedicated
 * every-3h cron via /api/cron/inbox-sla.
 */
import { getUnansweredEmails } from "@/lib/gmailInbox";
import { tgSend } from "@/lib/telegram";
import { isAutomationEnabled } from "@/lib/automationSettings";
import { SLA_HOURS, hoursOld, filterUnnudged, recordNudged, formatSlaEmails } from "@/lib/inboxSla";

export async function runInboxSlaNudge(chatId: string): Promise<{ sent: boolean; count: number; skipped?: string }> {
  if (!chatId) return { sent: false, count: 0, skipped: "no_chat" };
  if (!(await isAutomationEnabled("inbox_sla"))) return { sent: false, count: 0, skipped: "disabled" };

  const emails = await getUnansweredEmails(40, 3); // unread, real people, last 3 days
  if (emails === null) return { sent: false, count: 0, skipped: "gmail_unavailable" };

  const now = Date.now();
  const breached = emails.filter((e) => hoursOld(e, now) >= SLA_HOURS);
  const fresh = await filterUnnudged(breached); // fail-safe → [] when not migrated (no spam)
  if (fresh.length === 0) return { sent: false, count: 0 };

  await tgSend(chatId, formatSlaEmails(fresh, now));
  await recordNudged(fresh);
  return { sent: true, count: fresh.length };
}
