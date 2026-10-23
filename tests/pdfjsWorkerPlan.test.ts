import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { destroyPdfDocument, planPdfWorker, pdfLoadOptions, type PdfPlatform } from "@/lib/pdfjs";
import { PDFJS_POLYFILLED_APIS } from "@/lib/pdfjsPolyfills";
import { DOC_FAILURE_TEXT } from "@/lib/documentFetch";

/**
 * Two things are pinned here.
 *
 * The first is the DECISION: where pdf.js parses a document, given what the
 * browser has. That is pure and testable.
 *
 * The second is the REASON — and it is the more valuable half. lib/pdfjs.ts
 * pays ~60 KB to take the `legacy/` build and gives up a worker on iOS 17
 * because of two specific facts about the INSTALLED pdfjs-dist. A future
 * `npm update pdfjs-dist` could remove either fact, and nothing in the app
 * would notice: the code would keep working and the comments would quietly
 * become false. So the facts are asserted against the installed source. If one
 * of these fails after an upgrade, re-read the new source before changing the
 * expectation — a sub-admin on an old iPhone is the one who pays for a guess.
 */

const PKG = path.join(process.cwd(), "node_modules", "pdfjs-dist");
const installed = fs.existsSync(PKG);
const read = (p: string) => fs.readFileSync(path.join(PKG, p), "utf8");
// The organiser itself — components/PdfPageOrganizer.tsx is now only the
// next/dynamic door that keeps pdfjs-dist out of the Cloudflare Worker script.
const ORG = fs.readFileSync(path.join(process.cwd(), "components", "PdfPageOrganizerImpl.tsx"), "utf8");

// Real profiles, MEASURED on the WebKit 16.4 / 17.0 / 17.4 / 18.0 engines
// (2026-10-23, Playwright's builds): what each has natively.
const CURRENT: PdfPlatform = { hasWorker: true, withResolvers: true, transferToFixedLength: true };
const IOS_17_4: PdfPlatform = CURRENT;   // has both; lacks only URL.parse, which pdf.js bundles
const IOS_17_0: PdfPlatform = { hasWorker: true, withResolvers: false, transferToFixedLength: false };
const IOS_16_4: PdfPlatform = IOS_17_0;

describe("planPdfWorker", () => {
  it("uses a module worker on a current browser", () => {
    expect(planPdfWorker(CURRENT)).toBe("module-worker");
  });

  it("keeps iOS 17.4–17.7 on a real worker — URL.parse no longer decides it", () => {
    // The legacy build bundles URL.parse in both bundles, so pdf.js's own
    // same-origin check cannot throw there; plain pdf.js 6 with a module worker
    // was measured opening and drawing on the 17.4 engine. Sending these phones
    // to the main thread would only cost speed and ICC colour profiles.
    expect(planPdfWorker(IOS_17_4)).toBe("module-worker");
  });

  it("takes the main thread when the worker would lack a polyfilled API (iOS 16.4–17.3)", () => {
    // The worker bundle calls both and pdf.js 6 polyfills neither. Our
    // polyfills only exist on this thread, so a real Worker would die on its
    // first font (transferToFixedLength) or its first message (withResolvers).
    expect(planPdfWorker(IOS_17_0)).toBe("main-thread");
    expect(planPdfWorker(IOS_16_4)).toBe("main-thread");
    expect(planPdfWorker({ ...CURRENT, withResolvers: false })).toBe("main-thread");
    expect(planPdfWorker({ ...CURRENT, transferToFixedLength: false })).toBe("main-thread");
  });

  it("takes the main thread when there is no Worker at all", () => {
    expect(planPdfWorker({ ...CURRENT, hasWorker: false })).toBe("main-thread");
    expect(planPdfWorker({ ...IOS_16_4, hasWorker: false })).toBe("main-thread");
  });
});

