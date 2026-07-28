import { describe, it, expect } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { safeRotatePdf } from "../lib/pdfRotate";

/**
 * ROTATION HAS TO STICK.
 *
 * safeRotatePdf used to reject its own output whenever it came back under half
 * the size of the input:
 *
 *     if (out.length < 1024 || out.length < original.length * 0.5) return original;
 *
 * That fires on ordinary documents. A scanner writes a verbose, flat PDF;
 * pdf-lib's default save() packs objects into object streams and can easily
 * halve it. So the server stored rotation=90 in the database and handed back
 * the UNROTATED original. The admin rotated a Pflegediplom, it looked right,
 * they reopened it, and it was sideways again — with no setting that could fix
 * it, because nothing was actually wrong with their input.
 *
 * The guard existed to protect passports from a destructive re-save (LAW #39).
 * That job now belongs upstream: every call site computes `effectiveRotation`
 * as 0 when isPassportFileType(fileType), so this function is never handed a
 * passport with a real rotation. The size check protected nothing and broke the
 * feature.
 *
 * These pin the behaviour, not the implementation: rotation persists, content
 * survives, and a genuinely broken input still falls back to the original.
 */

/** A PDF padded so its re-save is far under half the input size — exactly the
 *  shape that tripped the old guard. Trailing bytes after %%EOF are legal and
 *  parsers ignore them, so this stays a valid document. */
async function bloatedPdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  const base = await doc.save();
  const padding = Buffer.alloc(400 * 1024, 0x20); // 400 KB of spaces
  return Buffer.concat([Buffer.from(base), padding]);
}

const firstPageAngle = async (buf: Buffer): Promise<number> => {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  return doc.getPages()[0].getRotation().angle;
};

describe("safeRotatePdf", () => {
  it("PERSISTS the rotation on a file whose re-save shrinks past half — the actual bug", async () => {
    const original = await bloatedPdf();
    const out = await safeRotatePdf(original, 90);

    expect(out.length, "the old guard returned the original here").not.toBe(original.length);
    expect(await firstPageAngle(out), "rotation must survive the round-trip").toBe(90);
    expect(out.length / original.length, "and it really is a big shrink").toBeLessThan(0.5);
  });

  it("rotates every page, not just the first", async () => {
    const out = await safeRotatePdf(await bloatedPdf(3), 90);
    const doc = await PDFDocument.load(out, { ignoreEncryption: true });
    expect(doc.getPageCount()).toBe(3);
    for (const p of doc.getPages()) expect(p.getRotation().angle).toBe(90);
  });

  it("adds to an existing rotation and wraps at 360", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).setRotation(degrees(270));
    const out = await safeRotatePdf(Buffer.from(await doc.save()), 90);
    expect(await firstPageAngle(out), "270 + 90 wraps to 0").toBe(0);
  });

  it("is a no-op at 0 — the bytes come back untouched", async () => {
    const original = await bloatedPdf();
    expect(await safeRotatePdf(original, 0)).toBe(original);
  });

  it("returns the ORIGINAL rather than erasing anything it cannot parse", async () => {
    const junk = Buffer.from("this is not a pdf at all");
    expect(await safeRotatePdf(junk, 90)).toBe(junk);
    const empty = Buffer.alloc(0);
    expect(await safeRotatePdf(empty, 90)).toBe(empty);
  });

  it("keeps page content through the rotate — a rotate must never blank a document", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.drawText("Pflegediplom", { x: 60, y: 700, size: 24 });
    const original = Buffer.from(await doc.save());

    const out = await safeRotatePdf(original, 90);
    const reloaded = await PDFDocument.load(out, { ignoreEncryption: true });
    expect(reloaded.getPageCount()).toBe(1);
    // Content streams survived: the output still carries real page data rather
    // than an empty shell.
    expect(out.length).toBeGreaterThan(1024);
    expect(reloaded.getPages()[0].getRotation().angle).toBe(90);
  });
});
