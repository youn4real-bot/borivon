/**
 * "State of the business" — a Monday weekly report pushed to the founder's
 * Telegram by the weekly-report cron (gated by the weekly_report automation).
 *
 * Reliable, action-oriented signals computed live from the portal:
 *   👥 pipeline snapshot   — total candidates + how many at each key milestone
 *   🆕 this week           — new signups, new leads, documents uploaded (7d)
 *   ⚠️ needs attention     — docs pending review, passports expiring ≤90d,
 *                            B2 exams ≤30d, stalled candidates (no movement 21d+)
 *
 * Returned as a Telegram-friendly plain-text block + a count of "needs
 * attention" items. Shares the date-parsing convention with lib/briefing.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { getStaffUserIdsAmong, getStaffEmailSet } from "@/lib/admin-auth";
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

export type WeeklyReport = { text: string; count: number };

export async function computeWeeklyReport(windowDays = 7): Promise<WeeklyReport> {
  const db = getServiceSupabase();
  const now = Date.now();
  const weekAgo = now - windowDays * DAY;
  const periodLabel = windowDays === 7 ? "weekly report" : `last ${windowDays} days`;
  const thisLabel = windowDays === 7 ? "This week" : `Last ${windowDays} days`;

  // Candidates (profiles) — totals + passport/B2 signals.
  type P = { user_id: string; passport_expiry: string | null; b2_exam_date: string | null };
  const { data: profs } = await db
    .from("candidate_profiles")
    .select("user_id, passport_expiry, b2_exam_date");
  const profRowsAll = (profs ?? []) as P[];

  // Pipeline — milestone funnel + stalled (no update in 21d, not yet arrived).
  type PL = {
    user_id: string;
    interview1_status: string | null; interview2_status: string | null;
    contract_done: boolean | null; visa_granted: boolean | null; arrived_done: boolean | null;
    updated_at: string | null;
  };
  const { data: pipe } = await db
    .from("candidate_pipeline")
    .select("user_id, interview1_status, interview2_status, contract_done, visa_granted, arrived_done, updated_at");
  const pipeRowsAll = (pipe ?? []) as PL[];

  // STAFF ARE NOT CANDIDATES: the supreme admin, sub-admins and org members each
  // get a candidate_profiles / candidate_pipeline row when they open the
  // dashboard once — counting them inflates the founder's weekly numbers. Strip
  // them out exactly like /api/portal/journey/pipeline does.
  const allIds = [...new Set([...profRowsAll.map((p) => p.user_id), ...pipeRowsAll.map((p) => p.user_id)])];
  const staffIds = await getStaffUserIdsAmong(allIds);
  const profRows = profRowsAll.filter((p) => !staffIds.has(p.user_id));
  const pipeRows = pipeRowsAll.filter((p) => !staffIds.has(p.user_id));
  const total = profRows.length;

  const passportsSoon = profRows.filter((p) => {
    const ms = parseDate(p.passport_expiry);
    return ms !== null && ms <= now + 90 * DAY;
  }).length;
  const b2Soon = profRows.filter((p) => {
    const ms = parseDate(p.b2_exam_date);
    return ms !== null && ms <= now + 30 * DAY && ms >= now - 7 * DAY;
  }).length;

  let interviewPassed = 0, contract = 0, visa = 0, arrived = 0, stalled = 0;
  for (const p of pipeRows) {
    if (p.interview1_status === "passed" || p.interview2_status === "passed") interviewPassed++;
    if (p.contract_done) contract++;
    if (p.visa_granted) visa++;
    if (p.arrived_done) arrived++;
    if (!p.arrived_done) {
      const t = Date.parse(p.updated_at ?? "");
      if (Number.isFinite(t) && t < now - 21 * DAY) stalled++;
    }
  }

  // Documents — pending review now + uploaded this week.
  const { data: docs } = await db.from("documents").select("status, uploaded_at");
  const docRows = (docs ?? []) as { status: string | null; uploaded_at: string | null }[];
  const pending = docRows.filter((d) => d.status === "pending").length;
  const uploaded7d = docRows.filter((d) => {
    const t = Date.parse(d.uploaded_at ?? "");
    return Number.isFinite(t) && t >= weekAgo;
  }).length;

  // New leads this week.
  const { data: leads } = await db.from("leads").select("created_at");
  const newLeads = ((leads ?? []) as { created_at: string | null }[]).filter((l) => {
    const t = Date.parse(l.created_at ?? "");
    return Number.isFinite(t) && t >= weekAgo;
  }).length;

  // New CANDIDATE signups this week (auth.users.created_at) — excluding staff.
  const staffEmails = await getStaffEmailSet();
  let newSignups = 0;
  try {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      const list = data?.users ?? [];
      if (error || list.length === 0) break;
      for (const u of list) {
        const email = (u.email ?? "").trim().toLowerCase();
        if (email && staffEmails.has(email)) continue; // skip staff/org members
        const t = Date.parse((u as { created_at?: string }).created_at ?? "");
        if (Number.isFinite(t) && t >= weekAgo) newSignups++;
      }
      if (list.length < 1000) break;
    }
  } catch { /* best-effort */ }

  // The "documents pending review" line is the same nag the founder muted in the
  // briefing — honor that mute here too (DEFAULT OFF, fail-safe closed) so the
  // weekly report doesn't sneak it back in. The neutral "documents uploaded" volume
  // stat stays (it's a business pulse, not a to-do nag).
  const docRemindersOn = await isAutomationEnabled("doc_reminders").catch(() => false);
  const count = (docRemindersOn ? pending : 0) + passportsSoon + b2Soon + stalled;

  const attention: string[] = ["⚠️ Needs attention"];
  if (docRemindersOn) attention.push(`   • Documents pending review: ${pending}`);
  attention.push(
    `   • Passports expiring ≤90d: ${passportsSoon}`,
    `   • B2 exams ≤30d: ${b2Soon}`,
    `   • Stalled (no movement 21d+): ${stalled}`,
  );

  const lines: string[] = [
    `📊 Borivon — ${periodLabel}`,
    "",
    `👥 Pipeline (${total} candidate${total === 1 ? "" : "s"})`,
    `   • Interview passed: ${interviewPassed}`,
    `   • Contract signed: ${contract}`,
    `   • Visa granted: ${visa}`,
    `   • Arrived in Germany: ${arrived}`,
    "",
    `🆕 ${thisLabel}`,
    `   • New signups: ${newSignups}`,
    `   • New leads: ${newLeads}`,
    `   • Documents uploaded: ${uploaded7d}`,
    "",
    ...attention,
  ];
  if (count === 0) lines.push("", "✅ Nothing urgent on the attention list — clean week.");
  else lines.push("", `That's ${count} item${count === 1 ? "" : "s"} on the attention list. Ask me for details on any of them.`);

  return { text: lines.join("\n").trim(), count };
}
