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
 */
import { getServiceSupabase } from "@/lib/supabase";

const KEY = "bot_quiet";

/** True when the founder has silenced all proactive messages. Fail-safe → false. */
export async function isBotQuiet(): Promise<boolean> {
  try {
    const db = getServiceSupabase();
    const { data, error } = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    if (error) return false;
    return (data as { value: string } | null)?.value === "on";
  } catch {
    return false;
  }
}

/** Turn the quiet switch on/off. Best-effort (never throws). */
export async function setBotQuiet(on: boolean): Promise<void> {
  try {
    const db = getServiceSupabase();
    await db.from("app_settings").upsert({ key: KEY, value: on ? "on" : "off", updated_at: new Date().toISOString() });
  } catch {
    /* best effort */
  }
}
