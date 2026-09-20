/**
 * Merge an original/translated document pair into ONE PDF -- when either half
 * may be a PHOTOGRAPH.
 *
 * A qualification document is half of a pair, and both the admin panel and the
 * candidate dashboard offer the pair as a single merged download. That merge
 * used to be two bare `PDFDocument.load()` calls, which is why the upload boxes
 * had to stay PDF-only: pdf-lib cannot parse a JPEG, so a photographed diploma
 * would have thrown into a bare 500 "Merge failed" -- a fresh silent failure in
 * the very feature that was meant to end them.
 *
 * So an image half becomes a PAGE instead of an error. pdf-lib can embed JPEG
 * and PNG directly; the picture is centred on an A4-ish page in its own
 * orientation, keeping its aspect ratio, so a photographed certificate prints
 * like the scan it replaces.
 *
 * WHAT IT REFUSES, and why refusing beats guessing:
 *   - WebP. pdf-lib has no WebP embedder and the Workers runtime has no image
 *     decoder to transcode with (no canvas, no sharp), so the only honest
 *     options were "pull in a WebP decoder" or "say so". It says so, and the
 *     caller turns that into a translated message telling her to download the
 *     two files separately. A phone camera writes JPEG; WebP only arrives from
 *     an image saved off the web, so this costs almost no one anything.
 *   - A PNG above PNG_MEGAPIXEL_LIMIT. See lib/docBytes.ts pngPixelCount: the
 *     decode alone can exceed the isolate's memory, and an OOM has no status
 *     code at all.
 *   - Bytes that are neither PDF nor a supported image, including a file whose
 *     structure pdf-lib chokes on. Better a 415 that names the problem than a
 *     500 that names nothing.
 *
 * Kept free of auth, Supabase and R2 so the merge itself can be tested with
 * real bytes -- the route wires the IO around it.
 */

import { PDFDocument, degrees, type PDFPage } from "pdf-lib";
import { detectDocKind, pngPixelCount, type DocKind } from "@/lib/docBytes";

/** A4 at 72 dpi, portrait. */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

/**
 * ~6 mm of white around a photographed page. Not decoration: a scan printed
 * flush to the trim edge loses its outermost millimetres on most printers, and
 * these documents get printed by German employers.
 */
export const IMAGE_PAGE_MARGIN_PT = 18;

/** See lib/docBytes.ts pngPixelCount for why this ceiling exists. */
export const PNG_MEGAPIXEL_LIMIT = 8;

export type MergeSource = {
  bytes: Uint8Array;
  /** Degrees clockwise, from documents.rotation. 0 when unset. */
  rotation?: number;
};

export type MergeRefusalCode = "unsupported_format" | "image_too_large" | "unreadable";

export type MergeResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; code: MergeRefusalCode; kind: DocKind; megapixels?: number };

/**
 * Page size for a picture: A4 in the picture's OWN orientation.
 *
 * A landscape photo on a portrait page shrinks to a band across the middle at
 * roughly half the readable size -- and a certificate photographed sideways is
 * common, because that is how the paper is shaped.
 */
export function imagePageSize(imgWidth: number, imgHeight: number): [number, number] {
  return imgWidth > imgHeight
    ? [A4_HEIGHT_PT, A4_WIDTH_PT]
    : [A4_WIDTH_PT, A4_HEIGHT_PT];
}

/**
 * Largest centred rectangle with the picture's aspect ratio that fits inside
 * the page's margins.
 *
 * It deliberately scales UP a small picture as well as down. These pages are
 * read, not composed: a 600 px photo of a diploma sitting stamp-sized in the
 * corner of an A4 sheet is useless, while the same photo filling the sheet is
 * merely soft. Aspect ratio is never traded away -- a stretched document reads
 * as a forgery.
 */
export function fitContain(
  imgWidth: number,
  imgHeight: number,
  pageWidth: number,
  pageHeight: number,
  margin: number = IMAGE_PAGE_MARGIN_PT,
): { x: number; y: number; width: number; height: number } {
  const maxW = Math.max(1, pageWidth - margin * 2);
  const maxH = Math.max(1, pageHeight - margin * 2);
  const scale = Math.min(maxW / imgWidth, maxH / imgHeight);
  const width = imgWidth * scale;
  const height = imgHeight * scale;
  return { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

/** documents.rotation is applied the same way to a copied page and a new one. */
function applyRotation(page: PDFPage, rotation: number | undefined): void {
  const rot = (((rotation ?? 0) % 360) + 360) % 360;
  if (!rot) return;
  const current = page.getRotation().angle;
  page.setRotation(degrees((current + rot) % 360));
}

/**
 * Merge the given sources, in order, into a single PDF.
 *
 * Each source contributes its pages (a PDF) or exactly one page (an image).
 * Returns a refusal rather than throwing, so no caller can turn a predictable
 * "this format cannot be merged" into an opaque 500.
 */
export async function mergeDocumentsToPdf(sources: MergeSource[]): Promise<MergeResult> {
  // Check every source BEFORE building anything. Refusing on source two after
  // embedding source one would have allocated the memory the PNG ceiling exists
  // to protect, and would make the refusal depend on the pair's order.
  for (const src of sources) {
    const kind = detectDocKind(src.bytes);
    if (kind === "webp" || kind === "other") {
      return { ok: false, code: "unsupported_format", kind };
    }
    if (kind === "png") {
      const px = pngPixelCount(src.bytes);
      if (px !== null && px > PNG_MEGAPIXEL_LIMIT * 1_000_000) {
        return { ok: false, code: "image_too_large", kind, megapixels: px / 1_000_000 };
      }
    }
  }

  const merged = await PDFDocument.create();

  for (const src of sources) {
    const kind = detectDocKind(src.bytes);
    try {
      if (kind === "pdf") {
        const doc = await PDFDocument.load(src.bytes);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        for (const page of pages) {
          applyRotation(page, src.rotation);
          merged.addPage(page);
        }
        continue;
      }

      const image = kind === "jpeg"
        ? await merged.embedJpg(src.bytes)
        : await merged.embedPng(src.bytes);
      const [pageWidth, pageHeight] = imagePageSize(image.width, image.height);
      const page = merged.addPage([pageWidth, pageHeight]);
      const box = fitContain(image.width, image.height, pageWidth, pageHeight);
      page.drawImage(image, box);
      applyRotation(page, src.rotation);
    } catch {
      // A file that passed the magic-number check can still be structurally
      // broken -- a truncated upload, an encrypted PDF, a progressive JPEG no
      // embedder will take. That is still a fact about the file, not a server
      // fault, so it gets a message instead of a 500.
      return { ok: false, code: "unreadable", kind };
    }
  }

  return { ok: true, bytes: await merged.save() };
}
