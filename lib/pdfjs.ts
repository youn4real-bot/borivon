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
// This was the fix for "Could not open this PDF." on an iPhone (2026-09-19).
// The first use of `Promise.withResolvers()` on the open path is a CLASS FIELD:
//
//     class PDFDocumentLoadingTask {
//       _capability = Promise.withResolvers();   // runs in the constructor
//
// `getDocument()` constructs that task before it touches a single byte of the
// PDF. `Promise.withResolvers` landed in Safari 17.4, so on any iPhone below
// iOS 17.4 it throws `TypeError: Promise.withResolvers is not a function`
// immediately — one throw, no detail, nothing in the network log.
//
// pdfjs-dist 5.7.284's legacy build compiled in core-js's polyfill for it.
// pdfjs-dist 6 DOES NOT: 6.0 raised the legacy build's floor from Safari 16.4
// to Safari 18 (PR #21152), and every API Safari 18 has natively left the
// bundle — `Promise.withResolvers` and `ArrayBuffer.transferToFixedLength`
// among them. Read out of the INSTALLED 6.4.299 source, not remembered. The
// legacy build is still the right one (it keeps the other 30-odd core-js
// polyfills — Iterator helpers, Uint8Array base64, Map.getOrInsert…), but it
// is no longer enough on its own: lib/pdfjsPolyfills.ts puts the missing two
// back, and planPdfWorker below keeps any browser that needs them off a real
// Worker, where those polyfills cannot reach.
//
// It is NOT only the page organiser that runs pdf.js on a phone. Most PDF
// views send iOS to the native engine (isIOSDevice -> IosPdfFrame), but
// PdfSignModal, PdfZonePicker, PdfFieldFill, PdfNativeFieldFill and
// AutoFillReviewModal mount PdfViewer with no iOS gate — a candidate signing a
// form on her iPhone runs this library.
//
// The worker code MUST come from the same build: a legacy main thread paired
// with the default worker puts un-polyfilled APIs straight back into the
// worker, where the failure is even harder to see.
// ─────────────────────────────────────────────────────────────────────────────

import { installPdfjsPolyfills, type PdfjsPolyfilledApi } from "@/lib/pdfjsPolyfills";

/** Where the pdf.js worker code runs in this browser. */
export type PdfWorkerPlan = "module-worker" | "main-thread";

/**
 * What this browser has NATIVELY. Read BEFORE installPdfjsPolyfills runs (and
 * before pdf.js is imported, whose core-js defines more globals), because the
 * polyfills define the very functions being asked about. Afterwards "native or
 * polyfilled?" cannot be told apart. `readPdfPlatform()` is the only reader.
 */
export type PdfPlatform = {
  /** `typeof Worker === "function"`. */
  hasWorker: boolean;
  /** `Promise.withResolvers` — Safari 17.4+, Chrome 119+, Firefox 121+. */
  withResolvers: boolean;
  /** `ArrayBuffer.prototype.transferToFixedLength` — Safari 17.4+, Chrome 114+. */
  transferToFixedLength: boolean;
};

