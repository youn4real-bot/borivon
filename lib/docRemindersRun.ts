/**
 * Automatic document reminders — loading, the on/off switch, and sending.
 * The rules themselves live in lib/docReminders (pure, tested).
 *
 * FAIL CLOSED everywhere. This is the one automation that writes to candidates
 * on its own, so every doubt resolves to "send nothing":
 *   • the switch is OFF unless app_settings says exactly "on"
 *   • no reminder log table (migration not run) → nothing is sent, because
 *     without the log there is no way to know who was already written to, and
 *     a daily job would mail the same people every single day
 *   • any core table failing to load → nothing is sent
 */
import { getServiceSupabase } from "@/lib/supabase";
import { getStaffUserIdsAmong } from "@/lib/admin-auth";
import { planReminder, reminderLabel, type ReminderDoc, type ReminderItem } from "@/lib/docReminders";
import { sendDocReminderEmail } from "@/lib/email";
import { readAllRows } from "@/lib/readAllRows";

const SETTING_KEY = "candidate_doc_reminders";
const LOG_TABLE = "candidate_reminders";
const DAY = 86_400_000;
/** Resend's free tier allows 100 a day; the portal's other mail needs room too. */
const MAX_PER_RUN = 40;

type Lang = "fr" | "en" | "de";

export async function isDocRemindersOn(): Promise<boolean> {
  try {
    const { data, error } = await getServiceSupabase()
      .from("app_settings").select("value").eq("key", SETTING_KEY).maybeSingle();
    if (error) return false;
    return (data as { value?: string } | null)?.value === "on";
  } catch {
    return false;
  }
}

