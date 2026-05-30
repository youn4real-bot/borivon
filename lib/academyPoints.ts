/**
 * ACADEMY — point ledger helper (SERVER ONLY).
 *
 * The single spine of the Academy feature. Every gamification number (score,
 * streak, leaderboard, level) AND every employer-facing behavior number
 * (attendance rate, on-time rate, reliability index) is derived from the
 * append-only `academy_point_events` ledger + the attendance / submission
 * tables — never from a stored counter that can drift.
 *
 * NEVER import this in a client component: it uses the service-role key
 * (getServiceSupabase) which bypasses RLS. All callers must already have run
 * requireUser / requireAdminRole + LAW #25 scope before reaching here.
 *
 * See supabase/academy.sql for the schema. Idempotency: awardPoints upserts on
 * (candidate, type, source_kind, source_id) → awarding the same real event
 * twice is a no-op (re-running an attendance/grading job never double-pays).
 */
import { getServiceSupabase } from "./supabase";

// ── Tunable rule table — what each action is worth ───────────────────────────
// Single source of truth. P3 may move this into a DB-driven table so the
// founder can tune weights without a deploy; for now it lives in code.
export const POINT_RULES = {
  attend_present:  10, // showed up to a live class on time
  attend_late:      4, // showed up late (partial credit — still beats absent)
  lesson_complete:  3, // finished an in-app lesson
  quiz_ontime:      5, // submitted a quiz before its deadline (bonus on top of pass)
  quiz_pass:       10, // passed a quiz (>= pass_score)
  quiz_perfect:     5, // scored 100% (bonus on top of pass)
  level_up:        50, // climbed a CEFR rung (A1→A2→B1→B2)
  streak_week:     15, // kept a 7-day activity streak
} as const;

export type PointRuleType = keyof typeof POINT_RULES;
export type PointSourceKind = "session" | "quiz" | "lesson" | "badge" | "manual" | "system";

export type AwardArgs = {
  candidateUserId: string;
  /** A POINT_RULES key (points auto-filled) or any custom string (points required). */
  type: PointRuleType | string;
  sourceKind: PointSourceKind;
  /** The session/quiz/lesson/badge id. Omit for manual/system events. */
  sourceId?: string | null;
  /** Snapshot of the candidate's cohort at event time (for per-cohort leaderboards). */
  cohortId?: string | null;
  /** Override the rule-table value. Required when `type` is not in POINT_RULES. */
  points?: number;
  meta?: Record<string, unknown>;
  note?: string;
  createdBy?: string;
};

function resolvePoints(type: string, override?: number): number {
  if (typeof override === "number") return override;
  if (type in POINT_RULES) return POINT_RULES[type as PointRuleType];
  return 0;
}

/**
 * Append one point event. Idempotent on (candidate, type, source_kind,
 * source_id) — calling twice for the same real source row inserts once.
 * Returns true if a NEW row was written, false if it was a duplicate no-op.
 */
