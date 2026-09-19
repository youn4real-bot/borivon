/**
 * lib/pdfjs.ts — SINGLE source of truth for loading PDFs with pdf.js.
 *
 * EVERY pdf.js consumer in the app MUST get the library from `loadPdfjs()` and
 * open documents through `pdfLoadOptions(src)`, so neither the build choice nor
 * the critical render options can be forgotten by the next viewer:
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
 * The referenced asset folders are committed under /public/pdfjs/{wasm,cmaps,
 * standard_fonts} and re-copied from node_modules/pdfjs-dist on every install
 * (scripts/copy-pdfjs-assets.mjs, wired to `postinstall`), so they can never
 * drift from the installed pdfjs-dist version.
 */

import { isIOSDevice } from "@/lib/platform";

// ─────────────────────────────────────────────────────────────────────────────
// WHICH BUILD — always `legacy/`, never the default one.
//
// Read out of the installed source (pdfjs-dist 5.7.284), not remembered:
//
//  • legacy/build/pdf.mjs compiles in the core-js polyfills — both
//    `Promise.withResolvers` and `URL.parse` are inside that bundle. The
//    default build/pdf.mjs uses `Promise.withResolvers()` 26 times with no
//    polyfill, and the first use is a CLASS FIELD of the loading task that
//    `getDocument()` constructs. On an iPhone below iOS 17.4 that method does
//    not exist, so `getDocument` throws `TypeError: Promise.withResolvers is
//    not a function` before a single byte of the PDF is read — one throw, no
//    detail, which is exactly the "could not open this PDF" an iPhone reports
//    for a file that opens on every desktop.
//  • `URL.parse` (iOS 18+) sits in pdf.js's same-origin check just before it
//    creates the worker, inside a try/catch — so on the default build an iOS 17
//    phone does not crash there, it silently drops to parsing on the UI thread.
//    The legacy build polyfills that one too.
//  • The worker code MUST come from the same build. A legacy main thread paired
//    with the default worker puts the un-polyfilled APIs straight back into the
//    worker, where the failure is even harder to see.
//
// The cost is ~60 KB more on a chunk that is lazily loaded anyway.
// ─────────────────────────────────────────────────────────────────────────────

/** How the pdf.js worker code will run in this browser. */
export type PdfWorkerPlan = "module-worker" | "main-thread";

/**
 * Decide where pdf.js parses the document. Pure on purpose — the interesting
 * cases (no `Worker`, no module workers, iOS) are the ones no machine here has.
 *
 * "main-thread" means we hand pdf.js the worker code ourselves, by putting the
 * imported worker module on `globalThis.pdfjsWorker`. pdf.js checks exactly
 * that before anything else (`PDFWorker.#initialize`) and then uses it directly
 * (`_setupFakeWorkerGlobal`), so no worker URL is ever resolved, fetched or
 * MIME-checked. It parses on the UI thread instead — slower, never broken.
 *
 * Why iOS takes that path even though it has had module workers since iOS 15:
 *
 *  • pdf.js's own recovery from a worker that will not start is to `import()`
 *    the worker URL on the main thread — the bundler-emitted asset URL. If that
 *    import fails as well (404 / wrong MIME / CSP — none of which can be
 *    reproduced off an iPhone), pdf.js stores the REJECTED promise on the class
 *    (`shadow()`), so every later attempt in that page load fails identically.
 *    That recovery is one-shot and unverifiable from here; not needing it is
 *    verifiable.
 *  • Every other PDF surface in the portal already refuses to run pdf.js on
 *    iOS at all (isIOSDevice → IosPdfFrame). The organiser cannot do that — an
 *    iframe gives no thumbnails — so it takes the most conservative pdf.js path
 *    that exists instead.
 *
 * Desktop keeps the real worker: it is faster on a long scan, and it is the
 * path already proven in production by PdfViewer.
 *
 * ONE THING THE MAIN THREAD NEEDS THAT A WORKER DOES NOT: `structuredClone`.
 * With no real worker there is no `postMessage`, so pdf.js copies every message
 * through its own `LoopbackPort`, which calls `structuredClone` directly. core-js
 * does not polyfill it — it is a DOM API, not a language feature — so the legacy
 * build does not bring it. Measured in a browser with the method deleted: the
 * real-worker path opens the file in 137 ms, the main-thread path throws
 * `ReferenceError: structuredClone is not defined`. It landed in Safari 15.4, so
 * this only bites an iPhone older than that — which is exactly the phone the iOS
 * preference was meant to protect. Hence: prefer the main thread on iOS, but
 * never CHOOSE it into a certain failure.
 */
