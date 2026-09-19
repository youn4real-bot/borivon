import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planPdfWorker, pdfLoadOptions } from "@/lib/pdfjs";

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

describe("planPdfWorker", () => {
  it("uses a module worker on a current browser", () => {
    expect(planPdfWorker({ hasWorker: true, urlParse: true })).toBe("module-worker");
  });

  it("takes the main thread when URL.parse is missing (iOS 17)", () => {
    // pdf.js calls URL.parse inside its own same-origin check before creating
    // the worker; on iOS 17 that throws and pdf.js fake-workers by itself. We
    // take the same branch deliberately so the fallback is our chunk loader,
    // not pdf.js's one-shot import() whose rejection it caches for the page.
    expect(planPdfWorker({ hasWorker: true, urlParse: false })).toBe("main-thread");
  });

  it("takes the main thread when there is no Worker at all", () => {
    expect(planPdfWorker({ hasWorker: false, urlParse: true })).toBe("main-thread");
    expect(planPdfWorker({ hasWorker: false, urlParse: false })).toBe("main-thread");
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

  it("the legacy build brings the polyfill", () => {
    expect(read("legacy/build/pdf.mjs")).toContain("es.promise.with-resolvers");
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

  it("pdf.js still calls URL.parse in the same-origin check that guards worker creation", () => {
    // The reason `urlParse` is what decides the plan. If pdf.js stops using it,
    // an iOS 17 phone can have a real worker again and this rule should go.
    expect(read("build/pdf.mjs")).toContain("const base = URL.parse(baseUrl);");
  });

  it("the main-thread path still needs structuredClone, which no polyfill brings", () => {
    // LoopbackPort is what replaces postMessage when there is no real worker.
    // Safari got structuredClone in 15.4; below that neither plan can work, and
    // lib/pdfjs.ts reports it rather than pretending it chose wrong.
    expect(read("build/pdf.mjs")).toMatch(/class LoopbackPort \{[\s\S]{0,200}structuredClone\(/);
    expect(read("legacy/build/pdf.mjs")).not.toContain("web.structured-clone");
  });
});
