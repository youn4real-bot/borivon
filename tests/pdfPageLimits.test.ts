import { describe, it, expect } from "vitest";
import { pdfPageLimit, PDF_PAGE_LIMITS, DEFAULT_PDF_PAGE_LIMIT } from "../lib/pdfPageLimits";

describe("pdfPageLimit (per-box PDF page caps)", () => {
  it("returns the exact cap for a known box", () => {
    expect(pdfPageLimit("id")).toBe(PDF_PAGE_LIMITS.id);
    expect(pdfPageLimit("studyprog")).toBe(25);
    expect(pdfPageLimit("cv_de")).toBe(8);
  });

  it("shares the base cap with translated variants", () => {
    expect(pdfPageLimit("diploma_de")).toBe(pdfPageLimit("diploma"));
    expect(pdfPageLimit("abitur_transcript_de")).toBe(pdfPageLimit("abitur_transcript"));
    expect(pdfPageLimit("other_trans")).toBe(pdfPageLimit("other"));
    // "work_experience" must NOT be mis-stripped to "work"
    expect(pdfPageLimit("work_experience")).toBe(20);
    expect(pdfPageLimit("work_experience_de")).toBe(20);
  });

  it("falls back to the default for unknown / wizard-slot (UUID) keys", () => {
    expect(pdfPageLimit("3f9a1b2c-0000-4000-8000-000000000000")).toBe(DEFAULT_PDF_PAGE_LIMIT);
    expect(pdfPageLimit("totally_unknown_box")).toBe(DEFAULT_PDF_PAGE_LIMIT);
    expect(pdfPageLimit(null)).toBe(DEFAULT_PDF_PAGE_LIMIT);
    expect(pdfPageLimit(undefined)).toBe(DEFAULT_PDF_PAGE_LIMIT);
  });

  it("keeps the passport cap tight but never zero", () => {
    expect(pdfPageLimit("id")).toBeGreaterThan(0);
    expect(pdfPageLimit("id")).toBeLessThanOrEqual(10);
  });
});
