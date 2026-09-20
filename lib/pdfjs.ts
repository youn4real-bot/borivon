/**
 * lib/pdfjs.ts — SINGLE source of truth for loading pdf.js in this app.
 *
 * EVERY pdf.js consumer MUST get the library from `loadPdfjs()` and open
 * documents through `pdfLoadOptions(src)`, so neither the BUILD choice nor the
 * critical render options can be forgotten by the next viewer:
 *
 *     const pdfjsLib = await loadPdfjs();
 *     const task = pdfjsLib.getDocument(pdfLoadOptions(src));
 *
 * Why each option matters (all are FALLBACK/decoder config — they never change
 * a PDF that already renders, they only rescue ones that otherwise break):
 *
 *  • wasmUrl  — MANDATORY on pdf.js v5+. CCITTFax / JBIG2 / JPEG2000 images are
 *    decoded by a WebAssembly module; without `wasmUrl` pdf.js silently DROPS
 *    those images. Some official forms (the German "EzB" / Zusatzblatt agency
 *    forms) are built ENTIRELY from CCITTFax 1-bit image masks, so with no
 *    wasmUrl the whole page renders blank/faint. This was a real production bug.
 *  • cMapUrl + standardFontDataUrl — render NON-EMBEDDED standard/CID fonts
 *    (otherwise glyphs vanish on some scanned forms).
 *  • useSystemFonts:false — use the bundled standard fonts for consistency
 *    across machines instead of guessing a local system font.
 *  • isOffscreenCanvasSupported:false — render on the main-thread canvas; the
 *    worker OffscreenCanvas path drops glyphs/images on some browsers.
 *
 * The referenced asset folders live under /public/pdfjs/{wasm,cmaps,
 * standard_fonts} and are re-copied from node_modules/pdfjs-dist on every
 * install (scripts/copy-pdfjs-assets.mjs, wired to `postinstall`), so they can
 * never drift from the installed version. They are shared by both builds below.
 */

// ─────────────────────────────────────────────────────────────────────────────
// WHICH BUILD — always `legacy/`, never `pdfjs-dist` (the default entry).
//
// This is the fix for "Could not open this PDF." on an iPhone. Read out of the
// INSTALLED pdfjs-dist 5.7.284 source on 2026-09-19, not remembered:
//
//   build/pdf.mjs          uses `Promise.withResolvers()` 26 times and
//                          polyfills none of them.
//   legacy/build/pdf.mjs   uses it 30 times and compiles in core-js's
//                          `es.promise.with-resolvers`.
//
// The first use on the open path is a CLASS FIELD:
//
//     class PDFDocumentLoadingTask {
//       _capability = Promise.withResolvers();   // runs in the constructor
//
// `getDocument()` constructs that task before it touches a single byte of the
// PDF. `Promise.withResolvers` landed in Safari 17.4, so on any iPhone below
// iOS 17.4 the default build throws `TypeError: Promise.withResolvers is not a
// function` immediately — one throw, no detail, nothing in the network log.
// That is exactly the report: a file that opens on every desktop and answers
// "Could not open this PDF." on a phone.
//
// Nothing else in the portal caught it, because THE PAGE ORGANISER IS THE ONLY
// SURFACE THAT RUNS pdf.js ON A PHONE — every other PDF view sends iOS to the
// native engine (isIOSDevice -> IosPdfFrame) and never loads this library there.
//
// The worker code MUST come from the same build: a legacy main thread paired
// with the default worker puts the un-polyfilled APIs straight back into the
// worker, where the failure is even harder to see.
//
// Cost: ~60 KB more on a chunk that is lazily loaded anyway.
// ─────────────────────────────────────────────────────────────────────────────

/** Where the pdf.js worker code runs in this browser. */
export type PdfWorkerPlan = "module-worker" | "main-thread";

