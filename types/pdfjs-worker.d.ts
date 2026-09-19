/**
 * The pdf.js WORKER bundle has no type declarations shipped beside it
 * (pdfjs-dist ships `legacy/build/pdf.d.mts` for the library, nothing for the
 * worker), but `lib/pdfjs.ts` imports it as a module on purpose: on the
 * main-thread plan we put it on `globalThis.pdfjsWorker`, which is the hook
 * pdf.js checks before it tries to resolve a worker URL.
 *
 * Only `WorkerMessageHandler` is ever read, and only by pdf.js itself.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}
