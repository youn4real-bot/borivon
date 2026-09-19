/**
 * lib/pdfThumbBudget.ts — the memory budget behind the page organiser's grid.
 *
 * MEASURED 2026-09-19 against 296 real portal PDFs read out of R2 (nothing kept
 * but page counts, byte sizes and decoded-pixel counts):
 *
 *  • The thumbnails are free. Every page kept as a JPEG data URL costs 21 KB at
 *    the median and 129 KB at the worst document in the corpus. Holding all of
 *    them was never the problem.
 *
 *  • The DECODE is the entire cost. pdf.js rasterises a page from the scan
 *    inside it at the SCAN's resolution, not at thumbnail size — so a two-page
 *    300-dpi colour scan materialises ~246 MB of RGBA to produce two pictures
 *    220 px wide. Doubling the thumbnail box moved peak memory by 1%
 *    (284.7 MB → 288.7 MB, measured): drawing smaller thumbnails is NOT a lever,
 *    and nobody should shrink them further expecting to buy memory with it.
 *
 *  • Holding every page proxy SUMS that cost down the document: p90 97 MB,
 *    p95 246 MB, worst 354 MB, with 8% of real documents over 150 MB. Releasing
 *    each page the moment it is drawn turns the sum into a max: p90 34 MB,
 *    p95 123 MB, worst 133 MB, and nothing over 150 MB. Node RSS agreed on the
 *    worst file in the corpus: 284.7 MB → 63.8 MB.
 *
 * Two consequences the organiser is built on:
 *
 *  1. PAGE COUNT IS NOT THE RISK. Once each page is released the peak no longer
 *     depends on how many there are; candidate uploads are capped per box at 10
 *     pages anyway (lib/pdfPageLimits) and the corpus tops out at 11. A long
 *     document costs TIME, not memory — measured 2.8 s median and 20.8 s worst
 *     on a desktop CPU for ≤6 pages, and a phone is several times slower. So the
 *     answer to a long document is to draw the pages someone is looking at, not
 *     to refuse the ones past a number.
 *
 *  2. ONE PAGE CAN STILL BE HUGE. The worst single page in the corpus wants
 *     133 MB on its own, and iOS answers a spike like that by killing the tab
 *     rather than throwing something catchable. Nothing here can shrink that
 *     page — so the organiser decodes as few of them as it can get away with,
 *     and survives the one that fails.
 *
 * Not everything is releasable: pdf.js keeps a worker-global image cache of up
 * to 50 MB (GlobalImageCache.MAX_BYTE_SIZE in pdfjs-dist 5.7.284) that
 * page.cleanup() does not touch — only destroying the document does. It caches
 * images used on 2+ pages, so a scan (a distinct image per page) mostly escapes
 * it, but it is the floor under every number above.
 */

/** Thumbnail box in CSS px. Wide screens; see THUMB_BOX_NARROW for phones. */
export const THUMB_BOX = { w: 220, h: 300 } as const;
/** Phone tiles are ~150 px wide, so anything larger is pixels nobody sees. */
export const THUMB_BOX_NARROW = { w: 150, h: 200 } as const;

/**
 * Scale that fits a page into the thumbnail box, never upscaling.
 *
 * Guards a degenerate page: a 0-width or NaN viewport (damaged scans produce
 * them) used to yield an Infinity scale and a canvas allocation that threw —
 * reported to the user as "Could not open this PDF", for one bad page.
 */
export function thumbScale(pageWidth: number, pageHeight: number, opts?: { narrow?: boolean }): number {
  const box = opts?.narrow ? THUMB_BOX_NARROW : THUMB_BOX;
  const w = Number.isFinite(pageWidth) && pageWidth > 0 ? pageWidth : box.w;
  const h = Number.isFinite(pageHeight) && pageHeight > 0 ? pageHeight : box.h;
  const s = Math.min(box.w / w, box.h / h, 1);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** Pages drawn before anything has scrolled into view. */
export const EAGER_THUMBS_IOS = 4;
export const EAGER_THUMBS_DESKTOP = 12;

/**
 * How many thumbnails to draw up front; the rest wait until they are scrolled
 * into view. iOS gets the smaller head start — it shows about two tiles at a
 * time, and it is the platform that kills the tab instead of reporting an error.
 */
export function eagerThumbCount(numPages: number, opts: { ios: boolean }): number {
  if (!Number.isFinite(numPages) || numPages <= 0) return 0;
  return Math.min(Math.floor(numPages), opts.ios ? EAGER_THUMBS_IOS : EAGER_THUMBS_DESKTOP);
}

/**
 * Peak decoded-image bytes held at once, given each page's decoded footprint.
 *
 * `release: true` models calling page.cleanup() after each page — one page is
 * ever live, so the peak is the worst single page. `false` models holding them
 * all, which pays the sum. This is the model the corpus figures in the header
 * were computed with; it lives here so "releasing turns a sum into a max" is an
 * asserted invariant rather than a remembered one.
 */
export function peakDecodedBytes(perPageBytes: readonly number[], opts: { release: boolean }): number {
  const clean = perPageBytes.filter(n => Number.isFinite(n) && n > 0);
  if (clean.length === 0) return 0;
  return opts.release ? Math.max(...clean) : clean.reduce((a, b) => a + b, 0);
}

/**
 * A single-flight queue: each job finishes before the next starts, so exactly
 * one page is ever being decoded no matter how many tiles scroll into view at
 * once. A job that throws does not break the chain — one page that will not
 * draw must not stop the others, and must not take the window down with it.
 */
export function createThumbQueue() {
  let tail: Promise<void> = Promise.resolve();
  return {
    push(job: () => Promise<void>): Promise<void> {
      tail = tail.then(() => job().catch(() => { /* per-page failure stays local */ }));
      return tail;
    },
    /** Resolves once everything queued so far has finished. */
    idle(): Promise<void> {
      return tail;
    },
  };
}
