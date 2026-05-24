import { describe, it, expect } from "vitest";
import { pdfPageLimit, PDF_PAGE_LIMITS, DEFAULT_PDF_PAGE_LIMIT } from "../lib/pdfPageLimits";

describe("pdfPageLimit (per-box PDF page caps)", () => {
  it("returns the exact cap for a known box", () => {
    expect(pdfPageLimit("id")).toBe(2);
    expect(pdfPageLimit("letter")).toBe(1);
    expect(pdfPageLimit("studyprog")).toBe(10);
    expect(pdfPageLimit("cv_de")).toBe(2);
    expect(pdfPageLimit("transcript")).toBe(PDF_PAGE_LIMITS.transcript);
  });

  it("caps original and translation SEPARATELY (same number, independent boxes)", () => {
    expect(pdfPageLimit("diploma")).toBe(2);
    expect(pdfPageLimit("diploma_de")).toBe(2);
    expect(pdfPageLimit("studyprog")).toBe(10);
    expect(pdfPageLimit("studyprog_de")).toBe(10);
    expect(pdfPageLimit("work_experience")).toBe(10);
    expect(pdfPageLimit("work_experience_de")).toBe(10);
    expect(pdfPageLimit("other")).toBe(10);
    expect(pdfPageLimit("other_trans")).toBe(10);
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
