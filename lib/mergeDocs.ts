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
import {
  detectDocKind, pngPixelCount, readJpegOrientation, exifOrientationRotationCw,
  type DocKind, type MergeRefusalCode,
} from "@/lib/docBytes";

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

/**
 * Ceiling on the two halves TOGETHER.
 *
 * Each upload is capped at its own size, but nothing capped the pair, and a
 * merge holds both parsed documents, the copied pages and the saved output at
 * once -- several times the input in peak memory, inside a 128 MB isolate that
 * dies with no status code at all.
 *
 * It lives HERE rather than in the route because the route's own copy of this
 * rule answered with a hand-rolled body whose code was in no shared list, so
 * the refusal reached the screen as "Download failed - please try again" (see
 * MERGE_REFUSAL_CODES in lib/docBytes.ts). One refusal path, one vocabulary.
 */
export const MAX_COMBINED_BYTES = 16 * 1024 * 1024;

export type MergeSource = {
  bytes: Uint8Array;
  /** Degrees clockwise, from documents.rotation. 0 when unset. */
  rotation?: number;
};

// The codes themselves live in lib/docBytes.ts, which has no dependencies, so
// the dashboard and the admin panel can recognise a refusal without dragging
// pdf-lib into the client bundle to do it.
export type { MergeRefusalCode };

export type MergeResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; code: MergeRefusalCode; kind: DocKind; megapixels?: number; megabytes?: number };

/**
 * HTTP status for a refusal. 413 when the answer is "this is too big", 415 when
 * it is "this is the wrong kind of file".
 *
 * Exported so the route cannot drift: it used to spell the mapping inline as a
 * single ternary on one code, which is how "too_large" ended up answered by a
 * separate hand-written branch that no client could recognise.
 */
export function refusalStatus(code: MergeRefusalCode): 413 | 415 {
  return code === "image_too_large" || code === "too_large" ? 413 : 415;
}

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

/**
 * Where to draw a picture, and how far to turn it, so that EXIF orientation is
 * honoured on the page.
 *
 * `box` is the rectangle the picture should END UP filling, in the page's own
 * coordinates, already measured in DISPLAY dimensions (width and height
 * swapped for a quarter turn). This returns the arguments pdf-lib's drawImage
 * needs to land exactly there.
 *
 * Why the offsets: drawImage rotates about its (x, y) corner, not about the
 * centre, so a turned image walks off the page unless x/y are moved to the
 * corner the rotation sweeps FROM. pdf-lib's angle is counter-clockwise in PDF
 * user space, while EXIF speaks clockwise as seen on screen -- hence the
 * (360 - cw) conversion. Getting that sign wrong turns a sideways diploma the
 * wrong way twice, which looks like the original bug.
 *
 * Pure, and exported, because this is the arithmetic worth pinning: a rotated
 * page that is merely off-centre still "works" on screen and is very hard to
 * notice in a merged dossier.
 */
export function imageDrawPlacement(
  box: { x: number; y: number; width: number; height: number },
  cw: 0 | 90 | 180 | 270,
): { x: number; y: number; width: number; height: number; rotate: number } {
  // The picture's own (unrotated) extent: a quarter turn swaps it back.
  const natW = cw % 180 === 90 ? box.height : box.width;
  const natH = cw % 180 === 90 ? box.width : box.height;
  const rotate = (360 - cw) % 360;
  switch (cw) {
    case 90:  return { x: box.x,             y: box.y + box.height, width: natW, height: natH, rotate };
    case 180: return { x: box.x + box.width, y: box.y + box.height, width: natW, height: natH, rotate };
    case 270: return { x: box.x + box.width, y: box.y,              width: natW, height: natH, rotate };
    default:  return { x: box.x,             y: box.y,              width: natW, height: natH, rotate: 0 };
  }
}

/**
 * The rotation a photograph needs before anyone looks at it.
 *
 * A phone writes the sensor's landscape frame plus an EXIF tag; the browser
 * obeys the tag, so the preview is upright, and pdf-lib does not, so the merged
 * copy the employer receives lies on its side. Reading it here is what keeps
 * those two views of the same file in agreement.
 */
export function sourceExifRotationCw(bytes: Uint8Array, kind: DocKind): 0 | 90 | 180 | 270 {
  return kind === "jpeg" ? exifOrientationRotationCw(readJpegOrientation(bytes)) : 0;
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
  // The PAIR, not each half. Nothing capped the two together, and an isolate
  // that runs out of memory answers with nothing at all -- which is the
  // failure this module exists to remove. Checked first because it is the
  // cheapest refusal there is: no parsing, no embedder, just two lengths.
  const combined = sources.reduce((n, s) => n + s.bytes.length, 0);
  if (combined > MAX_COMBINED_BYTES) {
    return {
      ok: false,
      code: "too_large",
      kind: detectDocKind(sources[0]?.bytes ?? new Uint8Array(0)),
      megabytes: combined / 1_048_576,
    };
  }

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
      // EXIF first, because it decides what the picture's dimensions even ARE.
      // image.width/height come from the JPEG's own frame header, which for a
      // phone photo is the sensor's landscape frame regardless of how the phone
      // was held; a quarter turn swaps them, and the PAGE has to swap with them
      // or a portrait diploma gets a landscape sheet and half the readable size.
      const exifCw = sourceExifRotationCw(src.bytes, kind);
      const quarter = exifCw % 180 === 90;
      const shownW = quarter ? image.height : image.width;
      const shownH = quarter ? image.width  : image.height;
      const [pageWidth, pageHeight] = imagePageSize(shownW, shownH);
      const page = merged.addPage([pageWidth, pageHeight]);
      const box = fitContain(shownW, shownH, pageWidth, pageHeight);
      // imageDrawPlacement returns the angle as a plain number so the geometry
      // can be tested without pdf-lib; drawImage wants its Rotation wrapper.
      const placed = imageDrawPlacement(box, exifCw);
      page.drawImage(image, { ...placed, rotate: degrees(placed.rotate) });
      // documents.rotation stays on top, as a page rotation, exactly as it is
      // for a PDF half. It is what the admin chose while LOOKING at the
      // EXIF-corrected preview, so it composes with the EXIF turn rather than
      // replacing it.
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
