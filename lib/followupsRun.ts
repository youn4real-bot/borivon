/**
 * Outbound follow-up chase — orchestration (kept apart from the pure helpers in
 * lib/followups so those stay import-light + unit-tested). For each open sent
 * email: did they reply (any inbound from them after we sent)? → auto-resolve.
 * Else, if it's been ≥ the gate since the last nudge → due. We send ONE digest of
 * all due ones and bump their counters; the 8th nudge closes them out.
 *
 * Driven from the existing morning briefing + evening nudge crons (Hobby caps
 * crons at once/day, so we ride those ≈12h-apart passes).
 */
import { getServiceSupabase } from "@/lib/supabase";
import { gmailSearch } from "@/lib/gmailApi";
import { tgSend, getAdminUserId } from "@/lib/telegram";
import { isAutomationEnabled } from "@/lib/automationSettings";
import { FOLLOWUP_GATE_HOURS, FOLLOWUP_MAX_NUDGES, hoursSince, formatFollowups, type FollowupRow } from "@/lib/followups";

/** Did `toEmail` send us anything AFTER we emailed them? (Heuristic reply check
 *  — "have they gotten back to me", precise to the message timestamp.) */
async function theyReplied(toEmail: string, sentAtIso: string): Promise<boolean> {
  const res = await gmailSearch(`from:${toEmail} newer_than:8d`, 5);
  if (!res || res.length === 0) return false;
  const sentMs = Date.parse(sentAtIso);
  if (Number.isNaN(sentMs)) return false;
  return res.some((m) => Date.parse(m.date) > sentMs);
}

export async function runFollowupChase(chatId: string): Promise<{ sent: boolean; nudged: number; resolved: number; skipped?: string }> {
  if (!chatId) return { sent: false, nudged: 0, resolved: 0, skipped: "no_chat" };
  if (!(await isAutomationEnabled("followup_chase"))) return { sent: false, nudged: 0, resolved: 0, skipped: "disabled" };
  const ownerId = await getAdminUserId();
  if (!ownerId) return { sent: false, nudged: 0, resolved: 0, skipped: "no_admin" };

  const db = getServiceSupabase();
  let rows: FollowupRow[];
  try {
    const { data, error } = await db
      .from("email_followup_chase")
      .select("id, to_email, subject, sent_at, last_nudge_at, nudge_count")
      .eq("owner_user_id", ownerId).eq("done", false)
      .order("sent_at", { ascending: true })
      .limit(40);
    if (error) return { sent: false, nudged: 0, resolved: 0, skipped: "not_set_up" };
    rows = (data ?? []) as FollowupRow[];
  } catch {
    return { sent: false, nudged: 0, resolved: 0, skipped: "not_set_up" };
  }
  if (rows.length === 0) return { sent: false, nudged: 0, resolved: 0 };

  const now = Date.now();
  const resolvedIds: number[] = [];
  const due: FollowupRow[] = [];
  for (const r of rows) {
    if (await theyReplied(r.to_email, r.sent_at)) { resolvedIds.push(r.id); continue; } // they got back → done
    if (hoursSince(r.last_nudge_at, now) >= FOLLOWUP_GATE_HOURS) due.push(r);
  }
  if (resolvedIds.length) { try { await db.from("email_followup_chase").update({ done: true }).in("id", resolvedIds); } catch { /* best-effort */ } }
  if (due.length === 0) return { sent: false, nudged: 0, resolved: resolvedIds.length };

  await tgSend(chatId, formatFollowups(due.map((r) => ({ to_email: r.to_email, subject: r.subject, sent_at: r.sent_at, nudge: r.nudge_count + 1 })), now));
  // Bump each (no atomic incr needed — we already hold the current count); the
  // 8th nudge closes it out so we don't chase forever.
  for (const r of due) {
    const next = r.nudge_count + 1;
    try {
      await db.from("email_followup_chase")
        .update({ nudge_count: next, last_nudge_at: new Date(now).toISOString(), done: next >= FOLLOWUP_MAX_NUDGES })
        .eq("id", r.id);
    } catch { /* best-effort */ }
  }
  return { sent: true, nudged: due.length, resolved: resolvedIds.length };
}
