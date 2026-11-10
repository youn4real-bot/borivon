/** The stations of the way: the one to work on now is the first not complete. */
import { describe, it, expect } from "vitest";
import { wegNow } from "../lib/facility/weg";
import { SETTLE, SETTLE_IDS } from "../lib/facility/settle";

describe("the way's stations", () => {
  it("now = first station not complete; the last once all are", () => {
    expect(wegNow({})).toBe("visa");
    expect(wegNow({ visa: [6, 6], move: [2, 7], weeks: [0, 7], six: [0, 15] })).toBe("move");
    expect(wegNow({ visa: [6, 6], move: [7, 7], weeks: [7, 7], six: [3, 15] })).toBe("six");
    expect(wegNow({ visa: [6, 6], move: [7, 7], weeks: [7, 7], six: [15, 15] })).toBe("six");
  });
  it("the six months: unique ids, every phase dated after the one before", () => {
    expect(SETTLE_IDS.size).toBe(SETTLE.flatMap((b) => b.items).length);
    for (let i = 1; i < SETTLE.length; i++) expect(SETTLE[i].at).toBeGreaterThan(SETTLE[i - 1].at);
  });
});
