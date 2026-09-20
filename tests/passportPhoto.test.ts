import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { translations } from "../lib/translations";

/**
 * A CANDIDATE MAY PHOTOGRAPH HER PASSPORT.
 *
 * She has a phone, not a scanner. The picker offered "Take Photo", she took
 * one, and a client-side list refused it before a single byte left the phone —
 * so the report reads "I cannot upload my passport" with nothing whatsoever in
 * the server log, because no request was ever made.
 *
 * The widening stops at the passport ON PURPOSE. Every other box is half of an
 * original/translated pair that both sides merge through pdf-lib, which cannot
 * read a JPEG. These assertions pin BOTH halves: the passport accepts a photo,
 * and the rest do not, so nobody "tidies up" the asymmetry without first
 * teaching the merge to rasterise.
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

describe("the passport box accepts a phone photo", () => {
  it("the client allow-list for the passport carries JPEG and PNG beside PDF", () => {
    const allowed = list(DASHBOARD, "ALLOWED_ID");
    expect(allowed).toContain('"application/pdf"');
    expect(allowed, "a photographed passport is the common case").toContain('"image/jpeg"');
    expect(allowed).toContain('"image/png"');
  });

  it("the passport key is routed to that list, not to the PDF-only one", () => {
    expect(DASHBOARD).toContain('const ID_KEYS = ["id"];');
    expect(
      DASHBOARD,
      "handleFile must pick ALLOWED_ID for the passport key",
    ).toMatch(/ID_KEYS\.includes\(key\)\s*\?\s*ALLOWED_ID/);
  });

  it("the server agrees — no client can send what the route refuses", () => {
    const serverAllowed = list(UPLOAD_ROUTE, "ALLOWED_ID");
    for (const mime of ['"application/pdf"', '"image/jpeg"', '"image/png"']) {
      expect(serverAllowed, `server ALLOWED_ID must carry ${mime}`).toContain(mime);
    }
    expect(UPLOAD_ROUTE).toMatch(/fileKey === "id" && !ALLOWED_ID\.includes\(file\.type\)/);
  });

  it("the picker offers a photo for the passport and only PDF elsewhere", () => {
    // Offering "Take Photo" on a box that then refuses the photo IS the bug.
    expect(DASHBOARD).toMatch(/ID_KEYS\.includes\(activeKey\)\s*\n?\s*\?\s*"\.pdf,\.jpg,\.jpeg,\.png,\.webp"/);
    // \r? — this repository is checked out with CRLF on Windows, and a bare \n
    // made the assertion fail on the UNMODIFIED file: the line really does end
    // `".pdf"\r\n`. A source-scanning test must match the bytes the checkout
    // actually has, or it reports a regression that is not there and everyone
    // learns to ignore a red suite.
    expect(DASHBOARD, "every other box must ask for a PDF only").toMatch(/:\s*"\.pdf"\r?\n/);
  });

  it("LAW #19: the refusal message exists in all three languages", () => {
    for (const lang of ["fr", "en", "de"] as const) {
      const msg = translations[lang].pErrIdTypes;
      expect(msg, `pErrIdTypes missing for ${lang}`).toBeTruthy();
      expect(msg.length, `pErrIdTypes too short for ${lang}`).toBeGreaterThan(10);
    }
    const uniq = new Set(["fr", "en", "de"].map(l => translations[l as "fr"].pErrIdTypes));
    expect(uniq.size, "each language needs its own wording, not one copied string").toBe(3);
    expect(DASHBOARD, "the message must actually be rendered").toContain("t.pErrIdTypes");
  });
});

describe("the widening stops at the passport", () => {
  it("every other document box still refuses an image", () => {
    const pdfOnly = list(DASHBOARD, "ALLOWED_PDF_ONLY");
    expect(pdfOnly).toContain('"application/pdf"');
    expect(
      pdfOnly,
      "widening this list breaks merge-pdf: pdf-lib cannot load a JPEG, and the " +
      "caller turns the throw into a bare 500. Rasterise in merge-pdf first.",
    ).not.toContain("image/");
  });

  it("the reason is still true — merge-pdf really does parse both sides with pdf-lib", () => {
    // If this ever stops being true, the restriction above can be revisited.
    expect(MERGE_ROUTE).toContain("PDFDocument.load(transBytes)");
    expect(MERGE_ROUTE).toContain("PDFDocument.load(origBytes)");
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
