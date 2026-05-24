import { describe, it, expect } from "vitest";
import { isPassportFileType } from "../lib/passportFile";

// LAW #39 gate: every passport-serving path keys off this. If it ever stops
// matching a real passport label, passports get rotated/mutated server-side
// and a candidate's scan can be silently erased. Lock the behaviour.
describe("isPassportFileType (LAW #39 gate)", () => {
  it("matches passport labels in every UI language", () => {
    expect(isPassportFileType("Reisepass")).toBe(true); // DE
    expect(isPassportFileType("Passport")).toBe(true); // EN
    expect(isPassportFileType("Passeport")).toBe(true); // FR
  });

  it("matches the upload fileKey slug + suffixed variants", () => {
    expect(isPassportFileType("reisepass")).toBe(true);
    expect(isPassportFileType("passport_original")).toBe(true);
    expect(isPassportFileType("reisepass_uebersetzt")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isPassportFileType("REISEPASS")).toBe(true);
    expect(isPassportFileType("PassPort")).toBe(true);
  });

  it("returns false for non-passport documents", () => {
    expect(isPassportFileType("Lebenslauf")).toBe(false);
    expect(isPassportFileType("Diplom")).toBe(false);
    expect(isPassportFileType("cv_de")).toBe(false);
    expect(isPassportFileType("arbeitsvertrag")).toBe(false);
  });

  it("returns false for empty / null / undefined", () => {
    expect(isPassportFileType("")).toBe(false);
    expect(isPassportFileType(null)).toBe(false);
    expect(isPassportFileType(undefined)).toBe(false);
  });

  it("documents the substring behaviour (intentional broad match)", () => {
    // Known: it's a substring test, so 'compass' matches. No real doctype
    // label contains 'pass' spuriously, and erring toward "treat as passport"
    // is the safe side of LAW #39 (never mutate). Pinned so a future tightening
    // is a deliberate, reviewed change.
    expect(isPassportFileType("compass")).toBe(true);
  });
});
