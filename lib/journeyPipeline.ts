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

import { JOURNEY_PRESETS, PRESET_BY_KEY, type JourneyOwner } from "@/lib/candidateJourney";

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
  /** Count of open (not-done) items past their due date. */
  overdueCount: number;
  /** Count of open items flagged blocked. */
  blockedCount: number;
  /** One rolled-up health signal for the row's color dot. */
  health: PipelineHealth;
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
 */
export function computePipelineStatus(rows: JourneyRow[], todayYMD: string): PipelineStatus {
  const presets = rows.filter((r) => r.preset_key && PRESET_BY_KEY[r.preset_key]);
  const totalPresets = JOURNEY_PRESETS.length;
  const doneCount = presets.filter((r) => r.done).length;
  const progress = totalPresets > 0 ? doneCount / totalPresets : 0;

  // Open dated/blocked counts span ALL items (presets + custom), since a stuck
  // custom task still means the candidate is stuck.
  const open = rows.filter((r) => !r.done);
  const overdueCount = open.filter((r) => {
    if (!r.due_date) return false;
    const d = daysBetween(todayYMD, r.due_date);
    return d !== null && d < 0;
  }).length;
  const blockedCount = open.filter((r) => r.blocked === true).length;

  // The "current" step = the lowest-position not-done PRESET milestone.
  const nextPreset = presets
    .filter((r) => !r.done)
    .sort((a, b) => a.position - b.position)[0];

  let current: PipelineStatus["current"] = null;
  if (nextPreset && nextPreset.preset_key) {
    const daysToDue = nextPreset.due_date ? daysBetween(todayYMD, nextPreset.due_date) : null;
    current = {
      key: nextPreset.preset_key,
      owner: nextPreset.owner,
      position: nextPreset.position,
      dueDate: nextPreset.due_date ?? null,
      blocked: nextPreset.blocked === true,
      blockedReason: nextPreset.blocked_reason ?? null,
      daysToDue,
    };
  }

  // Roll up to one health signal (priority: done > blocked > overdue > due_soon > on_track).
  let health: PipelineHealth;
  if (!current) health = "done";
  else if (blockedCount > 0) health = "blocked";
  else if (overdueCount > 0) health = "overdue";
  else if (current.daysToDue !== null && current.daysToDue <= DUE_SOON_DAYS) health = "due_soon";
  else health = "on_track";

  return { progress, doneCount, totalPresets, current, overdueCount, blockedCount, health };
}
