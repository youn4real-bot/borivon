import { describe, it, expect } from "vitest";
import { isPermanentTester, PERMANENT_TESTER_USER_IDS } from "@/lib/classroomTesters";

const SOUFIANE = "78936524-e9bd-4672-9fff-9025f7fbdb77";

describe("classroom permanent testers", () => {
  it("Soufiane Jalal is a permanent test candidate", () => {
    expect(PERMANENT_TESTER_USER_IDS).toContain(SOUFIANE);
    expect(isPermanentTester(SOUFIANE)).toBe(true);
  });

  it("nobody else is permanent", () => {
    expect(isPermanentTester("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isPermanentTester("")).toBe(false);
    expect(isPermanentTester(null)).toBe(false);
    expect(isPermanentTester(undefined)).toBe(false);
  });
});
