import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { servedMime, isPdfBytes, detectDocKind } from "../lib/docBytes";
import { safeRotatePdf } from "../lib/pdfRotate";

/**
 * EVERY PATH THAT USED TO ASSUME "THIS DOCUMENT IS A PDF".
 *
 * Widening the upload boxes to photos is only safe once each of these either
 * handles an image or refuses it in words. A 500, a blank viewer and a silent
 * nothing are the three failure modes that brought us here: a candidate reports
 * "it does not work", and the log has nothing in it to look at.
 *
 * These are the sweep. Each one names the path and the failure it prevents.
 */

const FILE_ROUTE = readFileSync("app/api/portal/file/route.ts", "utf8");
const PAGES_ROUTE = readFileSync("app/api/portal/admin/pdf-pages/route.ts", "utf8");
const UPLOAD_ROUTE = readFileSync("app/api/portal/upload/route.ts", "utf8");
const PREVIEW_MODAL = readFileSync("components/AdminDocPreviewModal.tsx", "utf8");
const DASHBOARD = readFileSync("app/portal/dashboard/page.tsx", "utf8");

const jpeg = () => new Uint8Array(readFileSync("public/demande-example.jpg"));
const png = () => new Uint8Array(readFileSync("public/email-logo.png"));
const docx = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);

async function pdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 300]);
  return doc.save();
}

describe("serving a document: the bytes name themselves", () => {
  it("a photo is never announced as a PDF", async () => {
    // A JPEG served as application/pdf renders as a blank viewer, which reads
    // as "the portal is broken" rather than "this file is a photo".
    expect(servedMime(jpeg(), "application/pdf")).toBe("image/jpeg");
    expect(servedMime(png(), "application/pdf")).toBe("image/png");
    expect(servedMime(await pdfBytes(), "application/pdf")).toBe("application/pdf");
  });

  it("a stale stored label does not win over the bytes", () => {
    // Rows written before images were possible say "application/pdf" whatever
    // they hold, so the fallback is only consulted when the sniff found nothing.
    expect(servedMime(jpeg(), "application/pdf")).toBe("image/jpeg");
  });

  it("but an unrecognised type keeps the caller's label -- a DOCX stays a DOCX", () => {
    const word = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(detectDocKind(docx())).toBe("other");
    expect(servedMime(docx(), word)).toBe(word);
  });

  it("all three serving branches go through it", () => {
    // signed-storage, R2 and the legacy doc-cache mirror. Two of the three used
    // to hardcode "application/pdf".
    const uses = FILE_ROUTE.match(/servedMime\(/g) ?? [];
    expect(uses.length, "every branch must name the bytes it serves").toBe(3);
    expect(FILE_ROUTE, "no branch may hardcode the type again")
      .not.toMatch(/ctype\(req, "application\/pdf"\)/);
  });

  it("pdf-lib is never handed a photo to rotate", async () => {
    // safeRotatePdf swallows the failure and returns the original, so this was
    // never a crash -- just a wasted parse on every single photo served.
    expect(isPdfBytes(jpeg())).toBe(false);
    expect(isPdfBytes(await pdfBytes())).toBe(true);
    const rotates = FILE_ROUTE.match(/safeRotatePdf\(/g) ?? [];
    expect(rotates.length).toBe(3);
    expect(
      (FILE_ROUTE.match(/isPdfBytes\(/g) ?? []).length,
      "each safeRotatePdf call needs its own guard",
    ).toBe(3);
  });

  it("and if it ever is, the photo comes back byte-identical", async () => {
    // Belt and braces behind the guard above: rotation of a non-PDF must never
    // corrupt or drop the file.
    const src = Buffer.from(jpeg());
    const out = await safeRotatePdf(src, 90);
    expect(Buffer.compare(out, src)).toBe(0);
  });
});

describe("the page organiser", () => {
  it("is not offered for a photo at all", () => {
    // There is nothing to re-arrange in a single picture, and offering the
    // button on a box that then refuses IS the bug we are fixing everywhere.
    expect(PREVIEW_MODAL).toMatch(
      /const isPdf = \(doc\.file_name\?\.split\("\."\)\.pop\(\) \?\? ""\)\.toLowerCase\(\) === "pdf";/,
    );
    expect(PREVIEW_MODAL).toMatch(/canOrganize\s*=[\s\S]{0,160}?isPdf/);
  });

  it("and a direct call with a photo is told what it is, not that the file is broken", () => {
    // "Not a readable PDF" says the file is damaged when it is perfectly fine.
    const imgGate = PAGES_ROUTE.indexOf("isImageKind(kind)");
    const load = PAGES_ROUTE.indexOf("PDFDocument.load(srcBytes)");
    expect(imgGate, "the photo branch must exist").toBeGreaterThan(-1);
    expect(imgGate, "and must run before pdf-lib is asked to parse it").toBeLessThan(load);
    expect(PAGES_ROUTE).toContain("photo_not_pdf");
  });

  it("LAW #39: the passport refusal still runs before either of them", () => {
    const pass = PAGES_ROUTE.indexOf("isPassportFileType(doc.file_type)");
    const imgGate = PAGES_ROUTE.indexOf("isImageKind(kind)");
    expect(pass).toBeGreaterThan(-1);
    expect(pass).toBeLessThan(imgGate);
  });
});

describe("the upload route was never the problem", () => {
  it("it has accepted a photo for every box all along", () => {
    // The client gate was the only thing refusing them, which is why the
    // failure produced no server log at all.
    for (const mime of ['"image/jpeg"', '"image/png"', '"image/webp"']) {
      expect(UPLOAD_ROUTE, `ALLOWED_TYPES must carry ${mime}`).toContain(mime);
    }
  });

  it("OCR branches on the mime instead of assuming a PDF", () => {
    // A photographed passport goes to Vision images:annotate, which is the
    // better path for an MRZ than rasterising a PDF would be.
    expect(UPLOAD_ROUTE).toMatch(/mimeType === "application\/pdf"/);
    expect(UPLOAD_ROUTE).toContain("images:annotate");
  });

  it("the embedded-JPEG retry is skipped for a file that already is one", () => {
    expect(UPLOAD_ROUTE).toMatch(/!mrzData && file\.type === "application\/pdf"/);
  });
});

describe("previewing a photographed document", () => {
  it("the admin preview has a real image branch, not a fallback card", () => {
    expect(PREVIEW_MODAL).toMatch(/\["png", "jpg", "jpeg", "gif", "webp", "bmp"\]\.includes\(ext\)/);
  });

  it("the candidate dashboard has one too", () => {
    expect(DASHBOARD).toMatch(/\["png", "jpg", "jpeg", "gif", "webp", "bmp"\]\.includes\(ext\)/);
  });

  it("and an unknown extension still says so rather than showing nothing", () => {
    // The silent-nothing case: a blank pane with no explanation.
    expect(PREVIEW_MODAL).toContain("previewUnavailable");
  });
});
