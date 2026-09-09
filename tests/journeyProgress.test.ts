import { describe, it, expect } from "vitest";
import { computeJourneyProgress, VISUM_PERMANENT_REQUIRED, JOURNEY_PHASE_ORDER, type JourneySlot } from "../lib/journeyProgress";
import { CHECKLIST_ITEMS, type DocLike } from "../lib/candidateChecklist";
import { FILE_KEY_ALL_LABELS } from "../lib/fileKeys";

function labelFor(key: string): string {
  const set = FILE_KEY_ALL_LABELS[key];
  return set && set.size ? [...set][0] : key;
}

/** Every default-REQUIRED paper (Essentials + Qualifications, + translations) approved. */
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
const req = (id: string, type: string | null = "simple"): JourneySlot => ({ id, type, is_required: true });

describe("computeJourneyProgress — one phase at a time", () => {
  it("starts in the papers phase at 0%", () => {
    const j = computeJourneyProgress({ docs: [], ...NO_SLOTS });
    expect(j.current!.key).toBe("papers");
    expect(j.current!.pct).toBe(0);
    expect(j.currentIndex).toBe(0);
    expect(j.allDone).toBe(false);
  });

  it("papers % climbs while still in the papers phase", () => {
    const j = computeJourneyProgress({ docs: [{ file_type: labelFor("id"), status: "approved" }], ...NO_SLOTS });
    expect(j.current!.key).toBe("papers");
    expect(j.current!.done).toBe(1);
    expect(j.current!.pct).toBeGreaterThan(0);
    expect(j.current!.pct).toBeLessThan(100);
  });

  it("papers complete → hands over to Bearbeitung (the papers % is gone)", () => {
    const j = computeJourneyProgress({
      docs: allPapersApproved(),
      bearbeitungSlots: [req("b1"), req("b2")],
      visumSlots: [],
    });
    expect(j.current!.key).toBe("bearbeitung");
    expect(j.current!.pct).toBe(0);
    expect(j.currentIndex).toBe(1);
  });

  it("Bearbeitung complete → hands over to Visum", () => {
    const j = computeJourneyProgress({
      docs: [...allPapersApproved(), { file_type: "b1", status: "approved" }],
      bearbeitungSlots: [req("b1")],
      visumSlots: [],
    });
    expect(j.current!.key).toBe("visum");
    expect(j.currentIndex).toBe(2);
  });

  it("a phase with NO defined work is skipped entirely (0-of-0 is meaningless)", () => {
    // No Bearbeitung slots configured → papers hands straight over to Visum.
    const j = computeJourneyProgress({ docs: allPapersApproved(), ...NO_SLOTS });
    expect(j.current!.key).toBe("visum");
    expect(j.phases.find(p => p.key === "bearbeitung")!.total).toBe(0);
  });

  it("everything done → allDone, resting on the last phase at 100%", () => {
    const j = computeJourneyProgress({
      docs: [...allPapersApproved(), ...allVisumPermanentApproved()],
      ...NO_SLOTS,
    });
    expect(j.allDone).toBe(true);
    expect(j.current!.key).toBe("visum");
    expect(j.current!.pct).toBe(100);
  });

  it("Visum counts permanent boxes AND applicable slots together", () => {
    const j = computeJourneyProgress({
      docs: [...allPapersApproved(), ...allVisumPermanentApproved()],
      bearbeitungSlots: [],
      visumSlots: [req("v1")],
    });
    const visum = j.phases.find(p => p.key === "visum")!;
    expect(visum.total).toBe(VISUM_PERMANENT_REQUIRED.length + 1);
    expect(visum.done).toBe(VISUM_PERMANENT_REQUIRED.length);
    expect(j.current!.key).toBe("visum");
    expect(j.allDone).toBe(false);
  });

  it("a dual slot needs BOTH original and _de approved", () => {
    const slots = [req("dual-1", "dual")];
    const onlyOrig = computeJourneyProgress({
      docs: [{ file_type: "dual-1", status: "approved" }], bearbeitungSlots: slots, visumSlots: [],
    });
    expect(onlyOrig.phases.find(p => p.key === "bearbeitung")!.done).toBe(0);
    const both = computeJourneyProgress({
      docs: [{ file_type: "dual-1", status: "approved" }, { file_type: "dual-1_de", status: "approved" }],
      bearbeitungSlots: slots, visumSlots: [],
    });
    expect(both.phases.find(p => p.key === "bearbeitung")!.done).toBe(1);
  });

  it("optional slots (is_required=false) are excluded from the denominator", () => {
    const j = computeJourneyProgress({
      docs: [],
      bearbeitungSlots: [req("r"), { id: "o", type: "simple", is_required: false }],
      visumSlots: [],
    });
    expect(j.phases.find(p => p.key === "bearbeitung")!.total).toBe(1);
  });

  it("only APPROVED counts — pending/rejected never advance a phase", () => {
    const j = computeJourneyProgress({
      docs: [{ file_type: labelFor("id"), status: "pending" }, { file_type: "b1", status: "rejected" }],
      bearbeitungSlots: [req("b1")], visumSlots: [],
    });
    expect(j.phases.find(p => p.key === "papers")!.done).toBe(0);
    expect(j.phases.find(p => p.key === "bearbeitung")!.done).toBe(0);
  });

  it("langcert is never double-counted (papers only, not a Visum box)", () => {
    expect(VISUM_PERMANENT_REQUIRED).not.toContain("langcert");
    const j = computeJourneyProgress({ docs: [{ file_type: labelFor("langcert"), status: "approved" }], ...NO_SLOTS });
    expect(j.phases.find(p => p.key === "visum")!.done).toBe(0);
  });

  it("STANDING RULE: Berufserfahrung / Praktikum never hold the papers phase back", () => {
    // allPapersApproved() skips every optional item, yet papers still completes.
    const j = computeJourneyProgress({ docs: allPapersApproved(), ...NO_SLOTS });
    const papers = j.phases.find(p => p.key === "papers")!;
    expect(papers.done).toBe(papers.total);
    expect(papers.pct).toBe(100);
  });

  it("phase order is papers → bearbeitung → visum (drives the sort)", () => {
    expect(JOURNEY_PHASE_ORDER).toEqual(["papers", "bearbeitung", "visum"]);
  });

  describe("Impfung is a permanent VISUM box for every candidate", () => {
    it("counts toward the Visum phase", () => {
      expect(VISUM_PERMANENT_REQUIRED).toContain("impfung");
      const j = computeJourneyProgress({ docs: [{ file_type: labelFor("impfung"), status: "approved" }], ...NO_SLOTS });
      expect(j.phases.find(p => p.key === "visum")!.done).toBe(1);
    });

    it("does NOT hold the papers phase back (it is scored in Visum, not twice)", () => {
      // allPapersApproved() includes impfung; papers must still complete without
      // it, and impfung must not be counted in both phases.
      const withoutImpfung = allPapersApproved().filter(
        d => d.file_type !== labelFor("impfung") && d.file_type !== labelFor("impfung_de"));
      const j = computeJourneyProgress({ docs: withoutImpfung, ...NO_SLOTS });
      const papers = j.phases.find(p => p.key === "papers")!;
      expect(papers.pct).toBe(100);
      expect(j.current!.key).toBe("visum");
      expect(j.phases.find(p => p.key === "visum")!.done).toBe(0);
    });

    it("every candidate gets it — Visum total always includes Impfung", () => {
      const j = computeJourneyProgress({ docs: [], ...NO_SLOTS });
      expect(j.phases.find(p => p.key === "visum")!.total).toBe(VISUM_PERMANENT_REQUIRED.length);
    });
  });
});
