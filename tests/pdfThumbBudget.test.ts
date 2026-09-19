import { describe, it, expect } from "vitest";
import {
  THUMB_BOX,
  THUMB_BOX_NARROW,
  EAGER_THUMBS_IOS,
  EAGER_THUMBS_DESKTOP,
  thumbScale,
  eagerThumbCount,
  peakDecodedBytes,
  createThumbQueue,
} from "../lib/pdfThumbBudget";

const MB = 1024 * 1024;

describe("thumbScale", () => {
  it("fits a page inside the box without upscaling", () => {
    // A4 at 72dpi.
    const s = thumbScale(595, 842);
    expect(595 * s).toBeLessThanOrEqual(THUMB_BOX.w + 0.001);
    expect(842 * s).toBeLessThanOrEqual(THUMB_BOX.h + 0.001);
    // A business-card-sized page must stay its own size, not be blown up.
    expect(thumbScale(100, 120)).toBe(1);
  });

  it("uses the smaller box on a phone-width screen", () => {
    const wide = thumbScale(595, 842);
    const narrow = thumbScale(595, 842, { narrow: true });
    expect(narrow).toBeLessThan(wide);
    expect(842 * narrow).toBeLessThanOrEqual(THUMB_BOX_NARROW.h + 0.001);
  });

  it("survives a degenerate page instead of producing an impossible canvas", () => {
    // A 0-width / NaN viewport comes out of damaged scans. The old inline
    // Math.min produced Infinity here, and the canvas allocation that followed
    // threw — which the organiser showed as "Could not open this PDF".
    for (const [w, h] of [[0, 842], [595, 0], [0, 0], [NaN, NaN], [-5, -5], [Infinity, 842]] as const) {
      const s = thumbScale(w, h);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the biggest page in the measured corpus inside the box", () => {
    // Largest page dimensions seen across 296 real portal PDFs.
    const s = thumbScale(2753, 3264);
    expect(2753 * s).toBeLessThanOrEqual(THUMB_BOX.w + 0.001);
    expect(3264 * s).toBeLessThanOrEqual(THUMB_BOX.h + 0.001);
  });
});

describe("eagerThumbCount", () => {
  it("gives a phone a smaller head start than a desktop", () => {
    expect(eagerThumbCount(40, { ios: true })).toBe(EAGER_THUMBS_IOS);
    expect(eagerThumbCount(40, { ios: false })).toBe(EAGER_THUMBS_DESKTOP);
    expect(EAGER_THUMBS_IOS).toBeLessThan(EAGER_THUMBS_DESKTOP);
  });

  it("never asks for more pages than the document has", () => {
    expect(eagerThumbCount(2, { ios: true })).toBe(2);
    expect(eagerThumbCount(2, { ios: false })).toBe(2);
    // The whole measured corpus (296 documents) tops out at 11 pages, so a
    // desktop draws every page of a real document up front.
    expect(eagerThumbCount(11, { ios: false })).toBe(11);
  });

  it("returns nothing for a document with no pages", () => {
    for (const n of [0, -1, NaN, Infinity]) {
      expect(eagerThumbCount(n, { ios: false })).toBe(0);
    }
  });
});

describe("peakDecodedBytes — releasing a page turns a sum into a max", () => {
  it("holds the whole document when pages are not released", () => {
    const pages = [10 * MB, 20 * MB, 30 * MB];
    expect(peakDecodedBytes(pages, { release: false })).toBe(60 * MB);
    expect(peakDecodedBytes(pages, { release: true })).toBe(30 * MB);
  });

  it("keeps the worst REAL document under 150 MB once pages are released", () => {
    // Measured 2026-09-19 over 296 portal PDFs read from R2. These are the two
    // documents that cost the most; the numbers are decoded RGBA megabytes.
    const worstSum = [59, 59, 59, 59, 59, 59].map(n => n * MB);       // 6 pages, 4.2 MB file
    const worstPage = [132.8, 4].map(n => n * MB);                    // 2 pages, 2.9 MB file

    // What the organiser used to pay: the sum, well past what a phone gives a tab.
    expect(peakDecodedBytes(worstSum, { release: false })).toBeGreaterThan(300 * MB);
    // What it pays now.
    expect(peakDecodedBytes(worstSum, { release: true })).toBeLessThan(150 * MB);
    expect(peakDecodedBytes(worstPage, { release: true })).toBeLessThan(150 * MB);

    // And the peak no longer grows with the page count — this is why the
    // organiser draws every page lazily instead of refusing pages past a cap.
    const long = Array.from({ length: 40 }, () => 34 * MB);           // p90 page, 40 of them
    expect(peakDecodedBytes(long, { release: true })).toBe(34 * MB);
    expect(peakDecodedBytes(long, { release: false })).toBeGreaterThan(1000 * MB);
  });

  it("ignores junk footprints and an empty document", () => {
    expect(peakDecodedBytes([], { release: true })).toBe(0);
    expect(peakDecodedBytes([NaN, -1, 0], { release: false })).toBe(0);
    expect(peakDecodedBytes([NaN, 5 * MB, -1], { release: true })).toBe(5 * MB);
  });
});

describe("createThumbQueue", () => {
  it("decodes exactly one page at a time", async () => {
    const q = createThumbQueue();
    let live = 0, peak = 0;
    const order: number[] = [];
    const job = (n: number) => async () => {
      live++; peak = Math.max(peak, live);
      await new Promise(r => setTimeout(r, 1));
      order.push(n);
      live--;
    };
    for (let i = 0; i < 6; i++) q.push(job(i));
    await q.idle();
    expect(peak).toBe(1);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps going after a page that will not draw", async () => {
    // The one that matters on a phone: a single page's allocation is refused.
    // It must not stop the pages after it, and must not reject the chain — the
    // window, the ordering and the save all survive a page without a picture.
    const q = createThumbQueue();
    const drawn: number[] = [];
    q.push(async () => { drawn.push(0); });
    q.push(async () => { throw new Error("canvas allocation failed"); });
    q.push(async () => { drawn.push(2); });
    await expect(q.idle()).resolves.toBeUndefined();
    expect(drawn).toEqual([0, 2]);
  });

  it("is safe to await repeatedly", async () => {
    const q = createThumbQueue();
    q.push(async () => {});
    await q.idle();
    await expect(q.idle()).resolves.toBeUndefined();
  });
});
