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
import { isAutomationEnabled } from "@/lib/automationSettings";

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

  // ⏰ The tasks YOU asked me to remember — undated ones ALWAYS show (they stay
  // until you mark them done), dated ones surface within a week / when overdue.
  // These are the ONLY thing the briefing pushes by default (see briefing_extras).
  let reminders: { text: string; due: string | null; days: number | null; when: string | null }[] = [];
  if (adminUserId) {
    // Prefer the precise due_at + notified_at columns; fall back to date-only if the
    // due_at migration hasn't run yet (so reminders never silently vanish).
    const sel = (withNew: boolean) => db
      .from("assistant_reminders")
      .select(withNew ? "text, due_date, due_at, notified_at" : "text, due_date")
      .eq("owner_user_id", adminUserId)
      .eq("done", false);
    let r = await sel(true);
    if (r.error) r = await sel(false);
    type Rem = { text: string; due_date: string | null; due_at?: string | null; notified_at?: string | null };
    reminders = ((r.data ?? []) as unknown as Rem[])
      // A TIMED reminder that already fired (notified_at set) has done its job — drop it
      // so it doesn't re-nag every briefing. Undated tasks keep showing until done.
      .filter((x) => !(x.due_at && x.notified_at))
      .map((x) => {
        const ms = x.due_at ? (Number.isNaN(Date.parse(x.due_at)) ? null : Date.parse(x.due_at)) : parseDate(x.due_date);
        return { text: x.text, due: x.due_date, when: x.due_at ?? null, ms };
      })
      .filter((x) => x.ms === null || x.ms <= now + 7 * DAY)
      .sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity))
      .map((x) => ({ text: x.text, due: x.due, when: x.when, days: x.ms === null ? null : Math.round((x.ms - now) / DAY) }));
  }

  const lines: string[] = ["🗓️ Borivon — what needs you today", ""];
  let count = 0;

  // ── YOUR dictated tasks lead — and BY DEFAULT they're the ONLY thing pushed. ──
  if (reminders.length) {
    count += reminders.length;
    lines.push(`⏰ ${reminders.length} thing(s) you asked me to keep on top of:`);
    for (const r of reminders.slice(0, 12)) {
      const tag = r.days === null ? "" : r.days < 0 ? " (overdue)" : r.days === 0 ? " (today)" : ` (in ${r.days}d)`;
      lines.push(`   • ${r.text}${tag}`);
    }
    lines.push("");
  }

  // ── EXTRA auto-signals (passports / B2 / stuck / emails / batch / doc-review) ──
  // OFF BY DEFAULT: the founder wants to be reminded ONLY of what he dictates ("only
  // remind me of what I tell you, period"). When briefing_extras is on, the briefing
  // also surfaces these. He can ask for any of them on demand at any time regardless.
  const extrasOn = await isAutomationEnabled("briefing_extras").catch(() => false);
  if (extrasOn) {
    type P = { user_id: string; first_name: string | null; last_name: string | null; passport_expiry: string | null; b2_exam_date: string | null };
    const { data: profs } = await db
      .from("candidate_profiles")
      .select("user_id, first_name, last_name, passport_expiry, b2_exam_date");
    const profRowsAll = (profs ?? []) as P[];
    const { data: pend } = await db.from("documents").select("*").eq("status", "pending"); // '*' so a not-yet-migrated superseded_at never errors
    const pendRowsAll = ((pend ?? []) as { user_id: string; file_name: string | null; superseded_at?: string | null }[])
      .filter((d) => !d.superseded_at); // skip ARCHIVED docs (LAW #33)
    // Strip staff (they get profile rows when they open the dashboard) so the briefing
    // only ever lists real candidates.
    const allIds = [...new Set([...profRowsAll.map((p) => p.user_id), ...pendRowsAll.map((d) => d.user_id)])];
    const staffIds = await getStaffUserIdsAmong(allIds);
    const profRows = profRowsAll.filter((p) => !staffIds.has(p.user_id));
    const pendRows = pendRowsAll.filter((d) => !staffIds.has(d.user_id));
    const nameById = new Map(profRows.map((p) => [p.user_id, nameOf(p)]));

    const passports = profRows
      .map((p) => ({ p, ms: parseDate(p.passport_expiry) }))
      .filter((x): x is { p: P; ms: number } => x.ms !== null && x.ms <= now + 90 * DAY)
      .sort((a, b) => a.ms - b.ms);
    const b2 = profRows
      .map((p) => ({ p, ms: parseDate(p.b2_exam_date) }))
      .filter((x): x is { p: P; ms: number } => x.ms !== null && x.ms <= now + 30 * DAY && x.ms >= now - 7 * DAY)
      .sort((a, b) => a.ms - b.ms);
    const pendByUser = new Map<string, number>();
    for (const d of pendRows) pendByUser.set(d.user_id, (pendByUser.get(d.user_id) ?? 0) + 1);

    const [stuck, emails, batch] = await Promise.all([
      computeStuckCandidates().catch(() => null),
      getUnansweredEmails().catch(() => null),
      computeBatchTasks().catch(() => null),
    ]);

    if (batch && batch.tasks.length) {
      count += batch.count;
      lines.push(formatBatchTasks(batch.tasks), "");
    }
    // The document-review nag has its OWN sub-switch (doc_reminders), default off.
    const docRemindersOn = await isAutomationEnabled("doc_reminders").catch(() => false);
    if (docRemindersOn && pendByUser.size) {
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
  }

  if (count === 0) {
    lines.push(extrasOn
      ? "✅ Nothing urgent — you're all caught up."
      : "✅ Nothing on your list. (I only push the reminders YOU give me — say \"turn the briefing signals back on\" to also see passports, B2, stuck candidates & emails.)");
  } else {
    lines.push(`That's ${count} thing${count > 1 ? "s" : ""} that need you. Just tell me to act on any of them.`);
  }

  return { text: lines.join("\n").trim(), count };
}
