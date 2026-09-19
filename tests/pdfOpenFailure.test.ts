import { describe, it, expect } from "vitest";
import {
  classifyPdfOpenFailure, pdfOpenFailureMessage, PDF_OPEN_FAILURE_TEXT,
  type PdfOpenFailure,
} from "@/lib/pdfOpenFailure";

/**
 * The organiser used to print one line — "Could not open this PDF." — for the
 * fetch, the engine, the memory, the password and the bytes. A sub-admin's
 * report of that line stayed unexplained for weeks because the only visible
 * fact pointed at the one layer that was fine.
 *
 * These are the five conversations it now tells apart.
 */
describe("classifyPdfOpenFailure", () => {
  it("names the step for anything that fails before the read", () => {
    expect(classifyPdfOpenFailure("fetch", Object.assign(new Error("HTTP 401"), { name: "HTTP 401" }))).toBe("fetch");
    expect(classifyPdfOpenFailure("engine", new Error("chunk load failed"))).toBe("engine");
  });

  it("calls a missing platform API the browser, in any step", () => {
    // The iPhone bug itself: pdfjs-dist's default build calls
    // Promise.withResolvers in getDocument's own constructor, and Safari below
    // 17.4 has no such method. Blaming the file would send the admin re-scanning
    // a document that is perfectly fine.
    const withResolvers = new TypeError("Promise.withResolvers is not a function");
    expect(classifyPdfOpenFailure("read", withResolvers)).toBe("engine");
    expect(classifyPdfOpenFailure("fetch", withResolvers)).toBe("engine");
    expect(classifyPdfOpenFailure("read", new ReferenceError("structuredClone is not defined"))).toBe("engine");
  });

  it("calls a failed engine bring-up the browser even when pdf.js wraps it in a plain Error", () => {
    // pdf.js reports this as `new Error('Setting up fake worker failed: "..."')`
    // — name "Error", which on its own would be classified as a broken file.
    expect(classifyPdfOpenFailure("read", new Error('Setting up fake worker failed: "x".'))).toBe("engine");
    expect(classifyPdfOpenFailure("read", new Error('No "GlobalWorkerOptions.workerSrc" specified.'))).toBe("engine");
  });

  it("puts memory ahead of every other verdict, whatever step it lands in", () => {
    // A phone refusing an allocation is an ordinary outcome here, and it is the
    // only verdict with a useful answer ("try it on a computer").
    expect(classifyPdfOpenFailure("read", new RangeError("Array buffer allocation failed"))).toBe("memory");
    expect(classifyPdfOpenFailure("read", Object.assign(new Error("x"), { name: "QuotaExceededError" }))).toBe("memory");
    expect(classifyPdfOpenFailure("engine", new Error("Out of memory"))).toBe("memory");
  });

  it("separates a locked scan, a transport failure and bad bytes once reading", () => {
    // Names read out of the installed pdfjs-dist: BaseException sets
    // `this.name` to the class name, so they survive minification.
    const named = (name: string) => Object.assign(new Error("x"), { name });
    expect(classifyPdfOpenFailure("read", named("PasswordException"))).toBe("locked");
    expect(classifyPdfOpenFailure("read", named("ResponseException"))).toBe("fetch");
    expect(classifyPdfOpenFailure("read", named("InvalidPDFException"))).toBe("read");
    expect(classifyPdfOpenFailure("read", named("UnknownErrorException"))).toBe("read");
  });

  it("survives junk instead of an error", () => {
    expect(classifyPdfOpenFailure("read", null)).toBe("read");
    expect(classifyPdfOpenFailure("read", "boom")).toBe("read");
    expect(classifyPdfOpenFailure("read", { name: 7, message: {} })).toBe("read");
  });
});

describe("the visible text", () => {
  it("has all three portal languages for every failure — LAW #19", () => {
    const kinds: PdfOpenFailure[] = ["fetch", "engine", "memory", "locked", "read"];
    for (const k of kinds) {
      const t = PDF_OPEN_FAILURE_TEXT[k];
      expect(t, k).toBeTruthy();
      for (const l of ["en", "de", "fr"] as const) {
        expect(t[l].length, `${k}.${l}`).toBeGreaterThan(0);
      }
      // Three distinct sentences, not one copied into three slots.
      expect(new Set([t.en, t.de, t.fr]).size, k).toBe(3);
    }
  });

  it("carries the error name, because that is what survives a forwarded screenshot", () => {
    expect(pdfOpenFailureMessage("fetch", "en", "HTTP 401")).toContain("(HTTP 401)");
    expect(pdfOpenFailureMessage("engine", "de", "TypeError")).toContain("(TypeError)");
    expect(pdfOpenFailureMessage("engine", "de", "TypeError")).toContain("Browser");
    expect(pdfOpenFailureMessage("locked", "fr", null)).toBe(PDF_OPEN_FAILURE_TEXT.locked.fr);
  });

  it("falls back to English for a language it does not know", () => {
    expect(pdfOpenFailureMessage("read", "ar")).toBe(PDF_OPEN_FAILURE_TEXT.read.en);
  });
});
