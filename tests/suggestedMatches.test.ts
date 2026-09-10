import { describe, it, expect } from "vitest";
import { rejectExistingPairs, pairKey } from "../lib/suggestedMatches";

const CAL = "org-calmaroi";
const OTHER = "org-other";
const A = "cand-a";
const B = "cand-b";

describe("suggested matches — never propose someone the agency already has", () => {
  const rows = [
    { candidate_user_id: A, org_id: CAL },
    { candidate_user_id: B, org_id: CAL },
    { candidate_user_id: A, org_id: OTHER },
  ];

  it("drops a pairing that already exists", () => {
    const existing = new Set([pairKey(A, CAL)]);
    expect(rejectExistingPairs(rows, existing)).toEqual([
      { candidate_user_id: B, org_id: CAL },
      { candidate_user_id: A, org_id: OTHER },
    ]);
  });

  it("keeps the SAME candidate for a DIFFERENT agency", () => {
    // A being linked to Calmaroi says nothing about the other agency.
    const kept = rejectExistingPairs(rows, new Set([pairKey(A, CAL)]));
    expect(kept.some(r => r.candidate_user_id === A && r.org_id === OTHER)).toBe(true);
  });

  it("keeps everything when nothing is linked yet", () => {
    expect(rejectExistingPairs(rows, new Set())).toEqual(rows);
  });

  it("can empty the queue entirely", () => {
    const all = new Set(rows.map(r => pairKey(r.candidate_user_id, r.org_id)));
    expect(rejectExistingPairs(rows, all)).toEqual([]);
  });

  it("pairKey is candidate-and-org specific, not either alone", () => {
    expect(pairKey(A, CAL)).not.toBe(pairKey(A, OTHER));
    expect(pairKey(A, CAL)).not.toBe(pairKey(B, CAL));
    expect(pairKey(A, CAL)).toBe(pairKey(A, CAL));
  });
});
