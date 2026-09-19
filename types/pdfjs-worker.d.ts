/**
 * The pdf.js WORKER bundle ships no type declarations beside it — pdfjs-dist
 * 5.7.284 has `legacy/build/pdf.d.mts` for the library and nothing at all for
 * `legacy/build/pdf.worker.min.mjs`.
 *
 * lib/pdfjs.ts imports that worker as a MODULE on purpose: on browsers where
 * pdf.js would silently fall back to parsing on the main thread anyway, we put
 * the module on `globalThis.pdfjsWorker`, which is the first thing
 * `PDFWorker.#initialize()` checks. Only `WorkerMessageHandler` is ever read,
 * and only by pdf.js itself, so `unknown` is the honest type.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}
