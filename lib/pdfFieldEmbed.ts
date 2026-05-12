import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type FormField = {
  id: string;
  page: number;  // 1-indexed
  x: number;     // 0–1 fraction of page width from left
  y: number;     // 0–1 fraction of page height from top
  w: number;     // 0–1 fraction of page width
  h: number;     // 0–1 fraction of page height
  label: string;
  type: "text" | "date" | "checkbox";
};

/**
 * Stamps filled field values into a PDF using pdf-lib.
 * Coordinates are in the zone-picker's top-left fractional space;
 * this fn converts to pdf-lib's bottom-left points space.
 */
export async function embedFields(
  pdfBytes: Uint8Array,
  fields: FormField[],
  values: Record<string, string>,
): Promise<Uint8Array> {
  const doc  = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const field of fields) {
    const val = values[field.id];
    if (!val && field.type !== "checkbox") continue;

    const page = pages[field.page - 1];
    if (!page) continue;

    const { width: pw, height: ph } = page.getSize();

    // Convert fractional top-left → pdf-lib bottom-left points
    const pdfX = field.x * pw;
    const pdfW = field.w * pw;
    const pdfH = field.h * ph;
    // pdf-lib y=0 is bottom; y increases upward
    const pdfY = (1 - field.y - field.h) * ph;

    const fontSize = Math.max(7, Math.min(14, pdfH * 0.55));

    if (field.type === "checkbox") {
      if (val === "true") {
        page.drawText("✓", {
          x: pdfX + pdfW / 2 - fontSize * 0.3,
          y: pdfY + (pdfH - fontSize) / 2,
          size: fontSize * 1.2,
          font,
          color: rgb(0, 0, 0),
        });
      }
    } else {
      page.drawText(val, {
        x: pdfX + 3,
        y: pdfY + (pdfH - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth: pdfW - 6,
      });
    }
  }

  return doc.save();
}