export async function awardPoints(args: AwardArgs): Promise<boolean> {
  const db = getServiceSupabase();
  const row = {
    candidate_user_id: args.candidateUserId,
    cohort_id: args.cohortId ?? null,
    type: args.type,
    points: resolvePoints(args.type, args.points),
    source_kind: args.sourceKind,
    source_id: args.sourceId ?? null,
    meta: args.meta ?? {},
    note: args.note ?? null,
    created_by: args.createdBy ?? "system",
  };
  const { data, error } = await db
    .from("academy_point_events")
    .upsert(row, {
      onConflict: "candidate_user_id,type,source_kind,source_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Manual admin adjustment (can be negative). Always stacks — never deduped —
 * because source_id is NULL. Use for one-off corrections / bonuses.
 */
export async function adjustPoints(opts: {
  candidateUserId: string;
  points: number;
  note: string;
  createdBy: string;
  cohortId?: string | null;
}): Promise<void> {
  const db = getServiceSupabase();
  const { error } = await db.from("academy_point_events").insert({
    candidate_user_id: opts.candidateUserId,
    cohort_id: opts.cohortId ?? null,
    type: "manual_adjust",
    points: opts.points,
    source_kind: "manual",
    source_id: null,
    note: opts.note,
    created_by: opts.createdBy,
  });
  if (error) throw error;
}

/**
 * Grant a badge by its stable key + its catalogued points, in one shot.
 * Idempotent on both the badge grant and its point event.
 */
export async function awardBadge(opts: {
  candidateUserId: string;
  badgeKey: string;
  cohortId?: string | null;
  awardedBy?: string;
}): Promise<boolean> {
  const db = getServiceSupabase();
  const { data: badge, error: bErr } = await db
    .from("academy_badges")
    .select("id, points")
    .eq("key", opts.badgeKey)
    .maybeSingle();
  if (bErr) throw bErr;
  if (!badge) return false;

  const { data: inserted, error: sErr } = await db
    .from("academy_student_badges")
    .upsert(
      {
        candidate_user_id: opts.candidateUserId,
        badge_id: badge.id,
        awarded_by: opts.awardedBy ?? "system",
      },
      { onConflict: "candidate_user_id,badge_id", ignoreDuplicates: true },
    )
    .select("id");
  if (sErr) throw sErr;
  const isNew = Array.isArray(inserted) && inserted.length > 0;

  if (isNew && badge.points > 0) {
    await awardPoints({
      candidateUserId: opts.candidateUserId,
      type: "badge",
      sourceKind: "badge",
      sourceId: badge.id,
      cohortId: opts.cohortId,
      points: badge.points,
      meta: { badgeKey: opts.badgeKey },
    });
  }
  return isNew;
}

/** Total lifetime score = SUM of every ledger row for the candidate. */
export async function getScore(candidateUserId: string): Promise<number> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("academy_point_events")
    .select("points")
    .eq("candidate_user_id", candidateUserId);
  if (error) throw error;
  return (data ?? []).reduce((sum: number, r: { points: number }) => sum + (r.points ?? 0), 0);
}

export type LeaderboardRow = { candidateUserId: string; points: number };

/**
 * Per-cohort leaderboard. Pass `sinceISO` (e.g. start of the current week) for
 * the weekly board; omit for all-time. JS aggregation is fine at cohort scale;
 * if a cohort ever grows huge, promote this to a SQL view / RPC group-by.
 */
export async function getCohortLeaderboard(
  cohortId: string,
  sinceISO?: string,
): Promise<LeaderboardRow[]> {
  const db = getServiceSupabase();
  let q = db
    .from("academy_point_events")
    .select("candidate_user_id, points")
    .eq("cohort_id", cohortId);
  if (sinceISO) q = q.gte("created_at", sinceISO);
  const { data, error } = await q;
  if (error) throw error;

  const totals = new Map<string, number>();
  for (const r of (data ?? []) as { candidate_user_id: string; points: number }[]) {
    totals.set(r.candidate_user_id, (totals.get(r.candidate_user_id) ?? 0) + (r.points ?? 0));
  }
  return [...totals.entries()]
    .map(([candidateUserId, points]) => ({ candidateUserId, points }))
    .sort((a, b) => b.points - a.points);
}

/** UTC day key (YYYY-MM-DD) for streak bucketing. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Current activity streak in days — count of consecutive days (ending today or
 * yesterday) on which the candidate earned at least one point event. Returns 0
 * if the last activity is older than yesterday (streak broken).
 */
export async function getStreakDays(candidateUserId: string): Promise<number> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("academy_point_events")
    .select("created_at")
    .eq("candidate_user_id", candidateUserId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;

  const days = new Set<string>();
  for (const r of (data ?? []) as { created_at: string }[]) {
    days.add(dayKey(new Date(r.created_at)));
  }
  if (days.size === 0) return 0;

  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  // Anchor the streak to today if active today, else yesterday, else broken.
  let cursor: Date;
  if (days.has(dayKey(today))) cursor = today;
  else if (days.has(dayKey(yesterday))) cursor = yesterday;
  else return 0;

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return streak;
}

export type Reliability = {
  score: number;
  sessions: number;       // sessions with a recorded attendance row
  attendanceRate: number; // present+late / non-excused  (0..1)
  punctualityRate: number;// present / present+late       (0..1)
  quizzes: number;        // submissions
  onTimeRate: number;     // on-time submissions / submissions (0..1)
  passRate: number;       // passed / submissions             (0..1)
};

/**
 * The employer-facing reliability snapshot — the year-end recruiting signal.
 * Pure aggregate of attendance + submissions + ledger. Cheap; cache later if
 * the dossier view needs it for many candidates at once (P4).
 */
export async function getReliability(candidateUserId: string): Promise<Reliability> {
  const db = getServiceSupabase();
  const [attRes, subRes, score] = await Promise.all([
    db.from("academy_attendance").select("status").eq("candidate_user_id", candidateUserId),
    db.from("academy_submissions").select("on_time, passed").eq("candidate_user_id", candidateUserId),
    getScore(candidateUserId),
  ]);
  if (attRes.error) throw attRes.error;
  if (subRes.error) throw subRes.error;

  const att = (attRes.data ?? []) as { status: string }[];
  const counted = att.filter(a => a.status !== "excused");
  const present = counted.filter(a => a.status === "present").length;
  const late = counted.filter(a => a.status === "late").length;
  const showed = present + late;

  const subs = (subRes.data ?? []) as { on_time: boolean | null; passed: boolean | null }[];
  const onTime = subs.filter(s => s.on_time).length;
  const passed = subs.filter(s => s.passed).length;

  const ratio = (n: number, d: number) => (d > 0 ? n / d : 0);
  return {
    score,
    sessions: att.length,
    attendanceRate: ratio(showed, counted.length),
    punctualityRate: ratio(present, showed),
    quizzes: subs.length,
    onTimeRate: ratio(onTime, subs.length),
    passRate: ratio(passed, subs.length),
  };
}
