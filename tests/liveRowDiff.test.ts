import { describe, it, expect } from "vitest";
import { changedKeys, sameJson } from "@/lib/liveRowDiff";

describe("changedKeys — only-on-change semantics for polled rows", () => {
  const KEYS = ["first_name", "passport_status", "passport_confirmed_fields", "manually_verified"] as const;

  it("an identical poll reports nothing (no re-dispatch, no overwrite of unsaved typing)", () => {
    const row = { first_name: "Amina", passport_status: "pending", passport_confirmed_fields: ["dob"], manually_verified: false };
    expect(changedKeys(row, { ...row, passport_confirmed_fields: ["dob"] }, KEYS)).toEqual([]);
  });

  it("reports exactly the columns that moved", () => {
    const a = { first_name: "Amina", passport_status: "pending", passport_confirmed_fields: ["dob"], manually_verified: false };
    const b = { ...a, passport_status: "approved", passport_confirmed_fields: ["dob", "sex"] };
    expect(changedKeys(a, b, KEYS)).toEqual(["passport_status", "passport_confirmed_fields"]);
  });

  it("null and undefined are the same (a row appearing does not flag its null columns)", () => {
    const appeared = { first_name: "Amina", passport_status: null, passport_confirmed_fields: null, manually_verified: undefined };
    expect(changedKeys({}, appeared, KEYS)).toEqual(["first_name"]);
    expect(changedKeys(null, appeared, KEYS)).toEqual(["first_name"]);
  });

  it("ignores columns outside the watched list", () => {
    expect(changedKeys({ cv_draft: 1, first_name: "a" }, { cv_draft: 2, first_name: "a" }, KEYS)).toEqual([]);
  });
});

describe("sameJson", () => {
  it("compares payloads structurally", () => {
    expect(sameJson([{ id: "1", status: "pending" }], [{ id: "1", status: "pending" }])).toBe(true);
    expect(sameJson([{ id: "1", status: "pending" }], [{ id: "1", status: "approved" }])).toBe(false);
    expect(sameJson(null, undefined)).toBe(true);
    expect(sameJson({ a: 1 }, null)).toBe(false);
  });
});