describe("loadPdfjs reads the platform BEFORE anything can polyfill it", () => {
  // The order is the whole fix: pdf.js's legacy build defines URL.parse when it
  // is evaluated, and installPdfjsPolyfills defines the rest. Read afterwards,
  // an iOS 16 phone looks like Safari 18 and is handed a real Worker that has
  // none of the polyfills. Asserted on the source because the case that matters
  // (a browser missing these natively) is not the one running the tests.
  const SRC = fs.readFileSync(path.join(process.cwd(), "lib", "pdfjs.ts"), "utf8");
  const body = SRC.slice(SRC.indexOf("export async function loadPdfjs()"));

  it("reads, then polyfills, then imports, then plans", () => {
    const read = body.indexOf("readPdfPlatform()");
    const poly = body.indexOf("installPdfjsPolyfills()");
    const imp = body.indexOf('import("pdfjs-dist/legacy/build/pdf.mjs")');
    const plan = body.indexOf("planPdfWorker(native)");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(poly);
    expect(poly).toBeLessThan(imp);
    expect(imp).toBeLessThan(plan);
  });

  it("reads once and reuses it — a later call would see the polyfilled globals", () => {
    expect(body).toMatch(/nativePlatform \?\?= readPdfPlatform\(\)/);
  });
});

describe("destroyPdfDocument (pdf.js 6 removed PDFDocumentProxy.destroy)", () => {
  it("destroys through the loading task", () => {
    const destroy = vi.fn(() => Promise.resolve());
    destroyPdfDocument({ loadingTask: { destroy } });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("never throws and never leaves a rejection unhandled", async () => {
    expect(() => destroyPdfDocument(null)).not.toThrow();
    expect(() => destroyPdfDocument(undefined)).not.toThrow();
    // The getter reads the transport, which can already be gone.
    const gone = Object.defineProperty({}, "loadingTask", { get() { throw new TypeError("transport is null"); } });
    expect(() => destroyPdfDocument(gone)).not.toThrow();
    const rejecting = { loadingTask: { destroy: () => Promise.reject(new Error("worker was destroyed")) } };
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    destroyPdfDocument(rejecting);
    await new Promise(r => setTimeout(r, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("is what both pdf.js surfaces call — no removed or silently-dead call shape is left", () => {
    // `doc.destroy()` throws on 6.x (the viewer then blamed the browser);
    // `doc?.destroy?.()` does nothing at all (the organiser leaked every document).
    const VIEWER = fs.readFileSync(path.join(process.cwd(), "components", "PdfViewerImpl.tsx"), "utf8");
    // Code only — the comments next to the fix name the old call on purpose.
    const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const src of [VIEWER, ORG]) {
      expect(code(src)).toContain("destroyPdfDocument(");
      expect(code(src)).not.toMatch(/\b(doc|pdf|pdfRef\.current|docRef\.current)\??\.destroy\b/);
    }
  });
});

describe("pdfLoadOptions", () => {
  it("still carries wasmUrl — some German forms are pure CCITTFax masks", () => {
    // Without it pdf.js silently drops every image and the page renders blank.
    // This was a real production bug; it must survive every refactor of the
    // module around it.
    const o = pdfLoadOptions("blob:x");
    expect(o.wasmUrl).toMatch(/\/pdfjs\/wasm\/$/);
    expect(o.cMapUrl).toMatch(/\/pdfjs\/cmaps\/$/);
    expect(o.standardFontDataUrl).toMatch(/\/pdfjs\/standard_fonts\/$/);
    expect(o.cMapPacked).toBe(true);
    expect(o.useSystemFonts).toBe(false);
    expect(o.isOffscreenCanvasSupported).toBe(false);
  });

  it("keeps the XFA layer and eval-compiled fonts switched off (defence in depth)", () => {
    const o = pdfLoadOptions("blob:x");
    expect(o.enableXfa).toBe(false);
    expect(o.isEvalSupported).toBe(false);
  });
});

describe.skipIf(!installed)("the installed pdfjs-dist still justifies the legacy build", () => {
  it("the default build calls Promise.withResolvers and polyfills nothing", () => {
    const def = read("build/pdf.mjs");
    expect(def).toContain("Promise.withResolvers()");
    expect(def).not.toContain("es.promise.with-resolvers");
  });

  it("getDocument constructs a class field that calls it, so it throws before any byte is read", () => {
    // This is the whole iPhone bug in one line: the field runs in the
    // constructor, so an iPhone below iOS 17.4 fails at getDocument() with a
    // bare TypeError — no network request, nothing to attribute it to.
    const def = read("build/pdf.mjs");
    expect(def).toMatch(/class PDFDocumentLoadingTask \{[\s\S]{0,120}_capability = Promise\.withResolvers\(\)/);
  });

  it("the legacy build NO LONGER brings the withResolvers polyfill — lib/pdfjsPolyfills does", () => {
    // pdfjs-dist 5.7.284 compiled in core-js's es.promise.with-resolvers;
    // 6.x raised the legacy floor to Safari 18 and dropped it. If a future
    // version brings it back, our polyfill is merely redundant — re-read and
    // decide; do not just flip this.
    for (const f of ["legacy/build/pdf.mjs", "legacy/build/pdf.worker.mjs"]) {
      const s = read(f);
      expect(s).toContain("Promise.withResolvers()");
      expect(s).not.toContain("es.promise.with-resolvers");
    }
    expect(PDFJS_POLYFILLED_APIS).toContain("Promise.withResolvers");
  });

  it("the worker packs fonts with transferToFixedLength and does not polyfill it", () => {
    // compileFontInfo / compileSystemFontInfo — every PDF with text reaches it.
    const w = read("legacy/build/pdf.worker.mjs");
    expect(w).toContain(".transferToFixedLength(");
    expect(w).not.toContain("es.array-buffer.transfer-to-fixed-length");
    expect(PDFJS_POLYFILLED_APIS).toContain("ArrayBuffer.prototype.transferToFixedLength");
  });

  it("still bundles every core-js polyfill 6.4.299 did — an upgrade that drops one fails HERE", () => {
    // This is the tripwire that would have caught the 5 -> 6 regression. pdf.js
    // drops a polyfill whenever its browser floor rises; nothing in the app
    // notices until an older iPhone throws. If this fails after an upgrade,
    // find where the missing API is called (lib/pdfjsPolyfills.ts says how),
    // polyfill it there if it is on a path we run, then update the list.
    const modules = (f: string) =>
      new Set((read(f).match(/core-js\/modules\/([a-z0-9.-]+)\.js/g) ?? []).map(m => m.slice(16, -3)));
    const COMMON = [
      "es.array.includes", "es.array.push", "es.iterator.constructor", "es.iterator.every",
      "es.iterator.filter", "es.iterator.find", "es.iterator.flat-map", "es.iterator.for-each",
      "es.iterator.map", "es.iterator.some", "es.iterator.to-array", "es.json.stringify",
      "es.map.get-or-insert", "es.map.get-or-insert-computed", "es.math.sum-precise", "es.promise.try",
      "es.set.difference.v2", "es.set.intersection.v2", "es.set.is-disjoint-from.v2",
      "es.set.is-subset-of.v2", "es.set.is-superset-of.v2", "es.set.symmetric-difference.v2",
      "es.set.union.v2", "es.typed-array.with", "es.uint8-array.from-base64",
      "es.uint8-array.set-from-base64", "es.uint8-array.set-from-hex", "es.uint8-array.to-base64",
      "es.uint8-array.to-hex", "es.weak-map.get-or-insert", "es.weak-map.get-or-insert-computed",
      "web.url.parse",
    ];
    const MAIN = [...COMMON, "es.iterator.drop", "es.iterator.take", "es.json.parse", "web.dom-exception.stack"];
    const WORKER = [...COMMON, "web.self"];
    const main = modules("legacy/build/pdf.mjs");
    const worker = modules("legacy/build/pdf.worker.mjs");
    expect(MAIN.filter(m => !main.has(m))).toEqual([]);
    expect(WORKER.filter(m => !worker.has(m))).toEqual([]);
  });

  it("the legacy build defines URL.parse at import, before its worker code runs", () => {
    // core-js's web.url.parse runs at module evaluation, ahead of src/shared/util,
    // so it is in place before PDFWorker's same-origin check ever calls it.
    expect(read("legacy/build/pdf.mjs")).toMatch(/web_url_parse_namespaceFn\(\);/);
  });

  it("PDFDocumentProxy has no destroy() — the loading task owns teardown", () => {
    const s = read("legacy/build/pdf.mjs");
    const body = s.slice(s.indexOf("class PDFDocumentProxy {"), s.indexOf("class PDFPageProxy {"));
    expect(body.length).toBeGreaterThan(1000);
    expect(body).not.toMatch(/^ {2}(async )?destroy\(/m);
    expect(body).toMatch(/^ {2}get loadingTask\(\)/m);
  });

  it("the worker bundle we import on the main thread still exports WorkerMessageHandler", () => {
    // loadPdfjs() puts that module on globalThis.pdfjsWorker; pdf.js reads
    // exactly `globalThis.pdfjsWorker?.WorkerMessageHandler` off it.
    expect(read("legacy/build/pdf.worker.min.mjs")).toContain("export{WorkerMessageHandler}");
  });

  it("pdf.js still checks globalThis.pdfjsWorker before it resolves a worker URL", () => {
    // If this hook ever moves, the main-thread plan silently stops applying and
    // an old iPhone goes back to pdf.js's cached-rejection fallback.
    expect(read("build/pdf.mjs")).toContain("globalThis.pdfjsWorker?.WorkerMessageHandler");
  });

  it("pdf.js calls URL.parse before creating a worker, and both legacy bundles bring it", () => {
    // Why iOS 17.4–17.7 may keep a real worker: the call in the same-origin
    // check is covered by the bundled core-js polyfill in the page AND inside
    // the worker. If either polyfill ever leaves, those phones need the main
    // thread again — the core-js tripwire above would also fail.
    expect(read("legacy/build/pdf.mjs")).toContain("const base = URL.parse(baseUrl);");
    expect(read("legacy/build/pdf.mjs")).toContain("core-js/modules/web.url.parse.js");
    expect(read("legacy/build/pdf.worker.mjs")).toContain("core-js/modules/web.url.parse.js");
  });

  it("the main-thread path still needs structuredClone, which no polyfill brings", () => {
    // LoopbackPort is what replaces postMessage when there is no real worker.
    // Safari got structuredClone in 15.4; below that neither plan can work, and
    // lib/pdfjs.ts reports it rather than pretending it chose wrong.
    expect(read("build/pdf.mjs")).toMatch(/class LoopbackPort \{[\s\S]{0,200}structuredClone\(/);
    expect(read("legacy/build/pdf.mjs")).not.toContain("web.structured-clone");
  });
});

describe("the organiser still says WHICH step failed", () => {
  it("in all three languages, from the shared table", () => {
    // The three sentences used to be inline in this file. They moved to
    // lib/documentFetch.ts when the same "which layer failed" answer was owed
    // by AdminDocPreviewModal and PdfViewer too — three copies of one message
    // table is how one of them ends up untranslated. The REQUIREMENT is
    // unchanged and still asserted, now against the shared table;
    // tests/documentFetch.test.ts checks every layer has fr/en/de and differs.
    expect(DOC_FAILURE_TEXT.download.en).toBe("Could not download this file.");
    expect(DOC_FAILURE_TEXT.download.de).toBe("Datei konnte nicht geladen werden.");
    expect(DOC_FAILURE_TEXT.download.fr).toBe("Impossible de télécharger ce fichier.");
  });

  it("tells the steps apart instead of printing one message for everything", () => {
    // Two classifiers live side by side on purpose. classifyPdfOpenFailure
    // judges everything pdf.js throws and keeps its own stage vocabulary;
    // a DocumentFetchError is the one verdict it cannot reach, because only
    // the guard that read the response saw the status AND the bytes. Both
    // must stay wired, or one class of failure loses its sentence.
    expect(ORG).toMatch(/let stage: PdfOpenStage = "fetch"/);
    expect(ORG).toContain("classifyPdfOpenFailure(stage, e)");
    expect(ORG).toContain("DocumentFetchError");
    expect(ORG).toMatch(/docFailureMessage\(fetchFailure\.layer, lang/);
    expect(ORG).toMatch(/pdfOpenFailureMessage\(kind as PdfOpenFailure, lang/);
  });

  it("reads the document through the guard, never a bare res.blob()", () => {
    // A bare `res.blob()` after an `res.ok` check still accepts a 200 whose
    // body is `{"error":…}` — pdf.js then reports the DOCUMENT as unreadable.
    expect(ORG).toContain("fetchDocumentBlob(");
    expect(ORG).not.toMatch(/await res\.blob\(\)/);
  });
});
