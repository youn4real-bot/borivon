/**
 * lib/pdfjsPolyfills.ts — the two APIs pdf.js 6 stopped polyfilling, put back
 * for the iPhones that still need them.
 *
 * WHY THIS FILE EXISTS. pdf.js 6.0 raised the floor of its `legacy/` build from
 * Safari 16.4 to Safari 18 (gulpfile ENV_TARGETS, PR #21152). The build is
 * Babel + core-js "usage-global", so every API that Safari 18 has natively
 * silently LEFT the bundle. Diffing the core-js modules bundled into
 * pdfjs-dist 5.7.284 against 6.4.299 (legacy pdf.mjs AND pdf.worker.mjs),
 * these are gone:
 *
 *   es.promise.with-resolvers              Safari 17.4   ← on the open path
 *   es.array-buffer.transfer-to-fixed-length  17.4       ← on the font path
 *   es.array-buffer.transfer / .detached   17.4          (not called)
 *   web.url-search-params.has/.delete/.size  17          (filename guess only)
 *
 * Two of them are on a path the portal actually runs:
 *
 *  • `Promise.withResolvers()` — a class FIELD of PDFDocumentLoadingTask, so
 *    `getDocument()` throws a bare TypeError on any iPhone below iOS 17.4
 *    before it reads a byte. This is the September "Could not open this PDF."
 *    bug, which the legacy build used to fix and no longer does.
 *  • `ArrayBuffer.prototype.transferToFixedLength()` — the WORKER code calls it
 *    in compileFontInfo / compileSystemFontInfo to pack every font it hands to
 *    the page. Any PDF with text would fail to draw its fonts.
 *
 * pdf.js 5 also hand-polyfilled `AbortSignal.any` and 6 dropped that too, but
 * in 6.4.299 it is only called by the annotation editor and the viewer's touch
 * manager, neither of which the portal creates. Not polyfilled on purpose.
 *
 * A POLYFILL HERE ONLY REACHES THE THREAD IT RUNS ON. A real Worker has its
 * own globals, so these do nothing for the worker bundle — which is exactly why
 * lib/pdfjs.ts sends every browser missing one of these natively to the
 * "main-thread" plan, where the worker code runs in this window's globals.
 *
 * No syntax changed between the two builds: both legacy bundles parse at
 * ES2022 (checked with acorn), so nothing here has to rescue a parse error.
 */

/** The names this module knows how to provide, in install order. */
export const PDFJS_POLYFILLED_APIS = [
  "Promise.withResolvers",
  "ArrayBuffer.prototype.transferToFixedLength",
] as const;

export type PdfjsPolyfilledApi = (typeof PDFJS_POLYFILLED_APIS)[number];

type Resolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

/** Spec ToIndex, enough for a byte length: a non-negative safe integer. */
function toIndex(value: unknown): number {
  const n = value === undefined ? 0 : Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Invalid array buffer length");
  }
  return n;
}

/**
 * Install whatever `target` is missing and return the names it installed (an
 * empty list on any current browser). Never replaces a function that exists.
 *
 * `target` is injectable so the tests can install onto a fake global instead
 * of the real one; the app always passes nothing.
 */
export function installPdfjsPolyfills(
  target: { Promise: PromiseConstructor; ArrayBuffer: ArrayBufferConstructor } = globalThis,
): PdfjsPolyfilledApi[] {
  const installed: PdfjsPolyfilledApi[] = [];

  const P = target.Promise as PromiseConstructor & { withResolvers?: unknown };
  if (typeof P.withResolvers !== "function") {
    Object.defineProperty(P, "withResolvers", {
      configurable: true,
      writable: true,
      enumerable: false,
      value: function withResolvers<T>(this: PromiseConstructor): Resolvers<T> {
        let resolve!: Resolvers<T>["resolve"];
        let reject!: Resolvers<T>["reject"];
        // `this`, not `Promise`: the spec method honours subclasses, and pdf.js
        // only ever calls it as `Promise.withResolvers()` anyway.
        const promise = new this<T>((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
      },
    });
    installed.push("Promise.withResolvers");
  }

  const proto = target.ArrayBuffer.prototype as ArrayBuffer & { transferToFixedLength?: unknown };
  if (typeof proto.transferToFixedLength !== "function") {
    Object.defineProperty(proto, "transferToFixedLength", {
      configurable: true,
      writable: true,
      enumerable: false,
      // A copy into a new buffer of the requested length. The native method
      // also DETACHES the source; a polyfill cannot do that cheaply and pdf.js
      // never touches the source again (it returns the result and drops it).
      value: function transferToFixedLength(this: ArrayBuffer, newLength?: number): ArrayBuffer {
        const length = newLength === undefined ? this.byteLength : toIndex(newLength);
        const out = new target.ArrayBuffer(length);
        new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(length, this.byteLength)));
        return out;
      },
    });
    installed.push("ArrayBuffer.prototype.transferToFixedLength");
  }

  return installed;
}
