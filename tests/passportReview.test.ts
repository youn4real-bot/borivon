import { describe, it, expect } from "vitest";
import { canApprove, filledFieldLabels, unconfirmedCount, isFilled, type PassportGroup } from "@/lib/passportReview";

// LAW #38: passport confirmation checkboxes are HUMAN-CLICK-ONLY and never
// auto-checked. The approve gate must therefore stay false until a human has
// ticked every FILLED field. These tests pin that invariant.

const groups: PassportGroup[] = [
  { title: "Personal", fields: [
    { label: "First name", value: "SANAE" },
    { label: "Last name", value: "EL JANDARI" },
    { label: "City of birth", value: "—" }, // empty → no confirmation needed
  ] },
  { title: "Passport", fields: [
    { label: "Passport No", value: "AB123456" },
    { label: "Expiry", value: "—" },
  ] },
];

describe("passport review — LAW #38 approve gate", () => {
  it("isFilled treats em-dash and blanks as empty", () => {
    expect(isFilled("SANAE")).toBe(true);
    expect(isFilled("—")).toBe(false);
    expect(isFilled("")).toBe(false);
    expect(isFilled("   ")).toBe(false);
    expect(isFilled(null)).toBe(false);
  });

  it("only the FILLED fields require confirmation", () => {
    expect(filledFieldLabels(groups).sort()).toEqual(["First name", "Last name", "Passport No"]);
  });

  it("NEVER approves from the fresh (empty) confirmed set", () => {
    expect(canApprove(groups, new Set())).toBe(false);
  });

  it("does not approve while any filled field is unconfirmed", () => {
    expect(canApprove(groups, new Set(["First name", "Last name"]))).toBe(false);
    expect(unconfirmedCount(groups, new Set(["First name", "Last name"]))).toBe(1);
  });

  it("approves only once every filled field is human-confirmed", () => {
    const all = new Set(["First name", "Last name", "Passport No"]);
    expect(canApprove(groups, all)).toBe(true);
    expect(unconfirmedCount(groups, all)).toBe(0);
  });

  it("confirming an empty field does not unlock approval on its own", () => {
    // Ticking only the empty field's label (shouldn't happen via UI) never
    // satisfies the gate — the filled ones still must be confirmed.
    expect(canApprove(groups, new Set(["City of birth", "Expiry"]))).toBe(false);
  });

  it("a profile with NO filled fields can never be approved", () => {
    const empty: PassportGroup[] = [{ title: "Personal", fields: [{ label: "First name", value: "—" }] }];
    expect(canApprove(empty, new Set(["First name"]))).toBe(false);
  });
});
