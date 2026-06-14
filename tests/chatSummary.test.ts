import { describe, it, expect } from "vitest";
import { foldBoundary } from "../lib/assistantChatHistory";

// foldBoundary decides how many of the OLDEST tail turns get folded into the
// rolling summary. The watermark is timestamp-based and user+assistant turns are
// inserted together with the SAME created_at, so the boundary must NEVER land in
// the middle of a same-timestamp group — otherwise the un-folded sibling is
// orphaned (excluded from both the summary and the future tail). Pinned here.

const ts = (xs: number[]) => xs.map(String);

describe("foldBoundary — nothing to fold until past `keep`", () => {
  it("folds 0 when tail length <= keep", () => {
    expect(foldBoundary(ts([1, 2, 3]), 25)).toBe(0);
    expect(foldBoundary([], 25)).toBe(0);
    expect(foldBoundary(ts([1, 2, 3, 4, 5]), 5)).toBe(0);
  });
});

describe("foldBoundary — folds the oldest, keeps ~`keep` recent", () => {
  it("with all-distinct timestamps, folds exactly n-keep", () => {
    const stamps = ts(Array.from({ length: 10 }, (_, i) => i)); // 0..9
    expect(foldBoundary(stamps, 4)).toBe(6); // keep last 4 (indices 6..9)
  });
});

describe("foldBoundary — never splits a same-timestamp pair", () => {
  it("extends the fold forward past a pair straddling the boundary", () => {
    // pairs share a timestamp: [a,a, b,b, c,c, d,d] (n=8). keep=3 → cut=5, but
    // index5 ('c') shares ts with index4 ('c') → extend to 6 so 'c,c' both fold.
    const stamps = ts([1, 1, 2, 2, 3, 3, 4, 4]);
    const fold = foldBoundary(stamps, 3);
    expect(fold).toBe(6); // folds 1,1,2,2,3,3 ; keeps 4,4
    // the kept turns must all be strictly newer than the watermark (last folded)
    const watermark = stamps[fold - 1];
    expect(stamps.slice(fold).every((t) => t > watermark)).toBe(true);
  });

  it("leaves no orphaned sibling at the boundary timestamp", () => {
    const stamps = ts([10, 10, 20, 20, 30, 30]); // 3 pairs
    const fold = foldBoundary(stamps, 2); // keep ~2 → cut=4 (30 vs 30 share) → 6? no
    // cut starts at 6-2=4; stamps[4]=30 === stamps[3]=20? no → boundary clean at 4
    expect(fold).toBe(4); // fold 10,10,20,20 ; keep 30,30
    const watermark = stamps[fold - 1];
    expect(stamps.slice(fold).every((t) => t > watermark)).toBe(true);
  });
});
