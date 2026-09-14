import { describe, it, expect } from "vitest";
import { changedKeys, sameJson, planLiveRowStep } from "@/lib/liveRowDiff";

describe("planLiveRowStep — the dashboard's live passport/profile poll", () => {
  const cols = (defer: boolean) => ({ always: ["passport_status", "manually_verified"], deferrable: ["first_name", "passport_confirmed_fields"], defer });
  const base = { passport_status: null, manually_verified: false, first_name: "Amina", passport_confirmed_fields: [] };

  it("the first read is a baseline: nothing applied (no re-fired celebration on mount)", () => {
    const step = planLiveRowStep(null, { ...base, manually_verified: true }, cols(false));
    expect([...step.apply]).toEqual([]);
    expect(step.next.manually_verified).toBe(true);
  });

  it("an unchanged poll applies nothing", () => {
    const step = planLiveRowStep(base, { ...base, passport_confirmed_fields: [] }, cols(false));
    expect(step.apply.size).toBe(0);
  });

  it("admin-driven columns apply even while the candidate is typing", () => {
    const step = planLiveRowStep(base, { ...base, passport_status: "approved", first_name: "Amina B" }, cols(true));
    expect([...step.apply]).toEqual(["passport_status"]);
  });

  it("a field change held back while typing is applied on the next quiet poll, not lost", () => {
    const moved = { ...base, first_name: "Amina B", passport_confirmed_fields: ["dob"] };
    const busy = planLiveRowStep(base, moved, cols(true));
    expect(busy.apply.size).toBe(0);
    expect(busy.next.first_name).toBe("Amina");        // snapshot NOT advanced
    const quiet = planLiveRowStep(busy.next, moved, cols(false));
    expect([...quiet.apply].sort()).toEqual(["first_name", "passport_confirmed_fields"]);
    const after = planLiveRowStep(quiet.next, moved, cols(false));
    expect(after.apply.size).toBe(0);                  // applied once, not every tick
  });

  it("an admin change applied during typing is not re-applied on the quiet poll", () => {
    const moved = { ...base, passport_status: "rejected" };
    const busy = planLiveRowStep(base, moved, cols(true));
    expect([...busy.apply]).toEqual(["passport_status"]);
    expect(planLiveRowStep(busy.next, moved, cols(false)).apply.size).toBe(0);
  });
});

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
