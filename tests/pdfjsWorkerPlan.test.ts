import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { planPdfWorker } from "../lib/pdfjs";

/**
 * WHERE pdf.js RUNS — the choice no machine here can make by trying it.
 *
 * The page organiser is the only surface in the portal that runs pdf.js on a
 * phone, and the phone is the one browser nobody on this side can open. So the
 * decision is a pure function with the browser facts as arguments, and the
 * cases that only exist on an old iPhone (no module workers at all) are tested
 * here instead of hoped for.
 *
 * `moduleWorkersUsable()` is exercised against fake `Worker` constructors that
 * behave the way real engines do: a modern one READS the `{ type: "module" }`
 * option, an old one ignores it entirely, and a page under a strict CSP throws.
 */

describe("planPdfWorker", () => {
  /** Everything a current browser has, so each case states only its own facts. */
  const modern = { hasWorker: true, moduleWorkers: true, ios: false, structuredClone: true };

  it("keeps the real worker on a normal desktop browser", () => {
    expect(planPdfWorker(modern)).toBe("module-worker");
  });

  it("parses on the main thread when module workers are unavailable", () => {
    // Safari < 15 / old WebViews: `new Worker(url, {type:"module"})` silently
    // makes a CLASSIC worker, which cannot run pdf.worker.mjs.
    expect(planPdfWorker({ ...modern, moduleWorkers: false })).toBe("main-thread");
  });

  it("parses on the main thread when there is no Worker at all", () => {
    expect(planPdfWorker({ ...modern, hasWorker: false, moduleWorkers: false })).toBe("main-thread");
    expect(planPdfWorker({ ...modern, hasWorker: false })).toBe("main-thread");
  });

  it("never asks an iPhone for a worker, even a capable one", () => {
    // pdf.js's own fallback when a worker will not start is to import() the
    // bundler-emitted worker URL, and it caches that promise even when it
    // REJECTS. On iOS we never get into that position.
    expect(planPdfWorker({ ...modern, ios: true })).toBe("main-thread");
  });

  it("gives an iPhone with no structuredClone the worker instead", () => {
    // Off-worker, pdf.js copies every message through its own LoopbackPort,
    // which calls structuredClone; core-js does not polyfill it, so the legacy
    // build does not bring one. Measured in a browser with the method deleted:
    // the real worker opens the file, the main thread throws ReferenceError.
    // Preferring the main thread on iOS must not prefer a certain failure.
    expect(planPdfWorker({ ...modern, ios: true, structuredClone: false })).toBe("module-worker");
  });

  it("still says main-thread when nothing else is left", () => {
    // No usable worker AND no structuredClone: doomed either way, but the plan
    // must stay defined — the organiser turns the throw into "this browser
    // cannot open PDFs here", which is the answer that actually helps.
    expect(planPdfWorker({ hasWorker: false, moduleWorkers: false, ios: true, structuredClone: false }))
      .toBe("main-thread");
  });
});

describe("moduleWorkersUsable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** Fresh module each time — the real one memoises the answer per page load. */
  async function probeWith(WorkerImpl: unknown): Promise<boolean> {
    vi.resetModules();
    if (WorkerImpl === undefined) vi.stubGlobal("Worker", undefined);
    else vi.stubGlobal("Worker", WorkerImpl);
    const mod = await import("../lib/pdfjs");
    return mod.moduleWorkersUsable();
  }

  it("says yes when the engine reads the module option", async () => {
    const terminated: string[] = [];
    class ModernWorker {
      constructor(_url: string, opts?: { type?: string }) {
        // Reading `type` is exactly what a module-worker-capable engine does.
        void opts?.type;
      }
      terminate() { terminated.push("yes"); }
    }
    expect(await probeWith(ModernWorker)).toBe(true);
    // The probe must not leave a worker behind.
    expect(terminated).toEqual(["yes"]);
  });

  it("says no when the engine ignores the option (old WebKit)", async () => {
    class ClassicOnlyWorker {
      constructor(_url: string) { /* never looks at the options */ }
      terminate() {}
    }
    expect(await probeWith(ClassicOnlyWorker)).toBe(false);
  });

  it("says no when constructing a worker throws (CSP)", async () => {
    class BlockedWorker {
      constructor() { throw new Error("Refused to create a worker from 'blob:'"); }
      terminate() {}
    }
    expect(await probeWith(BlockedWorker)).toBe(false);
  });

  it("says no when there is no Worker constructor", async () => {
    expect(await probeWith(undefined)).toBe(false);
  });
});

describe("the pdf.js entry points the app actually uses", () => {
  const LIB = readFileSync("lib/pdfjs.ts", "utf8");

  it("loads the LEGACY build and its matching worker, never the default one", () => {
    // The default build calls Promise.withResolvers() while CONSTRUCTING the
    // loading task — iOS < 17.4 throws there before reading a byte.
    expect(LIB).toContain('import("pdfjs-dist/legacy/build/pdf.mjs")');
    expect(LIB).toContain("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
    expect(LIB).not.toMatch(/["']pdfjs-dist\/build\//);
    expect(LIB).not.toMatch(/import\(\s*["']pdfjs-dist["']\s*\)/);
  });

  it("gives pdf.js the worker code itself on the main-thread plan", () => {
    // globalThis.pdfjsWorker is the hook pdf.js checks BEFORE it resolves any
    // worker URL — no fetch, no MIME check, nothing to 404.
    expect(LIB).toContain("pdfjsWorker");
  });

  for (const file of ["components/PdfViewer.tsx", "components/PdfPageOrganizer.tsx"]) {
    it(`${file} goes through loadPdfjs (one build, one copy in the bundle)`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(/loadPdfjs\(\)/);
      expect(src).not.toMatch(/from\s+["']pdfjs-dist["']/);
      expect(src).not.toMatch(/import\(\s*["']pdfjs-dist/);
      // pdfLoadOptions stays the single source of truth for wasmUrl & co.
      expect(src).toContain("pdfLoadOptions(");
    });
  }
});

describe("the organiser's scan survives a long one on a phone", () => {
  const ORG = readFileSync("components/PdfPageOrganizer.tsx", "utf8");

  it("draws every page on ONE canvas, and drops its pixels on close", () => {
    // iOS gives a tab a fixed canvas-memory budget; one canvas per page hits it.
    expect(ORG.match(/createElement\("canvas"\)/g) ?? []).toHaveLength(1);
    expect(ORG).toContain("canvasRef");
    expect(ORG).toMatch(/c\.width = 0; c\.height = 0;/);
  });

  it("releases each page as it is drawn, and yields before the next", () => {
    expect(ORG).toMatch(/cleanup\?\.\(\)|cleanup\(\)/);
    expect(ORG).toMatch(/setTimeout\(r, 0\)/);
  });

  it("gives every page a tile — a missing picture must not drop a page", () => {
    // Whatever the thumbnails do, the LIST is the whole document…
    expect(ORG).toMatch(/Array\.from\(\{ length: count \}/);
    // …and the save sends every kept page, by its original index.
    expect(ORG).toMatch(/kept\.map\(p => \(\{ from: p\.from, rotate: p\.rotate \}\)\)/);
  });

  it("still says which step failed, in all three languages", () => {
    expect(ORG).toContain('let stage: Stage = "fetch"');
    expect(ORG).toContain("Could not download this file.");
    expect(ORG).toContain("Datei konnte nicht geladen werden.");
    expect(ORG).toContain("Impossible de télécharger ce fichier.");
  });
});
