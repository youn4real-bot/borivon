import { describe, it, expect } from "vitest";
import { deriveImpfungStage, doseProgress, normalizeReq, reqRequiresImpfung, NO_REQ } from "../lib/impfungJourney";

const REQ = { masern: 2, varizell: 2 };
const dose = (got: boolean, expected: string | null = null) => ({ got, done_date: got ? "2026-01-01" : null, expected_date: expected });

describe("normalizeReq", () => {
  it("coerces + clamps, treats junk as none", () => {
    expect(normalizeReq({ masern: 2, varizell: 1 })).toEqual({ masern: 2, varizell: 1 });
    expect(normalizeReq({ masern: "3" })).toEqual({ masern: 3, varizell: 0 });
    expect(normalizeReq(null)).toEqual(NO_REQ);
    expect(normalizeReq({ masern: -1, varizell: 99 })).toEqual({ masern: 0, varizell: 5 });
  });
  it("reqRequiresImpfung", () => {
    expect(reqRequiresImpfung({ masern: 0, varizell: 0 })).toBe(false);
    expect(reqRequiresImpfung({ masern: 1, varizell: 0 })).toBe(true);
  });
});

describe("deriveImpfungStage", () => {
  it("no requirement → not_required (off the track)", () => {
    expect(deriveImpfungStage(NO_REQ, {}, null)).toBe("not_required");
  });
  it("required but nothing entered → not_started", () => {
    expect(deriveImpfungStage(REQ, {}, null)).toBe("not_started");
  });
  it("a dose has an expected date, none received → appointment", () => {
    expect(deriveImpfungStage(REQ, { masern: { doses: [dose(false, "2026-07-01")] } }, null)).toBe("appointment");
  });
  it("some doses received, not all → in_progress", () => {
    expect(deriveImpfungStage(REQ, { masern: { doses: [dose(true), dose(false)] }, varizell: { doses: [] } }, null)).toBe("in_progress");
  });
  it("all required doses received → doses_done", () => {
    const v = { masern: { doses: [dose(true), dose(true)] }, varizell: { doses: [dose(true), dose(true)] } };
    expect(deriveImpfungStage(REQ, v, null)).toBe("doses_done");
  });
  it("cert pending → submitted; cert approved → accepted (trumps doses)", () => {
    expect(deriveImpfungStage(REQ, {}, "pending")).toBe("submitted");
    expect(deriveImpfungStage(REQ, {}, "approved")).toBe("accepted");
  });
  it("doseProgress counts only required vaccines", () => {
    const v = { masern: { doses: [dose(true), dose(true)] }, varizell: { doses: [dose(true)] } };
    expect(doseProgress(REQ, v)).toEqual({ got: 3, need: 4 });
    // varizell not required → its doses don't count
    expect(doseProgress({ masern: 2, varizell: 0 }, v)).toEqual({ got: 2, need: 2 });
  });
});
