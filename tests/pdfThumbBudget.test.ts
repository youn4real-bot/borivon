import { describe, it, expect } from "vitest";
import {
  THUMB_BOX, THUMB_BOX_NARROW, EAGER_THUMBS_IOS, EAGER_THUMBS_DESKTOP,
  thumbScale, eagerThumbCount, peakDecodedBytes, createThumbQueue,
} from "@/lib/pdfThumbBudget";

describe("thumbScale", () => {
  it("fits a page into the box without upscaling it", () => {
    const s = thumbScale(595, 842);                       // A4 at 72 dpi
    expect(Math.round(595 * s)).toBeLessThanOrEqual(THUMB_BOX.w);
    expect(Math.round(842 * s)).toBeLessThanOrEqual(THUMB_BOX.h);
    expect(thumbScale(50, 50)).toBe(1);                   // never blown up
  });

  it("uses the narrow box on a phone", () => {
    const wide = thumbScale(595, 842);
    const narrow = thumbScale(595, 842, { narrow: true });
    expect(narrow).toBeLessThan(wide);
    expect(Math.round(842 * narrow)).toBeLessThanOrEqual(THUMB_BOX_NARROW.h);
  });

  it("never returns Infinity or 0 for a damaged page", () => {
    // A 0-width or NaN viewport comes out of damaged scans. An Infinity scale
    // makes the canvas allocation throw, which the old organiser reported as
    // "Could not open this PDF" for the whole document over one bad page.
    for (const [w, h] of [[0, 842], [595, 0], [NaN, 842], [595, Infinity], [-3, -3]]) {
      const s = thumbScale(w, h);
      expect(Number.isFinite(s), `${w}x${h}`).toBe(true);
      expect(s, `${w}x${h}`).toBeGreaterThan(0);
    }
  });
});

describe("eagerThumbCount", () => {
  it("gives a phone a smaller head start than a desktop", () => {
    expect(eagerThumbCount(40, { ios: true })).toBe(EAGER_THUMBS_IOS);
    expect(eagerThumbCount(40, { ios: false })).toBe(EAGER_THUMBS_DESKTOP);
    expect(EAGER_THUMBS_IOS).toBeLessThan(EAGER_THUMBS_DESKTOP);
  });

  it("never promises more pages than the document has", () => {
    expect(eagerThumbCount(2, { ios: false })).toBe(2);
    expect(eagerThumbCount(0, { ios: false })).toBe(0);
    expect(eagerThumbCount(NaN, { ios: true })).toBe(0);
    expect(eagerThumbCount(-5, { ios: true })).toBe(0);
  });

  it("is a cap on WORK, never on pages", () => {
    // The save posts the order of the tiles on screen, so a page without a tile
    // would silently disappear from the saved file. Whatever this returns, the
    // grid still lists every page — the head start only decides how many are
    // DRAWN before someone scrolls.
    expect(eagerThumbCount(60, { ios: true })).toBeLessThan(60);
  });
});

describe("peakDecodedBytes", () => {
  it("releasing each page turns the sum into a max", () => {
    // This is the whole memory strategy. pdf.js hangs a page's decoded images
    // off page.objs, and PDFPageProxy.cleanup() clears them; hold every page
    // and the cost sums down the document instead.
    const perPage = [35_000_000, 12_000_000, 133_000_000, 8_000_000];
    expect(peakDecodedBytes(perPage, { release: true })).toBe(133_000_000);
    expect(peakDecodedBytes(perPage, { release: false })).toBe(188_000_000);
  });

  it("is page-count-blind once pages are released", () => {
    const one = [40_000_000];
    const many = Array.from({ length: 50 }, () => 40_000_000);
    expect(peakDecodedBytes(many, { release: true })).toBe(peakDecodedBytes(one, { release: true }));
    expect(peakDecodedBytes(many, { release: false })).toBeGreaterThan(peakDecodedBytes(one, { release: false }));
  });

  it("ignores junk measurements", () => {
    expect(peakDecodedBytes([], { release: true })).toBe(0);
    expect(peakDecodedBytes([NaN, -1, 0], { release: false })).toBe(0);
  });
});

describe("createThumbQueue", () => {
  it("runs one job at a time, in order", async () => {
    const q = createThumbQueue();
    const log: string[] = [];
    let live = 0, maxLive = 0;
    const job = (name: string) => async () => {
      live++; maxLive = Math.max(maxLive, live);
      await new Promise(r => setTimeout(r, 5));
      log.push(name); live--;
    };
    q.push(job("a")); q.push(job("b")); q.push(job("c"));
    await q.idle();
    expect(log).toEqual(["a", "b", "c"]);
    expect(maxLive).toBe(1);        // never two decodes in flight on a phone
  });

  it("keeps a failing page local — the rest still draw", async () => {
    // The worst single page in a scan can want more memory than a phone will
    // give. That page loses its picture; the window, the ordering and the save
    // must survive it.
    const q = createThumbQueue();
    const drawn: number[] = [];
    q.push(async () => { drawn.push(1); });
    q.push(async () => { throw new RangeError("Array buffer allocation failed"); });
    q.push(async () => { drawn.push(3); });
    await expect(q.idle()).resolves.toBeUndefined();
    expect(drawn).toEqual([1, 3]);
  });
});
