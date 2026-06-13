/**
 * THE BATCH BOARD — the dropout-killer engine.
 *
 * Employers take candidates in monthly-ish BATCHES (UKSH ~10 every ~3 months).
 * This turns the founder's in-his-head pipeline into managed data and produces
 * the DAILY TASKS that the briefing / all-day nudger run off:
 *   🎯 funnel gaps   — open batches that still need candidates funnelled in
 *   🔥 cold waiting  — candidates WAITING between interviews who've gone quiet
 *                      (the #1 drop-out cause) → warm them before they leave
 *   📅 date tasks    — get a 2nd-interview date from the employer, or confirm an
 *                      expected-but-unconfirmed date
 *
 * EVERYTHING here is fail-safe: if supabase/employer_batches.sql hasn't been run
 * yet, every query throws → caught → returns empty, so the briefing/crons keep
 * working and just show no batch tasks until the migration lands.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { getStaffUserIdsAmong } from "@/lib/admin-auth";

const DAY = 86_400_000;
// A waiting candidate is "cold" when they haven't signed in for this long AND we
// haven't warmed them (last_touch_at) for this long — that's the re-engage flag.
const COLD_DAYS = 7;

/** The sales funnel ladder. `waiting` stages are the drop-out danger zone. */
export const FUNNEL_STAGES = [
  { key: "funneling",   label: "Funneling",              waiting: false },
  { key: "screening",   label: "Screening call",         waiting: false },
  { key: "interview1",  label: "Interview 1",            waiting: false },
  { key: "waiting_2nd", label: "Waiting for 2nd interview", waiting: true },
  { key: "interview2",  label: "Interview 2",            waiting: false },
  { key: "passed",      label: "Passed",                 waiting: false },
  { key: "departed",    label: "Departed for Germany",   waiting: false },
] as const;

export type FunnelStageKey = (typeof FUNNEL_STAGES)[number]["key"];
export const FUNNEL_STAGE_KEYS = FUNNEL_STAGES.map((s) => s.key) as string[];
export function isFunnelStage(k: string): k is FunnelStageKey {
  return FUNNEL_STAGE_KEYS.includes(k);
}
export function funnelLabel(k: string | null | undefined): string {
  return FUNNEL_STAGES.find((s) => s.key === k)?.label ?? (k || "—");
}
const WAITING_KEYS = new Set<string>(FUNNEL_STAGES.filter((s) => s.waiting).map((s) => s.key));

export type BatchTask = { kind: "funnel_gap" | "cold" | "get_date" | "confirm_date"; text: string; candidateUserId?: string };

type PipeRow = {
  user_id: string;
  funnel_stage: string | null;
  batch_id: string | null;
  last_touch_at: string | null;
  interview1_date: string | null;
  interview1_date_confirmed: boolean | null;
  interview2_date: string | null;
  interview2_date_confirmed: boolean | null;
};

/** id → { name, lastSignInMs } for the given ids (one bounded auth walk). */
async function authActivity(ids: string[]): Promise<Map<string, { name: string; lastSignInMs: number | null }>> {
  const out = new Map<string, { name: string; lastSignInMs: number | null }>();
  if (ids.length === 0) return out;
  const want = new Set(ids);
  const db = getServiceSupabase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      if (!want.has(u.id)) continue;
      const name = ((u.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined)?.trim() || u.email || u.id;
      const t = u.last_sign_in_at ? Date.parse(u.last_sign_in_at) : NaN;
      out.set(u.id, { name, lastSignInMs: Number.isFinite(t) ? t : null });
    }
    if (data.users.length < 1000) break;
  }
  return out;
}

/**
 * The day's batch-board tasks. Live-computed (no task-state table) — an item
 * naturally drops off the list the moment the underlying data resolves (a date
 * gets confirmed, a cold candidate logs in or gets touched, a seat fills), which
 * is exactly what lets the all-day nudger re-ping only what's still open.
 */
