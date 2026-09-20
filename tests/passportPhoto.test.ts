import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { translations } from "../lib/translations";

/**
 * A CANDIDATE MAY PHOTOGRAPH HER DOCUMENTS.
 *
 * She has a phone, not a scanner. The picker offered "Take Photo", she took
 * one, and a client-side list refused it before a single byte left the phone —
 * so the report reads "I cannot upload my passport" with nothing whatsoever in
 * the server log, because no request was ever made.
 *
 * The widening stopped at the passport at first, because every other box is
 * half of an original/translated pair that both sides merge through pdf-lib,
 * which cannot read a JPEG. That blocker is gone: merge-pdf now goes through
 * lib/mergeDocs.ts, which turns a photo into a page, and the rest of the
 * PDF-assuming paths are swept in tests/photoDocPaths.test.ts. Every box takes
 * a photo now, and these pin it — including the passport keeping its own
 * wording, because it is the one box the onboarding tour tells her to start
 * with.
 */
const DASHBOARD = readFileSync("app/portal/dashboard/page.tsx", "utf8");
const UPLOAD_ROUTE = readFileSync("app/api/portal/upload/route.ts", "utf8");
const MERGE_ROUTE = readFileSync("app/api/portal/documents/merge-pdf/route.ts", "utf8");

/** The array literal assigned to `name`, e.g. `const NAME = [ … ];`. */
function list(src: string, name: string): string {
  const at = src.indexOf(`const ${name} = [`);
  if (at < 0) throw new Error(`${name} not found — was it renamed?`);
  const open = src.indexOf("[", at);
  const close = src.indexOf("]", open);
  return src.slice(open + 1, close);
}

describe("every document box accepts a phone photo", () => {
  it("the client allow-list carries JPEG, PNG and WebP beside PDF", () => {
    const allowed = list(DASHBOARD, "ALLOWED_DOC");
    expect(allowed).toContain('"application/pdf"');
    expect(allowed, "a photographed document is the common case").toContain('"image/jpeg"');
    expect(allowed).toContain('"image/png"');
    expect(allowed).toContain('"image/webp"');
  });

  it("there is no PDF-only list left for a box to fall back to", () => {
    expect(DASHBOARD).toContain('const ID_KEYS = ["id"];');
    expect(
      DASHBOARD,
      "Sonstiges additionally takes Word; every other box shares ALLOWED_DOC",
    ).toMatch(/OTHER_KEYS\.includes\(key\) \? ALLOWED_ALL : ALLOWED_DOC/);
    expect(
      DASHBOARD,
      "the PDF-only list must be gone, not merely unused — a dead branch is how it comes back",
    ).not.toContain("ALLOWED_PDF_ONLY");
  });

  it("Sonstiges keeps Word on top of everything else", () => {
    const all = list(DASHBOARD, "ALLOWED_ALL");
    expect(all, "it builds on the shared list rather than repeating it").toContain("...ALLOWED_DOC");
    expect(all).toContain('"application/msword"');
  });

  it("the server agrees — no client can send what the route refuses", () => {
    const serverAllowed = list(UPLOAD_ROUTE, "ALLOWED_TYPES");
    for (const mime of ['"application/pdf"', '"image/jpeg"', '"image/png"', '"image/webp"']) {
      expect(serverAllowed, `server ALLOWED_TYPES must carry ${mime}`).toContain(mime);
    }
    expect(UPLOAD_ROUTE).toMatch(/fileKey === "id" && !ALLOWED_ID\.includes\(file\.type\)/);
  });

  it("the picker offers a photo on every box", () => {
    // `accept=".pdf"` does not merely filter the list: on iOS and Android it
    // removes Camera and Photo Library from the picker entirely, so the photo
    // could not even be chosen. Offering "Take Photo" on a box that then
    // refuses the photo is the same bug wearing the other hat.
    expect(DASHBOARD, "Sonstiges keeps Word on top")
      .toContain('".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"');
    expect(DASHBOARD, "every other box takes a photo too")
      .toMatch(/:\s*"\.pdf,\.jpg,\.jpeg,\.png,\.webp"\r?\n/);
    expect(DASHBOARD, "no box may ask for a PDF alone any more")
      .not.toMatch(/\?\s*"\.pdf"\r?\n/);
  });
});

describe("LAW #19: every refusal exists in all three languages", () => {
  const keys = ["pErrIdTypes", "pErrDocTypes", "pErrMergeFormat"] as const;

  for (const key of keys) {
    it(`${key} is written in French, English and German`, () => {
      for (const lang of ["fr", "en", "de"] as const) {
        const msg = translations[lang][key];
        expect(msg, `${key} missing for ${lang}`).toBeTruthy();
        expect(msg.length, `${key} too short for ${lang}`).toBeGreaterThan(10);
      }
      const uniq = new Set(["fr", "en", "de"].map(l => translations[l as "fr"][key]));
      expect(uniq.size, "each language needs its own wording, not one copied string").toBe(3);
    });
  }

  it("and each one is actually rendered", () => {
    for (const key of keys) {
      expect(DASHBOARD, `${key} is declared but never shown`).toContain(`t.${key}`);
    }
  });

  it("the passport keeps its own wording", () => {
    // It is the one box the onboarding tour tells her to start with, so naming
    // it in the message is worth the extra string.
    expect(DASHBOARD).toMatch(/ID_KEYS\.includes\(key\) \? "errIdTypes"/);
    expect(translations.en.pErrIdTypes.toLowerCase()).toContain("passport");
  });

  it("the admin is told the same thing about a pair that cannot be merged", () => {
    for (const lang of ["fr", "en", "de"] as const) {
      expect(translations[lang].adErrMergeFormat.length).toBeGreaterThan(10);
    }
  });
});

describe("what made the widening safe", () => {
  it("merge-pdf no longer parses either half with pdf-lib itself", () => {
    expect(MERGE_ROUTE).not.toContain("PDFDocument.load(transBytes)");
    expect(MERGE_ROUTE).not.toContain("PDFDocument.load(origBytes)");
    expect(MERGE_ROUTE).toContain("mergeDocumentsToPdf(");
  });

  it("LAW #39: a passport is never re-saved by pdf-lib, whatever its format", () => {
    // The page-count probe is the only pdf-lib touch on an upload. It must stay
    // gated on the bytes actually being a PDF, and must never save.
    expect(UPLOAD_ROUTE).toMatch(
      /\(sniffedType \?\? file\.type\) === "application\/pdf"[\s\S]{0,400}?PDFDocument\.load\(buffer/,
    );
    const probe = UPLOAD_ROUTE.slice(
      UPLOAD_ROUTE.indexOf("PDFDocument.load(buffer"),
      UPLOAD_ROUTE.indexOf("PDFDocument.load(buffer") + 300,
    );
    expect(probe, "the passport probe must read, never re-save").not.toContain(".save(");
  });
});
