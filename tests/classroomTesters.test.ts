import { describe, it, expect } from "vitest";
import { isPermanentTester, PERMANENT_TESTER_USER_IDS, canSeeExperimental } from "@/lib/classroomTesters";

const SOUFIANE = "78936524-e9bd-4672-9fff-9025f7fbdb77";
const OTHER = "00000000-0000-0000-0000-000000000000";

describe("classroom permanent testers", () => {
  it("Soufiane Jalal is a permanent test candidate", () => {
    expect(PERMANENT_TESTER_USER_IDS).toContain(SOUFIANE);
    expect(isPermanentTester(SOUFIANE)).toBe(true);
  });

  it("nobody else is permanent", () => {
    expect(isPermanentTester(OTHER)).toBe(false);
    expect(isPermanentTester("")).toBe(false);
    expect(isPermanentTester(null)).toBe(false);
    expect(isPermanentTester(undefined)).toBe(false);
  });
});

describe("canSeeExperimental — the test-pair gate", () => {
  it("supreme admin always sees experimental features", () => {
    expect(canSeeExperimental("admin", null)).toBe(true);
    expect(canSeeExperimental("admin", OTHER)).toBe(true);
  });
  it("Soufiane (permanent test candidate) always sees them", () => {
    expect(canSeeExperimental("candidate", SOUFIANE)).toBe(true);
  });
  it("a normal sub-admin does NOT (only the SUPREME admin + Soufiane are the pair)", () => {
    expect(canSeeExperimental("sub_admin", OTHER)).toBe(false);
  });
  it("other candidates do NOT, unless a per-feature column flag widens it", () => {
    expect(canSeeExperimental("candidate", OTHER)).toBe(false);
    expect(canSeeExperimental("candidate", OTHER, true)).toBe(true);
  });
});