export async function setDocReminders(on: boolean): Promise<boolean> {
  try {
    const { error } = await getServiceSupabase().from("app_settings").upsert({
      key: SETTING_KEY, value: on ? "on" : "off", updated_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

export type DueReminder = {
  userId: string;
  name: string;
  firstName: string;
  email: string;
  lang: Lang | null;
  items: ReminderItem[];
};

export type DueResult = {
  /** false = a core table failed to load; nothing may be sent. */
  ok: boolean;
  /** false = the reminder log table does not exist yet. */
  tableReady: boolean;
  due: DueReminder[];
  slotLabels: Map<string, string>;
  sentLast7d: number;
};

export async function computeDueReminders(now = Date.now()): Promise<DueResult> {
  const db = getServiceSupabase();
  const empty: DueResult = { ok: false, tableReady: false, due: [], slotLabels: new Map(), sentLast7d: 0 };

  const { data: profs, error: profErr } = await db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, lang, is_test_account, employer_id");
  if (profErr || !profs) return empty;
  type Prof = { user_id: string; first_name: string | null; last_name: string | null; lang: string | null; is_test_account: boolean | null; employer_id: string | null };
  const profRows = (profs as Prof[]).filter((p) => p.is_test_account !== true);
  const ids = profRows.map((p) => p.user_id);
  if (!ids.length) return { ...empty, ok: true, tableReady: true };
  const staff = await getStaffUserIdsAmong(ids);

  const [docs, rejNotifs, pipeRes, empRes, orgRes, linkRes, slotRes, logRes] = await Promise.all([
    readAllRows<ReminderDoc & { user_id: string }>((a, b) =>
      db.from("documents").select("id, user_id, file_type, status, uploaded_at, superseded_at").order("id").range(a, b)).then((r) => r.data),
    readAllRows<{ doc_id: string | null; created_at: string }>((a, b) =>
      db.from("notifications").select("doc_id, created_at").eq("action", "rejected").order("id").range(a, b)).then((r) => r.data),
    db.from("candidate_pipeline").select("user_id, arrived_done, funnel_stage, batch_id"),
    db.from("employers").select("id, agency_id"),
    db.from("organizations").select("id, required_doc_keys"),
    db.from("candidate_organizations").select("candidate_user_id, org_id, added_by").eq("status", "approved"),
    db.from("phase_slots").select("id, label"),
    db.from(LOG_TABLE).select("user_id, sent_at").gte("sent_at", new Date(now - 60 * DAY).toISOString()),
  ]);
  if (!docs || pipeRes.error) return empty;

  const tableReady = !logRes.error;
  const sentAtsBy = new Map<string, number[]>();
  let sentLast7d = 0;
  for (const r of (logRes.data ?? []) as { user_id: string; sent_at: string }[]) {
    const t = Date.parse(r.sent_at);
    if (!Number.isFinite(t)) continue;
    (sentAtsBy.get(r.user_id) ?? sentAtsBy.set(r.user_id, []).get(r.user_id)!).push(t);
    if (now - t < 7 * DAY) sentLast7d++;
  }

  const rejectedAt = new Map<string, number>();
  for (const n of rejNotifs ?? []) {
    const t = Date.parse(n.created_at);
    if (n.doc_id && Number.isFinite(t) && t > (rejectedAt.get(n.doc_id) ?? 0)) rejectedAt.set(n.doc_id, t);
  }

  const docsBy = new Map<string, ReminderDoc[]>();
  for (const d of docs) (docsBy.get(d.user_id) ?? docsBy.set(d.user_id, []).get(d.user_id)!).push(d);

  // "In the process" = in a batch, at a site, or linked to an agency. Everyone
  // else is a lead with no intake to be late for (the founder's chase rule).
  const inProcess = new Set<string>();
  const arrived = new Set<string>();
  for (const p of (pipeRes.data ?? []) as { user_id: string; arrived_done: boolean | null; funnel_stage: string | null; batch_id: string | null }[]) {
    if (p.arrived_done === true || p.funnel_stage === "departed") arrived.add(p.user_id);
    if (p.batch_id) inProcess.add(p.user_id);
  }

  // Which required-docs set applies — same resolution as the admin list's %:
  // the agency behind her site, else an agency she joined herself.
  const agencyByEmp = new Map(((empRes.data ?? []) as { id: string; agency_id: string | null }[]).map((e) => [e.id, e.agency_id]));
  const reqByOrg = new Map(((orgRes.data ?? []) as { id: string; required_doc_keys: string[] | null }[]).map((o) => [o.id, o.required_doc_keys]));
  const selfOrg = new Map<string, string>();
  for (const l of (linkRes.data ?? []) as { candidate_user_id: string; org_id: string; added_by: string | null }[]) {
    inProcess.add(l.candidate_user_id);
    if (l.added_by !== "admin" && !selfOrg.has(l.candidate_user_id)) selfOrg.set(l.candidate_user_id, l.org_id);
  }
  for (const p of profRows) if (p.employer_id) inProcess.add(p.user_id);

  const slotLabels = new Map<string, string>();
  for (const s of (slotRes.data ?? []) as { id: string; label: string | null }[]) if (s.label) slotLabels.set(s.id, s.label);

  // Email + a name fallback from the auth record (profiles are often blank).
  const authBy = new Map<string, { email: string; first: string }>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return empty;
    const users = data?.users ?? [];
    for (const u of users) {
      const email = (u.email ?? "").trim().toLowerCase();
      if (!email || email.endsWith("@borivon.invalid") || !u.email_confirmed_at) continue;
      const m = (u.user_metadata ?? {}) as Record<string, unknown>;
      const first = typeof m.first_name === "string" && m.first_name.trim()
        ? m.first_name.trim()
        : typeof m.full_name === "string" ? m.full_name.trim().split(/\s+/)[0] ?? "" : "";
      authBy.set(u.id, { email, first });
    }
    if (users.length < 200) break;
  }

  const due: DueReminder[] = [];
  for (const p of profRows) {
    if (staff.has(p.user_id) || !inProcess.has(p.user_id)) continue;
    const auth = authBy.get(p.user_id);
    if (!auth) continue;
    const orgId = (p.employer_id && agencyByEmp.get(p.employer_id)) || selfOrg.get(p.user_id) || null;
    const plan = planReminder({
      docs: docsBy.get(p.user_id) ?? [],
      requiredKeys: orgId ? reqByOrg.get(orgId) ?? null : null,
      rejectedAt,
      sentAts: sentAtsBy.get(p.user_id) ?? [],
      arrived: arrived.has(p.user_id),
      now,
    });
    if (!plan.send) continue;
    const firstName = (p.first_name ?? "").trim() || auth.first;
    const lang = p.lang === "fr" || p.lang === "en" || p.lang === "de" ? p.lang : null;
    due.push({
      userId: p.user_id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || firstName || auth.email,
      firstName,
      email: auth.email,
      lang,
      items: plan.items,
    });
  }
  due.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, tableReady, due, slotLabels, sentLast7d };
}

/** The daily job. Sends nothing unless the switch is on and the log exists. */
export async function runDocReminders(now = Date.now()): Promise<{ sent: number; failed: number; due: number; skipped?: string }> {
  if (!(await isDocRemindersOn())) return { sent: 0, failed: 0, due: 0, skipped: "off" };
  const c = await computeDueReminders(now);
  if (!c.ok) return { sent: 0, failed: 0, due: 0, skipped: "load_failed" };
  if (!c.tableReady) return { sent: 0, failed: 0, due: c.due.length, skipped: "log_table_missing" };

  const db = getServiceSupabase();
  let sent = 0, failed = 0;
  for (const r of c.due.slice(0, MAX_PER_RUN)) {
    // Log BEFORE sending. If the send succeeded and the log write then failed,
    // she would be mailed again tomorrow; this way a crash can only ever cost
    // her one reminder, never duplicate one. A refused address keeps its row
    // too, so a dead mailbox is tried at most three times in two months.
    const { error } = await db.from(LOG_TABLE).insert({ user_id: r.userId, kind: "documents", items: r.items });
    if (error) { failed++; continue; }
    const labelLang: Lang = r.lang ?? "fr";
    const ok = await sendDocReminderEmail(
      r.email,
      r.firstName,
      r.items.map((i) => ({ kind: i.kind, label: reminderLabel(i.key, labelLang, c.slotLabels) })),
      r.lang,
    );
    if (ok) sent++; else failed++;
    // Resend allows a couple of requests a second.
    await new Promise((res) => setTimeout(res, 600));
  }
  return { sent, failed, due: c.due.length };
}
