/**
 * "Stuck" engine — the pipeline's chase signal. The flat weekly ⚡ (no activity
 * in 7 days) is too noisy for slow stages (Anerkennung takes months) and too
 * lax for fast ones (a CV should finalize in days). This applies a PER-STAGE
 * expected max duration: a candidate is "stuck" when they've sat at their
 * current station longer than that stage normally takes with no activity.
 *
 * Pure / server-safe + deterministic (days are injected, never read from a clock
 * here) so it's unit-testable.
 */

/** Expected max days at each station before it's worth a chase. Tune freely. */
export const STAGE_MAX_DAYS: Record<string, number> = {
  cv_finalized: 10,          // finalize the German CV quickly
  interview_first: 21,       // waiting on the employer to schedule/decide
  interview_second: 14,
  contract_signed: 14,
  recognition_submitted: 90, // Anerkennung review is genuinely slow
  vorabzustimmung: 35,
  docs_collected: 21,        // gather embassy papers
  visa_appointment: 14,      // book the appointment
  visa_approved: 35,         // embassy processing
  flight_booked: 14,
  housing_arranged: 21,
  arrived: 99999,            // terminal — never "stuck"
};

/** Fallback for any stage not in the table above. */
export const DEFAULT_STAGE_MAX_DAYS = 21;

export type StuckVerdict = {
  /** True when the candidate has sat at the current station beyond its budget. */
  stuck: boolean;
  /** Whole days since the last activity (null = never any activity). */
  days: number | null;
  /** The stage's expected-max budget used for the verdict. */
  threshold: number;
  /** The station they're stuck at (the current/next not-done preset). */
  stageKey: string | null;
};

/**
 * @param currentStageKey the candidate's current (first not-done) preset, or null if finished
 * @param daysSinceActivity whole days since their last activity (null = no activity ever)
 * @param done whether the candidate is fully arrived (never stuck)
 */
export function computeStuck(opts: {
  currentStageKey: string | null;
  daysSinceActivity: number | null;
  done: boolean;
}): StuckVerdict {
  const { currentStageKey, daysSinceActivity, done } = opts;
  if (done || !currentStageKey) {
    return { stuck: false, days: daysSinceActivity, threshold: 0, stageKey: currentStageKey };
  }
  const threshold = STAGE_MAX_DAYS[currentStageKey] ?? DEFAULT_STAGE_MAX_DAYS;
  // No activity on record at all → they need a chase regardless of stage.
  if (daysSinceActivity === null) {
    return { stuck: true, days: null, threshold, stageKey: currentStageKey };
  }
  return { stuck: daysSinceActivity >= threshold, days: daysSinceActivity, threshold, stageKey: currentStageKey };
}
