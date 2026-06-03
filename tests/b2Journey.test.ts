import { describe, it, expect } from "vitest";
import { B2_STAGES, normalizeB2Stage, isB2Stage, isB2Passed, b2StageColor, effectiveB2Stage, isB2CertDoc } from "../lib/b2Journey";

describe("b2Journey", () => {
  it("has the 5 main stages + 3 failure-branch stages", () => {
    expect(B2_STAGES.map((s) => s.key)).toEqual([
      "studying", "expected_date", "exam_booked", "awaiting_results", "passed",
      "failed", "retake_expected", "retake_booked",
    ]);
  });

  it("normalizeB2Stage falls back to studying (the start) on junk", () => {
    expect(normalizeB2Stage("exam_booked")).toBe("exam_booked");
    expect(normalizeB2Stage("garbage")).toBe("studying");
    expect(normalizeB2Stage(null)).toBe("studying");
    expect(normalizeB2Stage(undefined)).toBe("studying");
  });

  it("isB2Stage validates", () => {
    expect(isB2Stage("failed")).toBe(true);
    expect(isB2Stage("awaiting_results")).toBe(true);
    expect(isB2Stage("nope")).toBe(false);
  });

  it("isB2Passed only at passed", () => {
    expect(isB2Passed("passed")).toBe(true);
    expect(isB2Passed("exam_booked")).toBe(false);
    expect(isB2Passed("failed")).toBe(false);
  });

  it("every stage has a colour", () => {
    for (const s of B2_STAGES) expect(b2StageColor(s.key)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("isB2CertDoc matches the FR/EN/DE certificate labels", () => {
    expect(isB2CertDoc("B2 Sprachzertifikat")).toBe(true);
    expect(isB2CertDoc("B2 Language Certificate")).toBe(true);
    expect(isB2CertDoc("Certificat de langue B2")).toBe(true);
    expect(isB2CertDoc("Reisepass")).toBe(false);
    expect(isB2CertDoc(null)).toBe(false);
  });

  it("effectiveB2Stage: approved cert → passed; pending cert → awaiting_results; else stored", () => {
    // Approved B2 cert overrides the stored stage.
    expect(effectiveB2Stage("studying", [{ file_type: "B2 Language Certificate", status: "approved" }])).toBe("passed");
    // Uploaded but pending cert → they've sat the exam → at least awaiting_results.
    expect(effectiveB2Stage("studying", [{ file_type: "Certificat de langue B2", status: "pending" }])).toBe("awaiting_results");
    // No cert → keep the stored stage (admin's manual call).
    expect(effectiveB2Stage("expected_date", [])).toBe("expected_date");
    // A failure-branch stage is admin-set and wins over a pending cert.
    expect(effectiveB2Stage("retake_booked", [{ file_type: "B2 Sprachzertifikat", status: "pending" }])).toBe("retake_booked");
  });
});