export async function computeBatchTasks(): Promise<{ tasks: BatchTask[]; count: number }> {
  const tasks: BatchTask[] = [];
  const db = getServiceSupabase();
  const now = Date.now();

  // 🎯 Funnel gaps — open batches still short of their seat target.
  try {
    const { data: batches } = await db.from("employer_batches").select("id, name, seats, status").eq("status", "open");
    const open = (batches ?? []) as { id: string; name: string; seats: number }[];
    if (open.length) {
      const { data: assigned } = await db.from("candidate_pipeline").select("batch_id").not("batch_id", "is", null);
      const countByBatch = new Map<string, number>();
      for (const r of (assigned ?? []) as { batch_id: string }[]) countByBatch.set(r.batch_id, (countByBatch.get(r.batch_id) ?? 0) + 1);
      for (const b of open) {
        const have = countByBatch.get(b.id) ?? 0;
        if (have < (b.seats ?? 0)) tasks.push({ kind: "funnel_gap", text: `${b.name}: ${have}/${b.seats} seats — funnel ${b.seats - have} more` });
      }
    }
  } catch { /* employer_batches not migrated yet → no funnel tasks */ }

  // 🔥 Cold waiting candidates + 📅 date tasks.
  try {
    const { data: pipe } = await db
      .from("candidate_pipeline")
      .select("user_id, funnel_stage, batch_id, last_touch_at, interview1_date, interview1_date_confirmed, interview2_date, interview2_date_confirmed");
    const rows = (pipe ?? []) as PipeRow[];
    const staged = rows.filter((r) => r.funnel_stage); // only candidates actually on the funnel
    if (staged.length) {
      const staff = await getStaffUserIdsAmong(staged.map((r) => r.user_id));
      const real = staged.filter((r) => !staff.has(r.user_id));
      const waiting = real.filter((r) => r.funnel_stage && WAITING_KEYS.has(r.funnel_stage));
      const act = await authActivity(real.map((r) => r.user_id));
      const nameOf = (id: string) => act.get(id)?.name ?? id;

      // Cold = waiting, no login in COLD_DAYS, and not warmed in COLD_DAYS.
      for (const r of waiting) {
        const a = act.get(r.user_id);
        const loginMs = a?.lastSignInMs ?? null;
        const touchMs = r.last_touch_at ? Date.parse(r.last_touch_at) : NaN;
        const quietLogin = loginMs === null || loginMs <= now - COLD_DAYS * DAY;
        const notTouched = !Number.isFinite(touchMs) || (touchMs as number) <= now - COLD_DAYS * DAY;
        if (quietLogin && notTouched) {
          const days = loginMs === null ? "never logged in" : `quiet ${Math.round((now - loginMs) / DAY)}d`;
          tasks.push({ kind: "cold", candidateUserId: r.user_id, text: `${nameOf(r.user_id)} — waiting, ${days} → warm them before they drop` });
        }
        // No 2nd-interview date yet → chase the employer for one.
        if (!r.interview2_date) tasks.push({ kind: "get_date", candidateUserId: r.user_id, text: `${nameOf(r.user_id)} — get a 2nd-interview date from the employer` });
      }

      // Any interview date that's set but NOT confirmed (expected → confirm it).
      for (const r of real) {
        if (r.interview1_date && !r.interview1_date_confirmed) tasks.push({ kind: "confirm_date", candidateUserId: r.user_id, text: `${nameOf(r.user_id)} — confirm the 1st-interview date (${r.interview1_date})` });
        if (r.interview2_date && !r.interview2_date_confirmed) tasks.push({ kind: "confirm_date", candidateUserId: r.user_id, text: `${nameOf(r.user_id)} — confirm the 2nd-interview date (${r.interview2_date})` });
      }
    }
  } catch { /* funnel_stage column not migrated yet → no funnel/date tasks */ }

  return { tasks, count: tasks.length };
}

/** Telegram-friendly block for the briefing / nudger. Empty string when no tasks. */
export function formatBatchTasks(tasks: BatchTask[]): string {
  if (tasks.length === 0) return "";
  const byKind: Record<BatchTask["kind"], BatchTask[]> = { funnel_gap: [], cold: [], get_date: [], confirm_date: [] };
  for (const t of tasks) byKind[t.kind].push(t);
  const lines: string[] = [];
  if (byKind.funnel_gap.length) { lines.push("🎯 Batches to fill:"); for (const t of byKind.funnel_gap.slice(0, 10)) lines.push(`   • ${t.text}`); lines.push(""); }
  if (byKind.cold.length) { lines.push("🔥 Waiting candidates going cold (re-engage today):"); for (const t of byKind.cold.slice(0, 12)) lines.push(`   • ${t.text}`); lines.push(""); }
  const dates = [...byKind.get_date, ...byKind.confirm_date];
  if (dates.length) { lines.push("📅 Interview dates to lock down:"); for (const t of dates.slice(0, 12)) lines.push(`   • ${t.text}`); lines.push(""); }
  return lines.join("\n").trim();
}
