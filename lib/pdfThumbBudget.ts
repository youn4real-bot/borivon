/**
 * lib/pdfThumbBudget.ts — the rendering budget behind the page organiser's grid.
 *
 * The organiser is the one place in the portal that runs pdf.js on a phone
 * (every other PDF surface sends iOS to the native engine), so it is the one
 * place that has to spend memory like a phone.
 *
 * WHERE THE MEMORY ACTUALLY GOES — and it is not the thumbnails:
 *
 *  • A thumbnail is tiny. The organiser draws into a 220x300 box, so one JPEG
 *    data URL is tens of KB. Holding one per page was never the problem.
 *
 *  • THE DECODE IS THE COST. pdf.js rasterises the images inside a page at the
 *    SCAN's resolution, not at thumbnail size. A 300-dpi A4 scan is
 *    2480 x 3508 px, and pdf.js materialises image data as RGBA — 4 bytes per
 *    pixel, ~35 MB — to produce a picture 220 px wide. Drawing a SMALLER
 *    thumbnail does not make that number smaller; it only changes the size of
 *    the destination canvas. So shrinking thumbnails is a pixel-fill saving,
 *    not a memory lever, and nobody should shrink them further expecting one.
 *
 *  • Those bytes hang off the PAGE, in `page.objs`. Read in the installed
 *    pdfjs-dist 5.7.284: `PDFPageProxy.cleanup()` clears `_intentStates` and
 *    `objs`, which is where the decoded images land. Hold every page proxy and
 *    the cost SUMS down the document; release each page the moment its
 *    thumbnail is drawn and the peak becomes the worst SINGLE page instead.
 *    That is the entire memory strategy here.
 *
 *    HOW FAR THAT WAS ACTUALLY VERIFIED, because the difference matters to
 *    whoever tunes this next. The `cleanup()` behaviour is read out of the
 *    library source. The SIZE of the saving is not: an attempt to measure it
 *    in Node (six 2480x3508 pages, holding the proxies vs releasing them)
 *    moved peak RSS by 10 MB either way, because `getOperatorList()` alone
 *    does not materialise the bitmaps — the decode happens inside `render()`,
 *    against a canvas Node does not have. So the lever is real and the number
 *    behind it is unmeasured. Do not quote one.
 *
 *  • Not everything is releasable: the worker keeps a global image cache of up
 *    to 50 MB (`GlobalImageCache.MAX_BYTE_SIZE = 5e7`, same source) which
 *    `page.cleanup()` does not touch — only destroying the DOCUMENT does. It
 *    only caches images that appear on 2+ pages, so a scan (a distinct image
 *    per page) mostly escapes it, but it is the floor under every number above.
 *
 * Two consequences the organiser is built on:
 *
 *  1. PAGE COUNT IS NOT THE MEMORY RISK once each page is released — a long
 *     document costs TIME, not memory. So the answer to a long scan is to draw
 *     the pages someone is looking at, not to refuse the ones past a number.
 *
 *  2. THERE IS NO CAP ON PAGES, AND THERE MUST NOT BE. The organiser saves the
 *     order of the tiles it is showing; a tile that was never created is a page
 *     that silently disappears from the saved file. The honest cap is on WORK —
 *     how many pages are drawn before you scroll, and how big each drawing is —
 *     never on how many pages exist.
 *
 * Everything above is read out of the pdf.js source or out of pixel
 * arithmetic. Nothing here was measured on an iPhone: no iOS device was
 * available. What an iPhone adds is that it answers a refused allocation by
 * killing the tab rather than throwing something catchable, which is why the
 * budget is deliberately tighter there than the arithmetic alone requires.
 */

/** Thumbnail box in CSS px on a wide screen. */
export const THUMB_BOX = { w: 220, h: 300 } as const;
/** Phone tiles are ~150 px wide, so anything larger is pixels nobody sees. */
export const THUMB_BOX_NARROW = { w: 150, h: 200 } as const;

/** Below this viewport width the grid shows the narrow tiles. */
export const NARROW_VIEWPORT_PX = 520;

/**
 * Scale that fits a page into the thumbnail box, never upscaling.
 *
 * Guards a degenerate page: a 0-width or NaN viewport (damaged scans produce
 * them) yields an Infinity scale, and the canvas allocation that follows throws
 * — which the old organiser reported as "Could not open this PDF" for the whole
 * document, over one bad page.
 */
export function thumbScale(pageWidth: number, pageHeight: number, opts?: { narrow?: boolean }): number {
  const box = opts?.narrow ? THUMB_BOX_NARROW : THUMB_BOX;
  const w = Number.isFinite(pageWidth) && pageWidth > 0 ? pageWidth : box.w;
  const h = Number.isFinite(pageHeight) && pageHeight > 0 ? pageHeight : box.h;
  const s = Math.min(box.w / w, box.h / h, 1);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** Pages drawn before anything has been scrolled into view. */
export const EAGER_THUMBS_IOS = 4;
export const EAGER_THUMBS_DESKTOP = 12;

/**
 * How many thumbnails to draw up front; the rest wait until they scroll into
 * view. iOS gets the smaller head start — it shows about two tiles at a time,
 * and it is the platform that kills the tab instead of reporting the
 * allocation it refused.
 */
export function eagerThumbCount(numPages: number, opts: { ios: boolean }): number {
  if (!Number.isFinite(numPages) || numPages <= 0) return 0;
  return Math.min(Math.floor(numPages), opts.ios ? EAGER_THUMBS_IOS : EAGER_THUMBS_DESKTOP);
}

/**
 * Peak decoded-image bytes held at once, given each page's decoded footprint.
 *
 * `release: true` models calling `page.cleanup()` after each page — one page is
 * ever live, so the peak is the worst single page. `false` models holding them
 * all, which pays the sum. It lives here so "releasing turns a sum into a max"
 * is an asserted invariant rather than a remembered sentence.
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