/**
 * Decide where pdf.js parses the document. Pure on purpose — the case that
 * matters (an old iPhone) is the one no machine here has.
 *
 * "main-thread" means we hand pdf.js the worker code ourselves by putting the
 * imported worker module on `globalThis.pdfjsWorker`. `PDFWorker.#initialize()`
 * checks exactly that before anything else and then uses it directly
 * (`#setupFakeWorker` -> `_setupFakeWorkerGlobal`), so no worker URL is ever
 * resolved, fetched or MIME-checked. Parsing happens on the UI thread instead:
 * slower, never broken.
 *
 * WHY `URL.parse` DECIDES IT. From the installed source, pdf.js's own worker
 * setup is:
 *
 *     this._isSameOrigin = (baseUrl, otherUrl) => {
 *       const base = URL.parse(baseUrl);          // static URL.parse
 *       ...
 *     };
 *     try {
 *       if (!PDFWorker._isSameOrigin(window.location, workerSrc)) { ... }
 *       const worker = new Worker(workerSrc, { type: "module" });
 *       ...
 *     } catch { info("The worker has been disabled."); }
 *     this.#setupFakeWorker();
 *
 * `URL.parse` shipped in Safari 18. On iOS 17 it is undefined, so that call
 * THROWS inside the try and pdf.js drops to the main thread by itself — we are
 * not overriding its judgement, we are taking the same branch deliberately.
 *
 * The reason to take it deliberately: pdf.js's own recovery is
 * `await import(this.workerSrc)` on the bundler-emitted asset URL, and it
 * stores that promise through `shadow()`. If that import fails once (404, MIME,
 * CSP — none of which is reproducible off an iPhone) the REJECTED promise is
 * cached for the whole page load and every later attempt fails identically.
 * Importing the module ourselves goes through the app's own chunk loader, which
 * that phone has already used to render the page it is looking at.
 *
 * ONE THING THE MAIN THREAD NEEDS THAT A WORKER DOES NOT: `structuredClone`.
 * With no real worker there is no `postMessage`, so pdf.js copies every message
 * through `LoopbackPort`, which calls `structuredClone` directly (read in the
 * source). core-js does not polyfill it — it is a DOM API, not a language
 * feature — so the legacy build does not bring it. It landed in Safari 15.4.
 * On an older phone neither plan can work (pdf.js's own fallback lands in the
 * same LoopbackPort), so this is never a choice between working and broken; it
 * is recorded in the console diagnostic instead of pretending otherwise.
 */
export function planPdfWorker(env: {
  /** `typeof Worker === "function"` in this browser. */
  hasWorker: boolean;
  /** `typeof URL.parse === "function"` — Safari 18+, Chrome 126+. */
  urlParse: boolean;
}): PdfWorkerPlan {
  if (!env.hasWorker) return "main-thread";
  // pdf.js would throw in its own same-origin check and fake-worker anyway.
  if (!env.urlParse) return "main-thread";
  return "module-worker";
}

/** What `loadPdfjs()` decided, plus the facts behind it — for error logs. */
export type PdfEngineDiagnostic = {
  plan: PdfWorkerPlan;
  /** False on Safari below 15.4, where the main-thread plan cannot work. */
  structuredClone: boolean;
};

let lastDiagnostic: PdfEngineDiagnostic | null = null;

/**
 * The engine decision the last `loadPdfjs()` took. Printed with any organiser
 * failure: it is the difference between "this phone is old" and "this file is
 * broken", and it is the only part of that a forwarded screenshot preserves.
 */
export function currentPdfEngine(): PdfEngineDiagnostic | null {
  return lastDiagnostic;
}

/**
 * Load pdf.js ready to open a document: always the legacy build, with the
 * parser wherever `planPdfWorker` says this browser can actually run it.
 *
 * THIS CAN REJECT, AND EVERY CALLER MUST HANDLE IT. The two `import()` calls
 * below are network fetches of lazily-emitted chunks: on the mobile data these
 * candidates are on, one of them drops often enough to matter. PdfViewer used
 * to write `loadPdfjs().then(…)` with no `.catch`, so the rejection landed
 * nowhere, `setLoading(false)` was never reached, and the modal sat on its
 * spinner until the window was closed — one of the two "endless spinner"
 * reports, and invisible in every log because nothing threw anywhere a handler
 * could see it.
 *
 * A rejection here is the ENGINE layer, never the document's fault: pass it to
 * `classifyPdfOpenFailure` (lib/pdfOpenFailure) with stage "engine", or to
 * `classifyOpenError` (lib/documentFetch) where that is what the caller uses.
 * Either keeps a missing `Promise.withResolvers` or a dead chunk apart from a
 * corrupt PDF.
 */
export async function loadPdfjs() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const plan = planPdfWorker({
    hasWorker: typeof Worker === "function",
    urlParse: typeof URL !== "undefined" && typeof URL.parse === "function",
  });
  lastDiagnostic = { plan, structuredClone: typeof structuredClone === "function" };

  if (plan === "main-thread") {
    // `globalThis.pdfjsWorker` is the hook pdf.js checks FIRST, so setting it
    // means no worker URL is ever resolved. Dynamic import so the worker bundle
    // stays its own chunk and costs nothing on the browsers that never take
    // this branch.
    const holder = globalThis as unknown as { pdfjsWorker?: unknown };
    if (!holder.pdfjsWorker) {
      holder.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
    }
  } else if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }

  return pdfjsLib;
}

/** REQUIRED pdf.js `getDocument` options for this app. Pass straight in. */
export function pdfLoadOptions(src: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return {
    url: src,
    cMapUrl: `${origin}/pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${origin}/pdfjs/standard_fonts/`,
    wasmUrl: `${origin}/pdfjs/wasm/`,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
  };
}
