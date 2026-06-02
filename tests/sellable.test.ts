import { describe, it, expect } from "vitest";
import { evaluateSellable, hasApprovedDiploma, hasFinalizedCv } from "../lib/sellable";

const cvDone = [{ preset_key: "cv_finalized", done: true }, { preset_key: "b2_passed", done: false }];
const cvNot  = [{ preset_key: "cv_finalized", done: false }];
const dipOK  = [{ file_type: "Nursing Diploma", status: "approved" }];

describe("hasApprovedDiploma", () => {
  it("matches any known diploma label when approved", () => {
    expect(hasApprovedDiploma([{ file_type: "Diplom", status: "approved" }])).toBe(true);
    expect(hasApprovedDiploma([{ file_type: "Diplom (DE)", status: "approved" }])).toBe(true);
    expect(hasApprovedDiploma([{ file_type: "Nursing Diploma", status: "approved" }])).toBe(true);
  });
  it("ignores a diploma that is only pending/rejected", () => {
    expect(hasApprovedDiploma([{ file_type: "Diplom", status: "pending" }])).toBe(false);
    expect(hasApprovedDiploma([{ file_type: "Diplom", status: "rejected" }])).toBe(false);
  });
  it("ignores non-diploma approved docs", () => {
    expect(hasApprovedDiploma([{ file_type: "Passport", status: "approved" }])).toBe(false);
  });
  it("handles empty / null", () => {
    expect(hasApprovedDiploma([])).toBe(false);
    expect(hasApprovedDiploma([{ file_type: null, status: "approved" }])).toBe(false);
  });
});

describe("hasFinalizedCv", () => {
  it("true only when cv_finalized is done", () => {
    expect(hasFinalizedCv(cvDone)).toBe(true);
    expect(hasFinalizedCv(cvNot)).toBe(false);
    expect(hasFinalizedCv([])).toBe(false);
  });
});

describe("evaluateSellable (the gate)", () => {
  it("sellable only when CV done AND diploma approved", () => {
    expect(evaluateSellable({ documents: dipOK, journey: cvDone })).toEqual({ sellable: true, cvDone: true, diplomaApproved: true });
  });
  it("CV done but no diploma → not sellable, surfaces the gap", () => {
    expect(evaluateSellable({ documents: [], journey: cvDone })).toEqual({ sellable: false, cvDone: true, diplomaApproved: false });
  });
  it("diploma but CV not finalized → not sellable", () => {
    expect(evaluateSellable({ documents: dipOK, journey: cvNot })).toEqual({ sellable: false, cvDone: false, diplomaApproved: true });
  });
  it("neither → not sellable", () => {
    expect(evaluateSellable({ documents: [], journey: [] })).toEqual({ sellable: false, cvDone: false, diplomaApproved: false });
  });
});