/** Read the native platform facts. Call it before anything polyfills. */
export function readPdfPlatform(): PdfPlatform {
  const P = (typeof Promise !== "undefined" ? Promise : undefined) as
    (PromiseConstructor & { withResolvers?: unknown }) | undefined;
  const AB = (typeof ArrayBuffer !== "undefined" ? ArrayBuffer.prototype : undefined) as
    (ArrayBuffer & { transferToFixedLength?: unknown }) | undefined;
  return {
    hasWorker: typeof Worker === "function",
    withResolvers: typeof P?.withResolvers === "function",
    transferToFixedLength: typeof AB?.transferToFixedLength === "function",
  };
}

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
 * WHY THE TWO POLYFILLED APIS DECIDE IT (pdf.js 6). The worker bundle calls
 * `Promise.withResolvers()` and `transferToFixedLength()` and polyfills
 * neither (lib/pdfjsPolyfills.ts). We can only polyfill THIS thread. On the
 * main-thread plan the worker code runs here, in globals we fixed; in a real
 * Worker it would run in globals we cannot touch and die on its first font.
 *
 * WHY `URL.parse` NO LONGER DECIDES IT (it did until 2026-10). pdf.js's worker
 * bring-up starts with
 *
 *     this._isSameOrigin = (baseUrl, otherUrl) => {
 *       const base = URL.parse(baseUrl);          // static URL.parse, Safari 18
 *       ...
 *     };
 *     try {
 *       if (!PDFWorker._isSameOrigin(window.location, workerSrc)) { ... }
 *       const worker = new Worker(workerSrc, { type: "module" });
 *       ...
 *     } catch { info("The worker has been disabled."); }
 *     this.#setupFakeWorker();
 *
 * An earlier version of this rule sent every browser without `URL.parse` to the
 * main thread, on the belief that this call throws on iOS 17. It does not: the
 * legacy build bundles core-js's `URL.parse` and runs it at import, in the main
 * bundle AND the worker bundle (tests/pdfjsWorkerPlan pins that). The old rule
 * was also read AFTER the import, so it never fired — iOS 16.4–17.x has been
 * getting a real module worker in production all along. Measured on a WebKit
 * 17.4 engine (2026-10-23): plain pdf.js 6 with a module worker opens and
 * draws. Keeping the rule would have pushed iOS 17.4–17.7 onto the slower main
 * thread, where ICC colour profiles cannot load (pdf.js fetches them with a
 * synchronous XHR, which browsers allow only inside a Worker), for nothing.
 *
 * The main thread does keep one advantage, and it is why "no Worker" still
 * goes there: pdf.js's own fallback is `await import(workerSrc)` stored through
 * `shadow()`, so one failed import is cached for the page. Importing the module
 * ourselves goes through the app's chunk loader instead.
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
export function planPdfWorker(env: PdfPlatform): PdfWorkerPlan {
  if (!env.hasWorker) return "main-thread";
  // A real Worker would not have the polyfills (lib/pdfjsPolyfills.ts).
  if (!env.withResolvers || !env.transferToFixedLength) return "main-thread";
  return "module-worker";
}

/** What `loadPdfjs()` decided, plus the facts behind it — for error logs. */
export type PdfEngineDiagnostic = {
  plan: PdfWorkerPlan;
  /** False on Safari below 15.4, where the main-thread plan cannot work. */
  structuredClone: boolean;
  /** APIs this page had to polyfill — empty on any current browser. */
  polyfilled: PdfjsPolyfilledApi[];
};

let lastDiagnostic: PdfEngineDiagnostic | null = null;

/** The native facts, read once — on the first loadPdfjs(), before any import. */
let nativePlatform: PdfPlatform | null = null;
const polyfilledSoFar: PdfjsPolyfilledApi[] = [];

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
  // THE ORDER IS THE FIX — read, then polyfill, then import. Our polyfills
  // define exactly the functions the plan asks about (and pdf.js's core-js
  // defines more at import), so a platform read taken afterwards would describe
  // a browser that does not exist — and hand an iOS 16 phone a real Worker
  // without the polyfills. Read once; every later call reuses it.
  const native = (nativePlatform ??= readPdfPlatform());
  for (const name of installPdfjsPolyfills()) polyfilledSoFar.push(name);

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const plan = planPdfWorker(native);
  lastDiagnostic = {
    plan,
    structuredClone: typeof structuredClone === "function",
    polyfilled: [...polyfilledSoFar],
  };

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
    // Defence in depth against malicious uploads. CVE-2026-16633 (pdf.js
    // 5.6.83 to 6.2.107: a crafted PDF runs JavaScript on our origin through
    // PDF scripting) is fixed by the installed 6.4.x. We never reached it
    // anyway — the hole needs the viewer's `enableScripting` sandbox, and we
    // only render canvas + a text layer — and these two keep the neighbouring
    // doors shut: no XFA form layer, and no font code compiled with eval.
    enableXfa: false,
    isEvalSupported: false,
  };
}

/**
 * Tear a document down. pdf.js 6 REMOVED `PDFDocumentProxy.destroy()`; the
 * loading task owns teardown now (`doc.loadingTask.destroy()`), and destroying
 * it is still what frees the worker-side document and its 50 MB global image
 * cache (lib/pdfThumbBudget).
 *
 * Why a helper and not the one-liner at each call site: the old call shapes
 * fail in two different silent ways on 6.x. `doc.destroy()` throws a TypeError,
 * which the viewer's catch classified as "this browser cannot open PDFs";
 * `doc?.destroy?.()` does nothing at all and leaks every document plus its
 * worker. This never throws and never leaves a rejection unhandled.
 */
export function destroyPdfDocument(
  doc: { loadingTask?: { destroy(): Promise<void> } } | null | undefined,
): void {
  if (!doc) return;
  try {
    doc.loadingTask?.destroy().catch(() => { /* already gone */ });
  } catch { /* the getter can throw once the transport is gone */ }
}
