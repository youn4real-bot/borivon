import { describe, it, expect } from "vitest";
import { computePipelineStatus, daysBetween, type JourneyRow } from "../lib/journeyPipeline";
import { JOURNEY_PRESETS } from "../lib/candidateJourney";

const TODAY = "2026-06-02";

// Build the full seeded preset set, optionally overriding a few rows.
function presetRows(overrides: Partial<Record<string, Partial<JourneyRow>>> = {}): JourneyRow[] {
  return JOURNEY_PRESETS.map((p, i) => ({
    id: `id-${i}`,
    owner: p.owner,
    done: false,
    preset_key: p.key,
    position: p.position,
    text: p.label.en,
    due_date: null,
    blocked: false,
    blocked_reason: null,
    ...(overrides[p.key] ?? {}),
  }));
}

describe("daysBetween", () => {
  it("counts whole days forward and backward", () => {
    expect(daysBetween("2026-06-02", "2026-06-09")).toBe(7);
    expect(daysBetween("2026-06-02", "2026-05-30")).toBe(-3);
    expect(daysBetween("2026-06-02", "2026-06-02")).toBe(0);
  });
  it("returns null on bad input", () => {
    expect(daysBetween("nope", "2026-06-02")).toBeNull();
  });
});

describe("computePipelineStatus", () => {
  it("fresh candidate → first preset is current, on_track, 0 progress", () => {
    const s = computePipelineStatus(presetRows(), TODAY);
    expect(s.doneCount).toBe(0);
    expect(s.progress).toBe(0);
    expect(s.current?.key).toBe("docs_collected"); // position 0
    expect(s.health).toBe("on_track");
  });

  it("REGRESSION: a candidate with NO journey rows is at the START, never 'arrived'", () => {
    // The original bug: an unseeded candidate (empty rows) was bucketed as
    // "done / Arrived in Germany". Empty ≠ complete.
    const s = computePipelineStatus([], TODAY);
    expect(s.doneCount).toBe(0);
    expect(s.progress).toBe(0);
    expect(s.current?.key).toBe("docs_collected"); // first milestone
    expect(s.health).not.toBe("done");
    expect(s.health).toBe("on_track");
  });

  it("partial rows present → current skips to first incomplete, missing rows count as not-done", () => {
    // Only the first milestone exists + is done; the other 10 rows don't exist.
    const s = computePipelineStatus(
      [{ id: "x", owner: "candidate", done: true, preset_key: "docs_collected", position: 0, text: "", due_date: null, blocked: false, blocked_reason: null }],
      TODAY,
    );
    expect(s.doneCount).toBe(1);
    expect(s.current?.key).toBe("cv_finalized"); // position 1 — missing row, treated as not-done
    expect(s.health).not.toBe("done");
  });

  it("current step advances to the lowest-position not-done SEQUENTIAL preset (skips parallel B2)", () => {
    const s = computePipelineStatus(
      presetRows({ docs_collected: { done: true }, cv_finalized: { done: true } }),
      TODAY,
    );
    expect(s.doneCount).toBe(2);
    expect(s.current?.key).toBe("interview_first"); // B2 is parallel, not the next rail step
  });

  it("B2 is PARALLEL (passed via arg): not passing it never makes the candidate 'stuck at B2'", () => {
    // Far down the rail (through contract) but B2 not passed → current is the
    // next RAIL step (recognition). B2 lives on the b2Passed arg, off the rail.
    const s = computePipelineStatus(
      presetRows({
        docs_collected: { done: true }, cv_finalized: { done: true },
        interview_first: { done: true }, interview_second: { done: true },
        contract_signed: { done: true },
      }),
      TODAY,
      false, // B2 not passed
    );
    expect(s.current?.key).toBe("recognition_submitted");
    expect(s.parallel.find((p) => p.key === "b2_passed")?.done).toBe(false);
  });

  it("all RAIL stations done but B2 still pending → NOT fully arrived", () => {
    const railDone = Object.fromEntries(JOURNEY_PRESETS.map((p) => [p.key, { done: true }]));
    const s = computePipelineStatus(presetRows(railDone), TODAY, false); // B2 not passed
    expect(s.current).toBeNull();        // no rail step left
    expect(s.health).not.toBe("done");   // …but B2 pending → not arrived
  });

  it("all rail done AND B2 passed → current null, health done, progress 1", () => {
    const all = Object.fromEntries(JOURNEY_PRESETS.map((p) => [p.key, { done: true }]));
    const s = computePipelineStatus(presetRows(all), TODAY, true); // B2 passed
    expect(s.current).toBeNull();
    expect(s.health).toBe("done");
    expect(s.progress).toBe(1);
  });

  it("an open past-due item → overdue health + count", () => {
    const s = computePipelineStatus(presetRows({ docs_collected: { due_date: "2026-05-20" } }), TODAY);
    expect(s.overdueCount).toBe(1);
    expect(s.health).toBe("overdue");
    expect(s.current?.daysToDue).toBe(daysBetween(TODAY, "2026-05-20"));
  });

  it("due within 7 days but not past → due_soon", () => {
    const s = computePipelineStatus(presetRows({ docs_collected: { due_date: "2026-06-06" } }), TODAY);
    expect(s.health).toBe("due_soon");
    expect(s.overdueCount).toBe(0);
  });

  it("blocked beats overdue in health priority", () => {
    const s = computePipelineStatus(
      presetRows({ docs_collected: { blocked: true, due_date: "2026-05-01" } }),
      TODAY,
    );
    expect(s.blockedCount).toBe(1);
    expect(s.overdueCount).toBe(1);
    expect(s.health).toBe("blocked");
  });

  it("a done item is never overdue/blocked even if its date passed", () => {
    const s = computePipelineStatus(
      presetRows(Object.fromEntries(JOURNEY_PRESETS.map((p) => [p.key, { done: true, due_date: "2020-01-01", blocked: true }]))),
      TODAY,
    );
    expect(s.overdueCount).toBe(0);
    expect(s.blockedCount).toBe(0);
    expect(s.health).toBe("done");
  });
});
