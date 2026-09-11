import { describe, it, expect } from "vitest";
import { parseProfileCols, parseMarkRead, ME_PROFILE_COLUMNS } from "../lib/meApiRules";

const U1 = "2b8e1c1e-1111-4222-8333-944455556666";
const U2 = "3c9f2d2f-2222-4333-9444-a55566667777";

describe("parseProfileCols", () => {
  it("accepts allowed columns, trims spaces, dedupes", () => {
    expect(parseProfileCols("first_name, last_name,first_name")).toEqual(["first_name", "last_name"]);
  });
  it("refuses any column outside the allow-list", () => {
    expect(parseProfileCols("first_name,placement_ready")).toBeNull();
    expect(parseProfileCols("*")).toBeNull();
    expect(parseProfileCols("first_name;drop table x")).toBeNull();
    expect(parseProfileCols("user_id")).toBeNull();
  });
  it("refuses empty input", () => {
    expect(parseProfileCols("")).toBeNull();
    expect(parseProfileCols(null)).toBeNull();
    expect(parseProfileCols(" , ")).toBeNull();
  });
  it("covers every column the old browser reads used", () => {
    for (const c of [
      "passport_confirmed_fields", "passport_status", "manually_verified", "payment_tier",
      "profile_photo", "cv_draft", "phone", "children_ages",
    ]) expect(ME_PROFILE_COLUMNS.has(c)).toBe(true);
  });
});

describe("parseMarkRead", () => {
  it("accepts a list of ids", () => {
    expect(parseMarkRead({ ids: [U1, U2, U1] })).toEqual({ ids: [U1, U2], action: undefined });
  });
  it("accepts 'all', optionally limited to calendar invites", () => {
    expect(parseMarkRead({ all: true })).toEqual({ action: undefined });
    expect(parseMarkRead({ all: true, action: "event_invite" })).toEqual({ action: "event_invite" });
  });
  it("refuses anything else", () => {
    expect(parseMarkRead(null)).toBeNull();
    expect(parseMarkRead({})).toBeNull();
    expect(parseMarkRead({ ids: [] })).toBeNull();
    expect(parseMarkRead({ ids: ["not-a-uuid"] })).toBeNull();
    expect(parseMarkRead({ ids: Array(101).fill(U1) })).toBeNull();
    expect(parseMarkRead({ all: true, action: "approved" })).toBeNull();
    expect(parseMarkRead({ all: "yes" })).toBeNull();
  });
});
