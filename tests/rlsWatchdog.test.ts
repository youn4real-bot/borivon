import { describe, it, expect } from "vitest";
import { classifyProbes, totalFromContentRange, SENSITIVE_TABLES } from "@/lib/rlsWatchdog";

/**
 * The watchdog that would have caught the candidate_profiles passport leak on
 * day one. A table "leaks" when the anonymous key gets actual rows back.
 */
describe("classifyProbes", () => {
  it("flags a table the anon key can read rows from", () => {
    const { leaks } = classifyProbes([{ table: "candidate_profiles", rows: 78, status: 206 }]);
    expect(leaks).toEqual([{ table: "candidate_profiles", rows: 78 }]);
  });

  it("does NOT flag an RLS-protected table that returns empty", () => {
    // Every locked table comes back rows:0 (empty array) — that is the safe state.
    const { leaks, errored } = classifyProbes([{ table: "documents", rows: 0, status: 200 }]);
    expect(leaks).toEqual([]);
    expect(errored).toEqual([]);
  });

  it("does NOT flag a table whose grant was revoked (permission denied)", () => {
    // After the fix, candidate_profiles returns 401 → the probe records rows:0.
    const { leaks } = classifyProbes([{ table: "candidate_profiles", rows: 0, status: 401 }]);
    expect(leaks).toEqual([]);
  });

  it("surfaces an unreadable probe as errored, never as a false all-clear", () => {
    // A probe that couldn't determine the count (network/5xx) is rows:null. We
    // must NOT treat that as safe — but also must not cry leak.
    const { leaks, errored } = classifyProbes([{ table: "messages", rows: null, status: 0 }]);
    expect(leaks).toEqual([]);
    expect(errored).toEqual(["messages"]);
  });

  it("separates leaks from safe from errored in one mixed batch", () => {
    const { leaks, errored } = classifyProbes([
      { table: "candidate_profiles", rows: 78, status: 206 },
      { table: "documents", rows: 0, status: 200 },
      { table: "leads", rows: 3, status: 206 },
      { table: "messages", rows: null, status: 500 },
    ]);
    expect(leaks.map((l) => l.table).sort()).toEqual(["candidate_profiles", "leads"]);
    expect(errored).toEqual(["messages"]);
  });
});

describe("totalFromContentRange", () => {
  it("reads the total after the slash", () => {
    expect(totalFromContentRange("0-0/78")).toBe(78);
    expect(totalFromContentRange("0-4/78")).toBe(78);
  });
  it("returns null for an unknown total or missing header", () => {
    expect(totalFromContentRange("*/*")).toBeNull();
    expect(totalFromContentRange(null)).toBeNull();
    expect(totalFromContentRange("")).toBeNull();
  });
});

describe("SENSITIVE_TABLES", () => {
  it("covers the crown jewels", () => {
    for (const t of ["candidate_profiles", "documents", "partner_api_keys", "messages", "leads"]) {
      expect(SENSITIVE_TABLES).toContain(t);
    }
  });
  it("has no duplicates", () => {
    expect(new Set(SENSITIVE_TABLES).size).toBe(SENSITIVE_TABLES.length);
  });
});
