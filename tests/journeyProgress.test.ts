import { describe, it, expect } from "vitest";
import { computeJourneyProgress, VISUM_PERMANENT_REQUIRED, type JourneySlot } from "../lib/journeyProgress";
import { CHECKLIST_ITEMS, type DocLike } from "../lib/candidateChecklist";
import { FILE_KEY_ALL_LABELS } from "../lib/fileKeys";

function labelFor(key: string): string {
  const set = FILE_KEY_ALL_LABELS[key];
  return set && set.size ? [...set][0] : key;
}

// All default-required papers (Essentials + Qualifications, + translations) approved.
function allPapersApproved(): DocLike[] {
  const docs: DocLike[] = [];
  for (const it of CHECKLIST_ITEMS) {
    if (it.optional) continue;
    docs.push({ file_type: labelFor(it.key), status: "approved" });
    if (it.hasTranslation) docs.push({ file_type: labelFor(`${it.key}_de`), status: "approved" });
  }
  return docs;
}

function allVisumPermanentApproved(): DocLike[] {
  return VISUM_PERMANENT_REQUIRED.map(k => ({ file_type: labelFor(k), status: "approved" as const }));
}

const NO_SLOTS = { bearbeitungSlots: [] as JourneySlot[], visumSlots: [] as JourneySlot[] };

describe("computeJourneyProgress", () => {
  it("nothing done → 0%", () => {
    const j = computeJourneyProgress({ docs: [], arrived: false, ...NO_SLOTS });
    expect(j.pct).toBe(0);
    expect(j.arrived).toBe(false);
  });

  it("never reads 100% until arrived (papers + all Visum boxes done, not arrived)", () => {
    const j = computeJourneyProgress({
      docs: [...allPapersApproved(), ...allVisumPermanentApproved()],
      arrived: false,
      ...NO_SLOTS,
    });
    expect(j.pct).toBeLessThan(100);
    expect(j.pct).toBeGreaterThan(0);
  });

  it("papers + all Visum boxes + arrived (no slots) → 100%", () => {
    const j = computeJourneyProgress({
      docs: [...allPapersApproved(), ...allVisumPermanentApproved()],
      arrived: true,
      ...NO_SLOTS,
    });
    expect(j.pct).toBe(100);
  });

  it("papers-only moves the bar but stays partial (Visum + arrival still open)", () => {
    const j = computeJourneyProgress({ docs: allPapersApproved(), arrived: false, ...NO_SLOTS });
    // papers weight 35 of active {papers35, visum25, arrived20} = 35/80 ≈ 44%
    expect(j.pct).toBe(44);
  });

  it("arrival alone contributes its slice", () => {
    const j = computeJourneyProgress({ docs: [], arrived: true, ...NO_SLOTS });
    // arrived 20 of active {papers35, visum25, arrived20} = 20/80 = 25%
    expect(j.pct).toBe(25);
  });

  it("Bearbeitung slots enter the denominator and move the bar when approved", () => {
    const slots: JourneySlot[] = [
      { id: "slot-a", type: "simple", is_required: true },
      { id: "slot-b", type: "simple", is_required: true },
    ];
    const j = computeJourneyProgress({
      docs: [{ file_type: "slot-a", status: "approved" }, { file_type: "slot-b", status: "approved" }],
      arrived: false,
      bearbeitungSlots: slots,
      visumSlots: [],
    });
    // bearb 20/20 done, papers 0, visum 0, arrived 0 → active {35,20,25,20}=100 → 20/100 = 20%
    expect(j.pct).toBe(20);
  });

  it("a dual slot needs BOTH original and _de approved to count", () => {
    const slots: JourneySlot[] = [{ id: "dual-1", type: "dual", is_required: true }];
    const onlyOrig = computeJourneyProgress({
      docs: [{ file_type: "dual-1", status: "approved" }],
      arrived: false, bearbeitungSlots: slots, visumSlots: [],
    });
    expect(onlyOrig.segments.find(s => s.key === "bearbeitung")!.done).toBe(0);
    const both = computeJourneyProgress({
      docs: [{ file_type: "dual-1", status: "approved" }, { file_type: "dual-1_de", status: "approved" }],
      arrived: false, bearbeitungSlots: slots, visumSlots: [],
    });
    expect(both.segments.find(s => s.key === "bearbeitung")!.done).toBe(1);
  });

  it("optional slots (is_required=false) are excluded from the denominator", () => {
    const slots: JourneySlot[] = [
      { id: "req", type: "simple", is_required: true },
      { id: "opt", type: "simple", is_required: false },
    ];
    const j = computeJourneyProgress({ docs: [], arrived: false, bearbeitungSlots: slots, visumSlots: [] });
    expect(j.segments.find(s => s.key === "bearbeitung")!.total).toBe(1);
  });

  it("langcert is not double-counted (papers only, never a Visum box here)", () => {
    // langcert approved as an Essentials paper; it must NOT also satisfy a Visum box.
    const j = computeJourneyProgress({ docs: [{ file_type: labelFor("langcert"), status: "approved" }], arrived: false, ...NO_SLOTS });
    expect(VISUM_PERMANENT_REQUIRED).not.toContain("langcert");
    expect(j.segments.find(s => s.key === "visum")!.done).toBe(0);
  });

  it("only-approved counts (a pending/rejected doc does not move the bar)", () => {
    const j = computeJourneyProgress({
      docs: [{ file_type: labelFor("id"), status: "pending" }, { file_type: labelFor("cv_de"), status: "rejected" }],
      arrived: false, ...NO_SLOTS,
    });
    expect(j.segments.find(s => s.key === "papers")!.done).toBe(0);
  });

  it("org requiredKeys override shrinks the papers denominator", () => {
    const docs: DocLike[] = [
      { file_type: labelFor("id"), status: "approved" },
      { file_type: labelFor("cv_de"), status: "approved" },
    ];
    const j = computeJourneyProgress({ docs, arrived: false, requiredKeys: ["id", "cv_de"], ...NO_SLOTS });
    const papers = j.segments.find(s => s.key === "papers")!;
    expect(papers.total).toBe(2);
    expect(papers.done).toBe(2);
  });
});
