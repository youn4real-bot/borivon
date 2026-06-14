/**
 * "What needs you today" — the ONE complete daily triage, computed live from the
 * portal. This is THE highest-leverage use of the bot: ask it once each morning
 * and act on the short list. Six reliable, action-oriented signals:
 *   👀 documents pending YOUR review (documents.status = 'pending')
 *   🛂 passports expiring within 90 days (candidate_profiles.passport_expiry)
 *   🎓 B2 exams coming up within 30 days (candidate_profiles.b2_exam_date)
 *   ⏰ your own reminders due/overdue (assistant_reminders)
 *   🔔 candidates who may need a nudge (lib/autoChase — went quiet / rejected doc)
 *   📧 unanswered emails waiting on you (lib/gmailInbox — best-effort)
 *
 * The last two are folded in (best-effort, never break the briefing) so this is
 * a SINGLE message, not three separate morning pings. Returned as a
 * Telegram-friendly plain-text block (no markdown to escape) plus a count of
 * actionable items. Used by the daily cron, the Telegram bot, and the in-app
 * assistant's getTodayBriefing tool.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { getStaffUserIdsAmong } from "@/lib/admin-auth";
import { computeStuckCandidates } from "@/lib/autoChase";
import { getUnansweredEmails } from "@/lib/gmailInbox";
import { computeBatchTasks, formatBatchTasks } from "@/lib/batchBoard";

const DAY = 86_400_000;

function parseDate(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim();
  const de = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (de) return Date.UTC(+de[3], +de[2] - 1, +de[1]);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

const nameOf = (r: { first_name: string | null; last_name: string | null }): string =>
  [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "—";

export type Briefing = { text: string; count: number };

export async function computeBriefing(adminUserId: string | null): Promise<Briefing> {
  const db = getServiceSupabase();
  const now = Date.now();

  type P = { user_id: string; first_name: string | null; last_name: string | null; passport_expiry: string | null; b2_exam_date: string | null };
  const { data: profs } = await db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, passport_expiry, b2_exam_date");
  const profRowsAll = (profs ?? []) as P[];

  // 👀 Documents pending YOUR review.
  const { data: pend } = await db.from("documents").select("user_id, file_name").eq("status", "pending");
  const pendRowsAll = (pend ?? []) as { user_id: string; file_name: string | null }[];

  // STAFF ARE NOT CANDIDATES (admin/sub-admins/org members get profile rows when
  // they open the dashboard) — strip them so the briefing only ever lists real
  // candidates, exactly like /api/portal/journey/pipeline.
  const allIds = [...new Set([...profRowsAll.map((p) => p.user_id), ...pendRowsAll.map((d) => d.user_id)])];
  const staffIds = await getStaffUserIdsAmong(allIds);
  const profRows = profRowsAll.filter((p) => !staffIds.has(p.user_id));
  const pendRows = pendRowsAll.filter((d) => !staffIds.has(d.user_id));
  const nameById = new Map(profRows.map((p) => [p.user_id, nameOf(p)]));

  // 🛂 Passports expiring within 90 days (overdue first).
  const passports = profRows
    .map((p) => ({ p, ms: parseDate(p.passport_expiry) }))
    .filter((x): x is { p: P; ms: number } => x.ms !== null && x.ms <= now + 90 * DAY)
    .sort((a, b) => a.ms - b.ms);

  // 🎓 B2 exams within 30 days (incl. up to a week past, in case results pending).
  const b2 = profRows
    .map((p) => ({ p, ms: parseDate(p.b2_exam_date) }))
    .filter((x): x is { p: P; ms: number } => x.ms !== null && x.ms <= now + 30 * DAY && x.ms >= now - 7 * DAY)
    .sort((a, b) => a.ms - b.ms);

  const pendByUser = new Map<string, number>();
  for (const d of pendRows) pendByUser.set(d.user_id, (pendByUser.get(d.user_id) ?? 0) + 1);

  // ⏰ The tasks YOU asked me to remember — undated ones ALWAYS show (they stay
  // until you mark them done), dated ones surface within a week / when overdue.
  let reminders: { text: string; due: string | null; days: number | null }[] = [];
  if (adminUserId) {
    const { data: rem } = await db
      .from("assistant_reminders")
      .select("text, due_date")
      .eq("owner_user_id", adminUserId)
      .eq("done", false);
    reminders = ((rem ?? []) as { text: string; due_date: string | null }[])
      .map((r) => ({ text: r.text, due: r.due_date, ms: parseDate(r.due_date) }))
      .filter((r) => r.ms === null || r.ms <= now + 7 * DAY)
      .sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity))
      .map((r) => ({ text: r.text, due: r.due, days: r.ms === null ? null : Math.round((r.ms - now) / DAY) }));
  }

  // 🔔 stuck candidates + 📧 unanswered emails — folded in (best-effort, each
  // wrapped so a failure can NEVER break the briefing) so this one message is the
  // complete triage. getUnansweredEmails returns null if Gmail/IMAP is unavailable.
  const [stuck, emails, batch] = await Promise.all([
    computeStuckCandidates().catch(() => null),
    getUnansweredEmails().catch(() => null),
    computeBatchTasks().catch(() => null),
  ]);

  const lines: string[] = ["🗓️ Borivon — what needs you today", ""];
  let count = 0;

  // ── YOUR dictated tasks lead (these are the ones you care about most) ──
  if (reminders.length) {
    count += reminders.length;
    lines.push(`⏰ ${reminders.length} thing(s) you asked me to keep on top of:`);
    for (const r of reminders.slice(0, 12)) {
      const tag = r.days === null ? "" : r.days < 0 ? " (overdue)" : r.days === 0 ? " (today)" : ` (in ${r.days}d)`;
      lines.push(`   • ${r.text}${tag}`);
    }
    lines.push("");
  }
  if (batch && batch.tasks.length) {
    count += batch.count;
    lines.push(formatBatchTasks(batch.tasks), "");
  }
  // ── then the automatic signals (your review queue + deadlines) ──
  if (pendByUser.size) {
    count += pendByUser.size;
    lines.push(`👀 ${pendRows.length} document(s) waiting for your review (${pendByUser.size} candidate${pendByUser.size > 1 ? "s" : ""}):`);
    for (const [uid, n] of [...pendByUser].slice(0, 10)) lines.push(`   • ${nameById.get(uid) ?? uid}${n > 1 ? ` ×${n}` : ""}`);
    lines.push("");
  }
  if (passports.length) {
    count += passports.length;
    lines.push(`🛂 ${passports.length} passport(s) expiring soon:`);
    for (const x of passports.slice(0, 10)) {
      const d = Math.round((x.ms - now) / DAY);
      lines.push(`   • ${nameOf(x.p)} — ${x.p.passport_expiry} (${d < 0 ? "EXPIRED" : d + "d"})`);
    }
    lines.push("");
  }
  if (b2.length) {
    count += b2.length;
    lines.push(`🎓 ${b2.length} B2 exam(s) coming up:`);
    for (const x of b2.slice(0, 10)) lines.push(`   • ${nameOf(x.p)} — ${x.p.b2_exam_date}`);
    lines.push("");
  }
  if (stuck && stuck.candidates.length) {
    count += stuck.candidates.length;
    lines.push(`🔔 ${stuck.candidates.length} candidate(s) may need a nudge:`);
    for (const c of stuck.candidates.slice(0, 10)) lines.push(`   • ${c.name} — ${c.reasons.join("; ")}`);
    lines.push("");
  }
  if (emails && emails.length) {
    count += emails.length;
    lines.push(`📧 ${emails.length} unanswered email(s):`);
    for (const e of emails.slice(0, 10)) {
      const age = e.ageDays === 0 ? "today" : e.ageDays === 1 ? "1d" : `${e.ageDays}d`;
      lines.push(`   • ${e.fromName} — ${e.subject} (${age})`);
    }
    lines.push("");
  }

  if (count === 0) lines.push("✅ Nothing urgent — you're all caught up.");
  else lines.push(`That's ${count} thing${count > 1 ? "s" : ""} that need you. Just tell me to act on any of them — e.g. "nudge the stuck ones", "approve X's diploma", "reply to that email".`);

  return { text: lines.join("\n").trim(), count };
}
