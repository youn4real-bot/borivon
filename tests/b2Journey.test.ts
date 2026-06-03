import { describe, it, expect } from "vitest";
import { B2_STAGES, normalizeB2Stage, isB2Stage, isB2Passed, b2StageColor, effectiveB2Stage, isB2CertDoc } from "../lib/b2Journey";

describe("b2Journey", () => {
  it("has the 7 sub-stages + not_started, in loop order", () => {
    expect(B2_STAGES.map((s) => s.key)).toEqual([
      "not_started", "searching", "studying", "registered", "booked", "awaiting", "partial", "passed",
    ]);
  });

  it("normalizeB2Stage falls back to not_started on junk", () => {
    expect(normalizeB2Stage("booked")).toBe("booked");
    expect(normalizeB2Stage("garbage")).toBe("not_started");
    expect(normalizeB2Stage(null)).toBe("not_started");
    expect(normalizeB2Stage(undefined)).toBe("not_started");
  });

  it("isB2Stage validates", () => {
    expect(isB2Stage("partial")).toBe(true);
    expect(isB2Stage("nope")).toBe(false);
  });

  it("isB2Passed only at passed", () => {
    expect(isB2Passed("passed")).toBe(true);
    expect(isB2Passed("awaiting")).toBe(false);
    expect(isB2Passed("partial")).toBe(false);
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

  it("effectiveB2Stage: approved cert → passed; pending cert → awaiting; else stored", () => {
    // Approved B2 cert overrides a not_started field.
    expect(effectiveB2Stage("not_started", [{ file_type: "B2 Language Certificate", status: "approved" }])).toBe("passed");
    // Uploaded but pending → at least awaiting.
    expect(effectiveB2Stage("not_started", [{ file_type: "Certificat de langue B2", status: "pending" }])).toBe("awaiting");
    // No cert → keep the stored stage (admin's manual call).
    expect(effectiveB2Stage("studying", [])).toBe("studying");
    // A pending cert never downgrades a further-along stored stage.
    expect(effectiveB2Stage("partial", [{ file_type: "B2 Sprachzertifikat", status: "pending" }])).toBe("partial");
  });
});