export function planPdfWorker(env: {
  /** `typeof Worker === "function"` in this browser. */
  hasWorker: boolean;
  /** A `{ type: "module" }` worker can actually be constructed here. */
  moduleWorkers: boolean;
  /** iPhone / iPad (any browser on it — they are all WebKit). */
  ios: boolean;
  /** `typeof structuredClone === "function"` — required ONLY off-worker. */
  structuredClone: boolean;
}): PdfWorkerPlan {
  // No usable worker: the main thread is not a preference, it is the only path
  // left. If structuredClone is missing too, nothing here can open the file —
  // but the organiser's error text names the browser, which is the useful end.
  if (!env.hasWorker || !env.moduleWorkers) return "main-thread";
  // A worker IS available. Take the main thread on iOS only when it can work.
  if (env.ios && env.structuredClone) return "main-thread";
  return "module-worker";
}

let moduleWorkerSupport: boolean | null = null;

/**
 * Can this browser construct a MODULE worker? pdf.js only ever creates
 * `new Worker(src, { type: "module" })`, and a browser that does not support
 * the option simply never reads it. So hand the constructor an options object
 * that records the read: if `type` was never looked at, module workers are not
 * supported (Safari before 15, older WebViews).
 *
 * Anything that throws — CSP forbidding blob: workers, no Blob/URL — counts as
 * "no", because constructing a worker is the very next thing pdf.js would do.
 */
export function moduleWorkersUsable(): boolean {
  if (moduleWorkerSupport !== null) return moduleWorkerSupport;
  moduleWorkerSupport = false;
  if (typeof Worker !== "function" || typeof Blob !== "function"
      || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return moduleWorkerSupport;
  }
  let probe: Worker | null = null;
  let url = "";
  try {
    let read = false;
    url = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
    probe = new Worker(url, {
      get type() { read = true; return "module"; },
    } as WorkerOptions);
    moduleWorkerSupport = read;
  } catch {
    moduleWorkerSupport = false;
  } finally {
    // The probe script is empty and nothing listens to it — tear it down right
    // away, so this costs one construction and nothing else.
    try { probe?.terminate(); } catch { /* already gone */ }
    try { if (url) URL.revokeObjectURL(url); } catch { /* already gone */ }
  }
  return moduleWorkerSupport;
}

let planUsed: PdfWorkerPlan | null = null;

/** The plan the last `loadPdfjs()` took — printed with any organiser failure. */
export function currentPdfWorkerPlan(): PdfWorkerPlan | null {
  return planUsed;
}

/**
 * Load pdf.js ready to open a document: always the legacy build, with the
 * worker wherever `planPdfWorker` says this browser can run it.
 */
export async function loadPdfjs() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const plan = planPdfWorker({
    hasWorker: typeof Worker === "function",
    moduleWorkers: moduleWorkersUsable(),
    ios: isIOSDevice(),
    structuredClone: typeof structuredClone === "function",
  });
  planUsed = plan;

  if (plan === "main-thread") {
    // Hand pdf.js the worker code itself. `globalThis.pdfjsWorker` is the hook
    // it checks first, so no worker URL is ever resolved.
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
