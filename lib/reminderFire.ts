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
import { tgSend } from "@/lib/telegram";
import { nextOccurrence, fmtWhen, type Recurrence } from "@/lib/reminderTime";

type DueRow = { id: string; text: string; due_at: string; recurrence?: string | null };

export type FireResult = { fired: number; skipped?: string };

/**
 * Send every reminder that is now due (due_at <= now, open, not yet notified) to
 * `chatId`. If `ownerUserId` is given, only that owner's reminders fire (the webhook
 * passes the admin's id); the cron passes it too. Returns how many fired.
 */
export async function fireDueReminders(chatId: string | number, ownerUserId?: string | null): Promise<FireResult> {
  const id = String(chatId ?? "").trim();
  if (!id) return { fired: 0, skipped: "no_chat" };
  const db = getServiceSupabase();
  const nowIso = new Date().toISOString();

  let rows: DueRow[];
  try {
    let qb = db
      .from("assistant_reminders")
      .select("id, text, due_at, recurrence")
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
    // CLAIM first (optimistic lock): only succeeds while notified_at is still null,
    // so a concurrent webhook + cron tick can't both send this reminder.
    const { data: claimed } = await db
      .from("assistant_reminders")
      .update({ notified_at: new Date().toISOString(), remind_count: 1 })
      .eq("id", r.id)
      .is("notified_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue; // already fired by another trigger
    const rec = (r.recurrence || "").trim() as Recurrence | "";
    const next = rec === "daily" || rec === "weekly" || rec === "monthly" ? nextOccurrence(r.due_at, rec) : null;
    try {
      const suffix = next ? `\n(repeats — next: ${fmtWhen(next)})` : "";
      await tgSend(id, `⏰ Reminder: ${r.text}${suffix}`);
      fired++;
      // Recurring → re-arm the next occurrence (clear the claim, advance due_at) so it
      // keeps pinging until the founder marks it done.
      if (next) {
        await db.from("assistant_reminders")
          .update({ notified_at: null, due_at: next.toISOString() })
          .eq("id", r.id);
      }
    } catch {
      // Send threw (network) — release the claim so a later trigger retries it.
      await db.from("assistant_reminders").update({ notified_at: null, remind_count: 0 }).eq("id", r.id);
    }
  }
  return { fired };
}
