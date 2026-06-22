/**
 * CRITICAL-DATE RADAR — the bot watches the hard, can't-miss future dates it already
 * STORES on candidate_pipeline but never surfaced: the embassy (Visum) appointment, the
 * flight, interviews, the residence-permit appointment, and the first day at work. These
 * are the irreversible cliffs of the business — miss a Rabat embassy slot and the candidate
 * loses months — so a solo operator needs them counted down without remembering each one.
 *
 * Mirrors lib/autoChase + lib/briefing: getServiceSupabase + getStaffUserIdsAmong +
 * resolveAuthNames, staff excluded, fully fail-safe (returns {tasks:[],count:0} on any
 * trouble so it can NEVER break the briefing). Read-only — no writes, no send, no migration
 * (every column is already live on candidate_pipeline). Folds into the daily briefing's
 * extras block and is available on demand via the listCriticalDates tool.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { getStaffUserIdsAmong, resolveAuthNames } from "@/lib/admin-auth";

const DAY = 86_400_000;

/** Parse a stored date (ISO "YYYY-MM-DD…" or German "DD.MM.YYYY") to a UTC-midnight ms, or null. */
function parseDate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const de = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (de) return Date.UTC(+de[3], +de[2] - 1, +de[1]);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** "Tue 24 Jun" in UTC (the stored value is a calendar date, not an instant — don't tz-shift it). */
function fmtDate(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(ms));
}

export type CriticalDateTask = { name: string; what: string; dateStr: string; days: number };

// Each watched date: its pipeline column, a human label, the look-ahead window (days), and an
// optional "done" boolean column that means it's no longer pending (e.g. visa already granted).
const FIELDS: { col: string; what: string; window: number; doneCol?: string }[] = [
  { col: "visa_appt_date", what: "embassy appointment", window: 7, doneCol: "visa_granted" },
  { col: "interview1_date", what: "1st interview", window: 7 },
  { col: "interview2_date", what: "2nd interview", window: 7 },
  { col: "residence_permit_appt_date", what: "residence-permit appointment", window: 10 },
  { col: "flight_date", what: "flight", window: 14, doneCol: "arrived_done" },
  { col: "employment_start", what: "first day at work", window: 14, doneCol: "arrived_done" },
];

type PipeRow = Record<string, unknown> & { user_id: string };

/**
 * Compute the candidate dates coming up within their per-type window (soonest first). Each
 * task = one approaching date for one candidate. Fail-safe → {tasks:[],count:0}.
 */
export async function computeCriticalDates(): Promise<{ tasks: CriticalDateTask[]; count: number }> {
  try {
    const db = getServiceSupabase();
    const now = Date.now();
    const sel = ["user_id", ...new Set(FIELDS.flatMap((f) => [f.col, f.doneCol].filter(Boolean) as string[]))].join(", ");
    const { data, error } = await db.from("candidate_pipeline").select(sel);
    if (error || !data) return { tasks: [], count: 0 };
    const rows = data as unknown as PipeRow[];
    if (!rows.length) return { tasks: [], count: 0 };

    // Strip staff (they get pipeline rows when they open the dashboard) so only real candidates show.
    const ids = rows.map((r) => r.user_id).filter(Boolean);
    const staff = await getStaffUserIdsAmong(ids);
    const candRows = rows.filter((r) => !staff.has(r.user_id));

    // Names: candidate_profiles first/last, falling back to auth full_name (often the only source).
    const { data: profs } = await db.from("candidate_profiles").select("user_id, first_name, last_name");
    const nameById = new Map(((profs ?? []) as { user_id: string; first_name: string | null; last_name: string | null }[])
      .map((p) => [p.user_id, [p.first_name, p.last_name].filter(Boolean).join(" ").trim()]));
    const candIds = candRows.map((r) => r.user_id);
    const needNames = candIds.filter((id) => !nameById.get(id));
    const authNames = needNames.length ? await resolveAuthNames(needNames) : {};
    const nameOf = (uid: string) => nameById.get(uid) || authNames[uid]?.name || uid;

    const tasks: CriticalDateTask[] = [];
    for (const r of candRows) {
      for (const f of FIELDS) {
        if (f.doneCol && r[f.doneCol] === true) continue; // already handled (visa granted / arrived)
        const ms = parseDate(r[f.col] as string | null);
        if (ms === null) continue;
        const days = Math.round((ms - now) / DAY);
        if (days < 0 || days > f.window) continue; // only today → within this date's window
        tasks.push({ name: nameOf(r.user_id), what: f.what, dateStr: fmtDate(ms), days });
      }
    }
    tasks.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
    return { tasks, count: tasks.length };
  } catch {
    return { tasks: [], count: 0 };
  }
}
