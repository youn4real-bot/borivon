/**
 * Anerkennung / Visa Autopilot — pipeline brain (Phase 1).
 *
 * Pure / server-safe (no imports beyond the preset catalog). Turns a candidate's
 * raw journey rows into an at-a-glance STATUS: where are they in the journey,
 * what's the current blocking step, is anything overdue/blocked. Powers the
 * admin "who's stuck where" board and the candidate progress rail.
 *
 * "today" is always injected (never read the clock here) so the logic is
 * deterministic and unit-testable.
 */

import { JOURNEY_PRESETS, SEQUENTIAL_PRESETS, PRESET_BY_KEY, type JourneyOwner } from "@/lib/candidateJourney";

export type JourneyRow = {
  id: string;
  owner: JourneyOwner;
  done: boolean;
  preset_key: string | null;
  position: number;
  text: string;
  due_date?: string | null;   // "YYYY-MM-DD"
  blocked?: boolean;
  blocked_reason?: string | null;
};

export type PipelineHealth = "on_track" | "due_soon" | "overdue" | "blocked" | "done";

export type PipelineStatus = {
  /** 0..1 share of preset milestones completed. */
  progress: number;
  doneCount: number;
  totalPresets: number;
  /** The next not-done preset milestone (the live "where are they"), or null if finished. */
  current: {
    key: string;
    owner: JourneyOwner;
    position: number;
    dueDate: string | null;
    blocked: boolean;
    blockedReason: string | null;
    /** Whole days until due (negative = overdue). null if no due date. */
    daysToDue: number | null;
  } | null;
  /**
   * The FURTHEST station the candidate has actually reached = their last
   * completed sequential preset. null = nothing done yet (they sit at the very
   * start). This is what the map groups avatars by, so a person visibly MOVES
   * to a station once they pass it (vs. `current`, which is their next to-do).
   */
  reached: { key: string; position: number } | null;
  /** Count of open (not-done) items past their due date. */
  overdueCount: number;
  /** Count of open items flagged blocked. */
  blockedCount: number;
  /** One rolled-up health signal for the row's color dot. */
  health: PipelineHealth;
  /**
   * Parallel (flexible-timing) milestones — e.g. B2 German. Reported separately
   * as side badges; they DON'T affect the rail position / current step, but a
   * not-done one DOES keep "arrived" from being true (you can't have fully
   * arrived without B2).
   */
  parallel: { key: string; done: boolean }[];
};

/** Whole-day difference between two YYYY-MM-DD dates (b - a), UTC-safe. */
export function daysBetween(aYMD: string, bYMD: string): number | null {
  const a = Date.parse(`${aYMD}T00:00:00Z`);
  const b = Date.parse(`${bYMD}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

const DUE_SOON_DAYS = 7;

/**
 * Compute a candidate's pipeline status from their journey rows.
 * @param rows     the candidate's candidate_journey_items
 * @param todayYMD "YYYY-MM-DD" (caller injects — e.g. Casablanca today)
 * @param b2Passed whether the candidate's B2 sub-journey is complete (B2 runs in
 *                 PARALLEL on candidate_profiles.b2_stage — it gates "fully
 *                 arrived" but never sits on the rail). Defaults true so callers
 *                 that don't track B2 are unaffected.
 */
export function computePipelineStatus(rows: JourneyRow[], todayYMD: string, b2Passed: boolean = true): PipelineStatus {
  // Index whatever preset rows EXIST by key. A candidate whose journey was never
  // opened has NO preset rows — those milestones are implicitly NOT done (they
  // sit at the very start), never "complete". We therefore evaluate against the
  // canonical preset list, not just the rows present.
  // Map rows by preset key, normalizing the legacy interview_done → interview_first
  // so a not-yet-migrated DB row still counts toward the rail.
  const rowByKey = new Map<string, JourneyRow>();
  for (const r of rows) {
    if (!r.preset_key) continue;
    const key = r.preset_key === "interview_done" ? "interview_first" : r.preset_key;
    if (PRESET_BY_KEY[key]) rowByKey.set(key, r);
  }

  // The RAIL is sequential presets only — B2 (parallel) never sits on the rail.
  const orderedPresets = SEQUENTIAL_PRESETS.slice().sort((a, b) => a.position - b.position);
  const totalPresets = orderedPresets.length;
  const doneCount = orderedPresets.filter((p) => rowByKey.get(p.key)?.done === true).length;
  const progress = totalPresets > 0 ? doneCount / totalPresets : 0;

  // Parallel milestones — B2 lives on candidate_profiles.b2_stage now (passed in
  // via b2Passed), so it's surfaced here as the single parallel badge.
  const parallel = [{ key: "b2_passed", done: b2Passed }];

  // Open dated/blocked counts span ALL items (presets + custom), since a stuck
  // custom task still means the candidate is stuck.
  const open = rows.filter((r) => !r.done);
  const overdueCount = open.filter((r) => {
    if (!r.due_date) return false;
    const d = daysBetween(todayYMD, r.due_date);
    return d !== null && d < 0;
  }).length;
  const blockedCount = open.filter((r) => r.blocked === true).length;

  // The "current" step = the first preset (by position) that is NOT done —
  // whether its row says done:false OR no row exists yet. Only when EVERY one
  // of the 11 presets is actually ticked is there no current step ("arrived").
  const nextPreset = orderedPresets.find((p) => rowByKey.get(p.key)?.done !== true) ?? null;

  let current: PipelineStatus["current"] = null;
  if (nextPreset) {
    const row = rowByKey.get(nextPreset.key);
    const dueDate = row?.due_date ?? null;
    const daysToDue = dueDate ? daysBetween(todayYMD, dueDate) : null;
    current = {
      key: nextPreset.key,
      owner: nextPreset.owner,
      position: nextPreset.position,
      dueDate,
      blocked: row?.blocked === true,
      blockedReason: row?.blocked_reason ?? null,
      daysToDue,
    };
  }

  // FURTHEST reached = the highest-position preset that is DONE. This is where
  // the avatar sits on the map (they "move in" once they pass a station).
  let reached: PipelineStatus["reached"] = null;
  for (const p of orderedPresets) {
    if (rowByKey.get(p.key)?.done === true) reached = { key: p.key, position: p.position };
  }

  // "Fully arrived" = every sequential station done AND every parallel
  // milestone (B2) done. So a candidate sitting at the last rail station with
  // B2 still pending is NOT "done" yet.
  const allParallelDone = parallel.every((p) => p.done);
  const fullyArrived = !current && allParallelDone;

  // Roll up to one health signal (priority: done > blocked > overdue > due_soon > on_track).
  let health: PipelineHealth;
  if (fullyArrived) health = "done";
  else if (blockedCount > 0) health = "blocked";
  else if (overdueCount > 0) health = "overdue";
  else if (current && current.daysToDue !== null && current.daysToDue <= DUE_SOON_DAYS) health = "due_soon";
  else health = "on_track";

  return { progress, doneCount, totalPresets, current, reached, overdueCount, blockedCount, health, parallel };
}
