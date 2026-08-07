/**
 * Global QUIET SWITCH. When ON, the bot sends the founder NOTHING on its own —
 * no morning briefing, no midday/evening nudges, no weekly report, no auto-chase,
 * no inbox reminders/SLA, no follow-up chase, and no personal-reminder pings. It
 * still fully ANSWERS whenever he messages it. He toggles it by chatting:
 *   "stop all reminders" / "only answer when I ask" / "go quiet"  → quiet ON
 *   "resume reminders"   / "turn reminders back on"               → quiet OFF
 *
 * Stored in app_settings (key='bot_quiet') so it persists without a redeploy.
 * FAIL-SAFE: any trouble reading it → returns false (NOT quiet) so a DB blip can
 * never silently swallow the founder's automations forever.
 *
 * IT NOW EXPIRES. "Go quiet" means "not right now", not "never again" — but it
 * was stored as a permanent flag, so a mute set on 14 July was still swallowing
 * eight of the nine scheduled jobs 24 days later, and nothing anywhere said so.
 * Every one of those jobs answers `{skipped:"quiet"}` with HTTP 200, so the
 * failure alarm saw a healthy run every time. That is precisely how a month of
 * silence goes unnoticed.
 *
 * After QUIET_MAX_DAYS the switch lifts itself, flips the stored row to "off" so
 * the state on disk is honest, and sends ONE message explaining why the bot
 * started talking again. Re-muting is one sentence.
 */
import { getServiceSupabase } from "@/lib/supabase";

const KEY = "bot_quiet";

/** How long a mute lasts before it lifts itself. */
export const QUIET_MAX_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * Pure core, so the expiry rule is testable without a database or a clock.
 * `updatedAt` is when the mute was last set.
 */
export function quietHasExpired(
  value: string | null | undefined,
  updatedAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (value !== "on") return false;
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  // No usable timestamp → treat the mute as live rather than silently lifting
  // something the founder set. The expiry is a safety net, not a veto.
  if (!Number.isFinite(t)) return false;
  return now - t > QUIET_MAX_DAYS * DAY_MS;
}

/** True when the founder has silenced all proactive messages. Fail-safe → false. */
export async function isBotQuiet(): Promise<boolean> {
  try {
    const db = getServiceSupabase();
    const { data, error } = await db.from("app_settings").select("value, updated_at").eq("key", KEY).maybeSingle();
    if (error) return false;
    const row = data as { value: string; updated_at: string | null } | null;
    if (row?.value !== "on") return false;

    if (quietHasExpired(row.value, row.updated_at)) {
      // Lift it, and say so once. Both are best-effort: if either fails we still
      // return false, because the founder getting his reminders back matters
      // more than the bookkeeping around it.
      await setBotQuiet(false);
      const since = row.updated_at ? row.updated_at.slice(0, 10) : "a while ago";
      try {
        const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
        if (chatId) {
          const { tgSend } = await import("@/lib/telegram");
          await tgSend(
            chatId,
            `Reminders are back on. They were muted on ${since} and a mute lasts ${QUIET_MAX_DAYS} days. Say "go quiet" to mute again.`,
          );
        }
      } catch { /* the mute is already lifted; the notice is a courtesy */ }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Turn the quiet switch on/off. Best-effort (never throws). */
export async function setBotQuiet(on: boolean): Promise<void> {
  try {
    const db = getServiceSupabase();
    // updated_at is what the expiry is measured from, so it must be rewritten
    // on every set — including a re-mute, which restarts the clock.
    await db.from("app_settings").upsert({ key: KEY, value: on ? "on" : "off", updated_at: new Date().toISOString() });
  } catch {
    /* best effort */
  }
}
