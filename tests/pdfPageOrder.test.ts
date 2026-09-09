import { describe, it, expect } from "vitest";
import { validatePageOrder, normalizeRotation, isUnchanged } from "../lib/pdfPageOrder";

describe("normalizeRotation", () => {
  it("keeps quarter turns", () => {
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
  });
  it("wraps negatives and full turns", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
  });
  it("ignores junk and non-quarter turns", () => {
    expect(normalizeRotation(37)).toBe(0);
    expect(normalizeRotation("90")).toBe(0);
    expect(normalizeRotation(undefined)).toBe(0);
    expect(normalizeRotation(NaN)).toBe(0);
  });
});

describe("validatePageOrder", () => {
  it("accepts a straight reorder", () => {
    const r = validatePageOrder([{ from: 2 }, { from: 0 }, { from: 1 }], 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pages.map(p => p.from)).toEqual([2, 0, 1]);
      expect(r.removed).toEqual([]);
    }
  });

  it("accepts bare numbers as page indices", () => {
    const r = validatePageOrder([1, 0], 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pages.map(p => p.from)).toEqual([1, 0]);
  });

  it("reports omitted pages as removed (that's how a blank scan sheet goes)", () => {
    const r = validatePageOrder([{ from: 0 }, { from: 2 }], 3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.removed).toEqual([1]);
  });

  it("REFUSES removing every page", () => {
    const r = validatePageOrder([], 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/every page/i);
  });

  it("REFUSES a duplicated page (would silently multiply it)", () => {
    const r = validatePageOrder([{ from: 0 }, { from: 0 }], 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/more than once/i);
  });

  it("REFUSES an out-of-range index", () => {
    expect(validatePageOrder([{ from: 5 }], 3).ok).toBe(false);
    expect(validatePageOrder([{ from: -1 }], 3).ok).toBe(false);
    expect(validatePageOrder([{ from: 1.5 }], 3).ok).toBe(false);
  });

  it("REFUSES more pages than the document has", () => {
    expect(validatePageOrder([{ from: 0 }, { from: 1 }, { from: 2 }], 2).ok).toBe(false);
  });

  it("REFUSES a non-array and an empty document", () => {
    expect(validatePageOrder("nope", 3).ok).toBe(false);
    expect(validatePageOrder([{ from: 0 }], 0).ok).toBe(false);
  });

  it("carries rotation through, normalised", () => {
    const r = validatePageOrder([{ from: 0, rotate: -90 }, { from: 1, rotate: 999 }], 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pages.map(p => p.rotate)).toEqual([270, 0]);
  });
});

describe("isUnchanged", () => {
  it("true only for the identity arrangement", () => {
    expect(isUnchanged([{ from: 0, rotate: 0 }, { from: 1, rotate: 0 }], 2)).toBe(true);
    expect(isUnchanged([{ from: 1, rotate: 0 }, { from: 0, rotate: 0 }], 2)).toBe(false);
    expect(isUnchanged([{ from: 0, rotate: 90 }, { from: 1, rotate: 0 }], 2)).toBe(false);
    expect(isUnchanged([{ from: 0, rotate: 0 }], 2)).toBe(false); // a page was dropped
  });
});
