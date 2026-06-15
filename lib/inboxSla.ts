/**
 * 6-hour email SLA — helpers for the intra-day "you haven't replied" nudge.
 *
 * The cron (/api/cron/inbox-sla) reads unanswered inbox emails (lib/gmailInbox),
 * keeps those older than SLA_HOURS, drops any it already nudged about, pings the
 * founder once, and records them. Dedup lives in inbox_sla_nudges (tiny text
 * rows). Pure functions here are unit-tested; the DB + IMAP parts run in prod.
 */
import { getServiceSupabase } from "@/lib/supabase";
import type { UnansweredEmail } from "@/lib/gmailInbox";

/** Hours before an unanswered email earns a nudge. */
export const SLA_HOURS = 6;

/** Stable per-message dedup key: sender + exact receive time (both immutable). */
export function slaKey(e: UnansweredEmail): string {
  return `${e.from}|${e.date}`.slice(0, 300);
}

/** Hours since the email arrived. */
export function hoursOld(e: UnansweredEmail, now: number = Date.now()): number {
  const t = Date.parse(e.date);
  return Number.isNaN(t) ? 0 : (now - t) / 3_600_000;
}

/**
 * Of `emails`, return only those NOT already nudged. FAIL-SAFE: on ANY DB error
 * (e.g. the inbox_sla_nudges table isn't migrated yet) returns [] — so the cron
 * stays SILENT rather than re-pinging the same emails every run. The feature
 * switches on the moment the migration is applied.
 */
export async function filterUnnudged(emails: UnansweredEmail[]): Promise<UnansweredEmail[]> {
  if (emails.length === 0) return [];
  try {
    const db = getServiceSupabase();
    const keys = emails.map(slaKey);
    const { data, error } = await db.from("inbox_sla_nudges").select("key").in("key", keys);
    if (error) return [];
    const seen = new Set(((data ?? []) as { key: string }[]).map((r) => r.key));
    return emails.filter((e) => !seen.has(slaKey(e)));
  } catch {
    return [];
  }
}

/** Record that these were nudged (so they never re-ping) + prune rows >30d old. */
export async function recordNudged(emails: UnansweredEmail[]): Promise<void> {
  if (emails.length === 0) return;
  try {
    const db = getServiceSupabase();
    await db.from("inbox_sla_nudges").upsert(emails.map((e) => ({ key: slaKey(e) })), { onConflict: "key" });
    await db.from("inbox_sla_nudges").delete().lt("nudged_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  } catch {
    /* best-effort — a failed record just risks one extra ping, never a crash */
  }
}

/** Telegram-friendly "still waiting on your reply" message. */
export function formatSlaEmails(emails: UnansweredEmail[], now: number = Date.now()): string {
  const lines = [`⏰ Still waiting on your reply (${SLA_HOURS}h+):`, ""];
  for (const e of emails.slice(0, 15)) {
    const h = Math.floor(hoursOld(e, now));
    const age = h >= 24 ? `${Math.floor(h / 24)}d ago` : `${h}h ago`;
    lines.push(`• ${e.fromName} — ${e.subject} (${age})`);
  }
  if (emails.length > 15) lines.push(`…and ${emails.length - 15} more.`);
  lines.push("");
  lines.push("Say \"reply to <name> …\" and I'll draft it.");
  return lines.join("\n");
}
