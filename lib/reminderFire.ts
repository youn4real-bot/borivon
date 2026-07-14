/**
 * FIRING reminders at their due time — the piece that was missing entirely.
 *
 * Before this, a reminder's time was thrown away and nothing pushed it; open
 * reminders only ever surfaced bundled into the 6am briefing / midday+evening
 * nudges. Now a reminder with a `due_at` fires as its OWN Telegram ping the moment
 * it's due, exactly once.
 *
 * Delivery triggers (we're on Vercel HOBBY — sub-daily crons aren't reliable, so we
 * don't depend on one):
 *   1. Opportunistic — every inbound Telegram message flushes anything now-due
 *      (the founder messages the bot constantly, so this catches most in near-real-time).
 *   2. The existing daily crons (briefing 6am, nudge 12pm/5pm, auto-chase 8am,
 *      inbox 8:30am) each call this too → guaranteed delivery windows without a new cron.
 *   3. Optional: a dedicated /api/cron/reminders endpoint an external/Supabase pinger
 *      can hit every minute for true to-the-minute firing (see that route).
 *
 * Idempotency: we CLAIM each reminder with an optimistic update (set notified_at only
 * while it's still null) BEFORE sending, so two concurrent triggers can never
 * double-send the same reminder.
 *
 * Fail-safe: if the due_at/notified_at columns don't exist yet (migration not run),
 * the query errors and we return {fired:0, skipped} — never throw, never block a message.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { tgSendReturningId } from "@/lib/telegram";
import { nextFutureOccurrence, type Recurrence } from "@/lib/reminderTime";
import { isBotQuiet } from "@/lib/botQuiet";

type DueRow = { id: string; text: string; due_at: string; due_date?: string | null; recurrence?: string | null; remind_count?: number | null };

export type FireResult = { fired: number; skipped?: string };

/**
 * Send every reminder that is now due (due_at <= now, open, not yet notified) to
 * `chatId`. If `ownerUserId` is given, only that owner's reminders fire (the webhook
 * passes the admin's id); the cron passes it too. Returns how many fired.
 */
export async function fireDueReminders(chatId: string | number, ownerUserId?: string | null): Promise<FireResult> {
  const id = String(chatId ?? "").trim();
  if (!id) return { fired: 0, skipped: "no_chat" };
  // Global quiet switch — when the founder silenced the bot, reminders don't ping
  // (they stay open and un-notified, so they resume the moment he lifts quiet).
  if (await isBotQuiet()) return { fired: 0, skipped: "quiet" };
  const db = getServiceSupabase();
  const nowIso = new Date().toISOString();

  let rows: DueRow[];
  try {
    let qb = db
      .from("assistant_reminders")
      .select("id, text, due_at, due_date, recurrence, remind_count")
      .eq("done", false)
      .is("notified_at", null)
      .not("due_at", "is", null)
      .lte("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(25);
    if (ownerUserId) qb = qb.eq("owner_user_id", ownerUserId);
    const { data, error } = await qb;
    if (error) return { fired: 0, skipped: "no_due_at_column" }; // migration not run yet
    rows = (data ?? []) as DueRow[];
  } catch {
    return { fired: 0, skipped: "error" };
  }
  if (!rows.length) return { fired: 0 };

  let fired = 0;
  for (const r of rows) {
    // CLAIM first (optimistic lock): only succeeds while notified_at is still null AND the
    // row's due_at is still the one this worker SELECTed. The due_at match closes a race on
    // RECURRING reminders: after we send + re-arm (notified_at→null, due_at→next), a trigger
    // whose stale SELECT ran before the re-arm would otherwise re-claim the now-null
    // notified_at and double-send. Pinning due_at means that trigger's claim matches 0 rows
    // (due_at already advanced), so each occurrence fires exactly once.
    const { data: claimed } = await db
      .from("assistant_reminders")
      // ACCUMULATE remind_count across occurrences (was hardcoded to 1, so it never grew
      // — would silently break any future snooze/escalation built on the count).
      .update({ notified_at: new Date().toISOString(), remind_count: (r.remind_count ?? 0) + 1 })
      .eq("id", r.id)
      .eq("due_at", r.due_at)
      .is("notified_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue; // already fired by another trigger
    const rec = (r.recurrence || "").trim() as Recurrence | "";
    // For MONTHLY, derive the original day-of-month from due_date (which re-arm never
    // overwrites — only due_at advances), so "the 31st" keeps returning the 31st instead of
    // collapsing to the 28th forever after the first February. due_date is "YYYY-MM-DD".
    const anchorDom = rec === "monthly" && r.due_date && /^\d{4}-\d{2}-\d{2}/.test(r.due_date)
      ? parseInt(r.due_date.slice(8, 10), 10)
      : undefined;
    // Re-arm to the next FUTURE occurrence. On Hobby a daily reminder can sit days
    // overdue; advancing only +1 period could still be in the past → it would re-fire
    // on the next message. nextFutureOccurrence skips forward until the slot is ahead of now.
    const next = rec === "daily" || rec === "weekly" || rec === "monthly" ? nextFutureOccurrence(r.due_at, rec, undefined, anchorDom) : null;
    try {
      // MINIMALIST (founder's hard rule): a reminder ping is LITERALLY just the task — no
      // emoji, no "Reminder:" label, no "(repeats…)" suffix. Just what to do.
      const pingId = await tgSendReturningId(id, r.text);
      fired++;
      // Recurring → re-arm the next occurrence (clear the claim, advance due_at) so it
      // keeps pinging until the founder marks it done.
      if (next) {
        await db.from("assistant_reminders")
          .update({ notified_at: null, due_at: next.toISOString() })
          .eq("id", r.id);
      }
      // Remember THIS ping's message_id so a reply-to of "done"/"+1h"/"tomorrow 9" can target
      // this exact reminder. A SEPARATE, self-contained best-effort update: a not-yet-migrated
      // last_ping_message_id column must NEVER break the re-arm above nor trip the claim-release
      // catch below (which would wrongly re-fire the reminder).
      if (pingId != null) {
        try { await db.from("assistant_reminders").update({ last_ping_message_id: pingId }).eq("id", r.id); } catch { /* column not migrated → ignore */ }
      }
    } catch {
      // Send threw (network) — release the claim so a later trigger retries it.
      await db.from("assistant_reminders").update({ notified_at: null, remind_count: 0 }).eq("id", r.id);
    }
  }
  return { fired };
}
