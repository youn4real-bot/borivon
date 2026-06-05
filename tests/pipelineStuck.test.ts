import { describe, it, expect } from "vitest";
import { computeStuck, STAGE_MAX_DAYS, DEFAULT_STAGE_MAX_DAYS } from "@/lib/pipelineStuck";

describe("computeStuck — the chase signal", () => {
  it("uses the per-stage budget: a fast stage trips earlier than a slow one", () => {
    // 12 days at the CV stage (budget 10) → stuck; same 12 days at recognition (90) → fine.
    expect(computeStuck({ currentStageKey: "cv_finalized", daysSinceActivity: 12, done: false }).stuck).toBe(true);
    expect(computeStuck({ currentStageKey: "recognition_submitted", daysSinceActivity: 12, done: false }).stuck).toBe(false);
  });

  it("matches the documented visa-appointment example (~14 days)", () => {
    expect(computeStuck({ currentStageKey: "visa_appointment", daysSinceActivity: 13, done: false }).stuck).toBe(false);
    expect(computeStuck({ currentStageKey: "visa_appointment", daysSinceActivity: 14, done: false }).stuck).toBe(true);
  });

  it("no activity on record at all → always a chase", () => {
    const v = computeStuck({ currentStageKey: "interview_first", daysSinceActivity: null, done: false });
    expect(v.stuck).toBe(true);
    expect(v.days).toBeNull();
  });

  it("a finished candidate is never stuck", () => {
    expect(computeStuck({ currentStageKey: "arrived", daysSinceActivity: 999, done: true }).stuck).toBe(false);
    expect(computeStuck({ currentStageKey: null, daysSinceActivity: 999, done: false }).stuck).toBe(false);
  });

  it("falls back to the default budget for an unknown stage", () => {
    const v = computeStuck({ currentStageKey: "mystery_stage", daysSinceActivity: DEFAULT_STAGE_MAX_DAYS, done: false });
    expect(v.threshold).toBe(DEFAULT_STAGE_MAX_DAYS);
    expect(v.stuck).toBe(true);
  });

  it("reports the stage + threshold it used", () => {
    const v = computeStuck({ currentStageKey: "visa_appointment", daysSinceActivity: 20, done: false });
    expect(v).toEqual({ stuck: true, days: 20, threshold: STAGE_MAX_DAYS.visa_appointment, stageKey: "visa_appointment" });
  });
});
