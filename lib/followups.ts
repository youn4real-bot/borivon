/**
 * Outbound email follow-up chase — helpers. When the founder sends an external
 * email it's recorded here; a cron (lib/followupsRun) checks for a reply and, if
 * none, reminds the founder to follow up — up to MAX nudges, ~every 12h, until
 * they reply. Pure bits are unit-tested; the DB/Gmail parts run in prod.
 *
 * FAIL-SAFE: every DB call swallows its own errors so a missing migration just
 * makes the feature a silent no-op (never a crash, never spam).
 */
import { getServiceSupabase } from "@/lib/supabase";

/** Hours since the last nudge before an open follow-up is eligible again. Set
 *  just under 12h so the morning + evening cron passes (≈11h apart) each fire it
 *  once → roughly a 12-hourly chase without a high-frequency cron (Hobby caps
 *  crons at once/day). */
export const FOLLOWUP_GATE_HOURS = 10;
/** Stop chasing after this many nudges with no reply (≈ 4 days). */
export const FOLLOWUP_MAX_NUDGES = 8;

export type FollowupRow = { id: number; to_email: string; subject: string; sent_at: string; last_nudge_at: string; nudge_count: number };

/** Record a sent external email so we chase a reply. Best-effort, fail-safe. */
export async function recordSentForFollowup(ownerUserId: string | null, toEmail: string, subject: string): Promise<void> {
  const email = (toEmail || "").trim().toLowerCase();
  if (!ownerUserId || !email.includes("@")) return;
  try {
    await getServiceSupabase().from("email_followup_chase").insert({
      owner_user_id: ownerUserId, to_email: email.slice(0, 254), subject: (subject || "").slice(0, 200),
    });
  } catch {
    /* table not migrated / transient → drop silently */
  }
}

/** Manually stop chasing a recipient ("I handled Anna" / "stop chasing Anna").
 *  Returns how many open follow-ups were closed. */
export async function stopFollowupsFor(ownerUserId: string, toEmail: string): Promise<number> {
  const email = (toEmail || "").trim().toLowerCase();
  if (!ownerUserId || !email) return 0;
  try {
    const { data } = await getServiceSupabase()
      .from("email_followup_chase")
      .update({ done: true })
      .eq("owner_user_id", ownerUserId).eq("to_email", email).eq("done", false)
      .select("id");
    return (data ?? []).length;
  } catch {
    return 0;
  }
}

export function hoursSince(iso: string, now: number): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : (now - t) / 3_600_000;
}

/** One consolidated "waiting on replies" digest (never one ping per email). */
export function formatFollowups(items: { to_email: string; subject: string; sent_at: string; nudge: number }[], now: number): string {
  const lines = ["⏳ No reply yet — want to follow up?", ""];
  for (const it of items.slice(0, 15)) {
    const h = hoursSince(it.sent_at, now);
    const ago = h >= 24 ? `${Math.floor(h / 24)}d ago` : `${Math.floor(h)}h ago`;
    lines.push(`• ${it.to_email} — "${it.subject || "(no subject)"}" (sent ${ago}, reminder ${it.nudge}/${FOLLOWUP_MAX_NUDGES})`);
  }
  if (items.length > 15) lines.push(`…and ${items.length - 15} more.`);
  lines.push("");
  lines.push("Say 'follow up with <name>' and I'll draft it in the same thread — or 'stop chasing <name>' to drop it.");
  return lines.join("\n");
}
