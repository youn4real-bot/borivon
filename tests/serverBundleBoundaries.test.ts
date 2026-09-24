import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * THE LAZY DOORS THAT KEEP BROWSER-ONLY LIBRARIES OUT OF THE WORKER SCRIPT.
 *
 * Every page under app/portal is a "use client" page, and Next compiles a
 * client page a SECOND time for SSR. So any library a client page can reach
 * through a STATIC import — and through a bare `await import()` too, which is
 * still an edge in the module graph — is compiled into the Cloudflare Worker
 * script, whether or not it could ever run there. MEASURED on the production
 * build before these doors existed:
 *
 *   pdfjs-dist   chunks/5361.js  1,205,959 B  + chunks/7677.js  471,799 B
 *                plus the 1,205,338 B pdf.worker asset emitted beside them
 *   mammoth      chunks/7733.js    490,276 B
 *   pdf-lib      chunks/8478.js    421,881 B   (the SSR-layer duplicate of the
 *                                               legitimate route-handler copy)
 *
 * The Worker parses its whole script on a cold start, so those bytes are paid
 * by every request that lands on a cold isolate — including a nurse opening
 * her document list on Moroccan mobile data.
 *
 * The fix is `next/dynamic` with `ssr: false`, which is the ONE thing that
 * removes a module from the server compilation. The win is all-or-nothing: a
 * single surviving static edge from any client page pulls the whole library
 * back in, and nothing about the app would look broken — it would only get
 * slower again, silently. That is what this file exists to catch.
 */

const ROOTS = ["app", "components", "lib"] as const;

/** Every source file in the app, with comments blanked (offsets preserved) so
 *  a prose mention of an import cannot be mistaken for the real thing. */
function sourceFiles(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const raw = fs.readFileSync(p, "utf8");
      out.push({
        file: p.replace(/\\/g, "/"),
        code: raw
          .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
          .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length)),
      });
    }
  };
  for (const r of ROOTS) walk(path.join(process.cwd(), r));
  return out;
}

const FILES = sourceFiles();

/** A STATIC import of `spec` — `import x from "spec"` or `import "spec"`.
 *  A dynamic `import("spec")` deliberately does NOT match: it is a different
 *  kind of edge, and for the doors below it is the sanctioned one. */
function staticallyImports(code: string, spec: string): boolean {
  const q = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\r\\n])\\s*import\\s(?:[^;]*?\\sfrom\\s)?\\s*["']${q}["']`).test(code);
}

/** A static import that only carries TYPES is erased by the compiler and costs
 *  no bytes, so it is allowed everywhere. */
function staticallyImportsValue(code: string, spec: string): boolean {
  const q = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = code.match(new RegExp(`(^|[\\r\\n])\\s*import\\s([^;]*?)\\sfrom\\s*["']${q}["']`));
  if (!m) return staticallyImports(code, spec);
  const clause = m[2].trim();
  if (clause.startsWith("type ")) return false;              // import type { X } from …
  // `import { type A, type B } from …` — every named binding is a type.
  const named = clause.match(/^\{([\s\S]*)\}$/);
  if (named) {
    const parts = named[1].split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length > 0 && parts.every(p => p.startsWith("type "))) return false;
  }
  return true;
}

describe("browser-only libraries stay out of the server build", () => {
  /** door → the implementation it is the only static-import-free path to. */
  const DOORS: Record<string, string> = {
    "components/PdfViewer.tsx":        "@/components/PdfViewerImpl",
    "components/PdfPageOrganizer.tsx": "@/components/PdfPageOrganizerImpl",
    "components/DocxViewer.tsx":       "@/components/DocxViewerImpl",
  };

  for (const [door, impl] of Object.entries(DOORS)) {
    it(`${door} loads its implementation with ssr:false`, () => {
      const code = FILES.find(f => f.file.endsWith(door))!.code;
      // `ssr: false` is the whole point — without it the implementation is
      // compiled for SSR and the library rides along.
      expect(code, `${door} must pass ssr: false to next/dynamic`).toMatch(/ssr\s*:\s*false/);
      expect(code).toMatch(/\bdynamic\s*\(/);
      expect(
        staticallyImports(code, impl),
        `${door} must reach ${impl} only through dynamic(), never a static import`,
      ).toBe(false);
    });

    it(`nothing else statically imports ${impl}`, () => {
      const offenders = FILES
        .filter(f => !f.file.endsWith(door) && staticallyImportsValue(f.code, impl))
        .map(f => f.file);
      expect(
        offenders,
        `${impl} must be reached through ${door}; a static import from elsewhere puts its library back in the Worker script`,
      ).toEqual([]);
    });
  }

  /**
   * The admin panel is the other half of the same cut. pdf-lib was 421,901 B
   * of its FIRST-LOAD client bundle (static/chunks/3394-*.js — pure pdf-lib,
   * no app code) on top of the server copy, for flows that are switched off
   * today (SIGN_FILL_ENABLED). These three are the edges that carried it.
   */
  it("the admin page reaches pdf-lib only at the moment it stamps a PDF", () => {
    const admin = FILES.find(f => f.file.endsWith("app/portal/admin/page.tsx"))!;
    for (const spec of ["@/lib/stampSigOnPdf", "@/lib/pdfAcroFormFill", "@/components/AutoFillReviewModal"]) {
      expect(
        staticallyImportsValue(admin.code, spec),
        `app/portal/admin/page.tsx must not statically import ${spec} — it drags pdf-lib into both bundles`,
      ).toBe(false);
    }
  });

  it("the candidate dashboard reaches pdf-lib only inside the fill-form flow", () => {
    const dash = FILES.find(f => f.file.endsWith("app/portal/dashboard/page.tsx"))!;
    for (const spec of ["@/lib/stampSigOnPdf", "@/lib/pdfAcroFormFill", "@/lib/pdfFieldEmbed",
                        "@/components/PdfFieldFill", "@/components/PdfNativeFieldFill"]) {
      expect(
        staticallyImportsValue(dash.code, spec),
        `app/portal/dashboard/page.tsx must not statically import ${spec} — a nurse on mobile data pays for it before she sees her documents`,
      ).toBe(false);
    }
  });
});
