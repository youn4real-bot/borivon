import { describe, it, expect } from "vitest";
import { shouldSupersedePrevious, idsToRetire, MULTI_DOC_FILE_KEYS } from "@/lib/slotSupersede";

/**
 * Re-uploading inserted a new row and left the old one live. The candidate never
 * saw it — the dashboard de-duplicates client-side — but the admin queue counts
 * rows, so each re-upload added an orange badge nobody could clear.
 *
 * Live before the fix: 67 slots with more than one live document, 147 redundant
 * copies, one candidate with twelve live CVs, and 126 of 181 documents awaiting
 * review sitting in a duplicated slot.
 */
describe("shouldSupersedePrevious", () => {
  it("collapses an ordinary slot", () => {
    for (const k of ["id", "reisepass", "cv_de", "diplom", "b2_zertifikat"]) {
      expect(shouldSupersedePrevious(k)).toBe(true);
    }
  });

  it("NEVER collapses Sonstiges — those files are peers, not versions", () => {
    // Collapsing this one would archive every "other" document a candidate has
    // ever added except the last, which is real data loss dressed as tidying.
    expect(shouldSupersedePrevious("other")).toBe(false);
    expect(MULTI_DOC_FILE_KEYS.has("other")).toBe(true);
  });

  it("collapses a wizard slot, whose key is a raw UUID", () => {
    expect(shouldSupersedePrevious("ad88cd94-acc9-46fd-a310-ab5daf988df6")).toBe(true);
  });

  it("does nothing when there is no key to reason about", () => {
    for (const k of [null, undefined, "", "   "]) expect(shouldSupersedePrevious(k)).toBe(false);
  });
});

describe("idsToRetire", () => {
  const rows = [
    { id: "new", superseded_at: null },
    { id: "old-1", superseded_at: null },
    { id: "old-2", superseded_at: null },
    { id: "already-archived", superseded_at: "2026-01-01T00:00:00.000Z" },
  ];

  it("retires the previous live rows", () => {
    expect(idsToRetire(rows, "new").sort()).toEqual(["old-1", "old-2"]);
  });

  it("never retires the row just inserted", () => {
    // Getting this wrong would archive the upload the candidate just made and
    // leave the slot looking empty.
    expect(idsToRetire(rows, "new")).not.toContain("new");
  });

  it("leaves already-archived rows alone", () => {
    // Re-stamping them would move their archive date and lose when it happened.
    expect(idsToRetire(rows, "new")).not.toContain("already-archived");
  });

  it("returns nothing for the first upload into an empty slot", () => {
    expect(idsToRetire([{ id: "new", superseded_at: null }], "new")).toEqual([]);
  });

  it("handles a slot with twelve stacked copies", () => {
    const stacked = Array.from({ length: 12 }, (_, i) => ({ id: `cv-${i}`, superseded_at: null }));
    expect(idsToRetire(stacked, "cv-11")).toHaveLength(11);
  });
});
