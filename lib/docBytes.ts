/**
 * What are these bytes, really?
 *
 * Candidates upload from a PHONE. Now that the picker no longer says ".pdf", a
 * document can be a photograph, so every path that used to assume "the bytes
 * are a PDF" has to ask first. This module is the one place that answers, so
 * the answer cannot drift between the merge route, a preview and a download the
 * way three inline magic-byte checks would.
 *
 * Deliberately narrow: it only names the formats a *document* can be. The
 * upload route keeps its own richer sniffer (app/api/portal/upload/route.ts,
 * sniffMime) because its job is different -- it also recognises DOC/DOCX for the
 * Sonstiges box, and it exists to catch a spoofed `file.type` before anything is
 * stored. This one runs on bytes already in R2, where nothing is being claimed.
 *
 * Never use a stored Content-Type in its place. Rows written before images were
 * possible carry "application/pdf" unconditionally, and R2 metadata on old
 * objects is no better; the bytes are the only thing that cannot be stale.
 */

export type DocKind = "pdf" | "jpeg" | "png" | "webp" | "other";

/** Identify document bytes by magic number. "other" when unrecognised. */
export function detectDocKind(buf: Uint8Array): DocKind {
  if (buf.length < 4) return "other";
  // "%PDF"
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf";
  // JPEG: SOI followed by a marker -- FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "png";
  // WebP: "RIFF" then "WEBP" at offset 8
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "webp";
  return "other";
}

/** True for the picture formats a phone camera or gallery hands us. */
export function isImageKind(kind: DocKind): kind is "jpeg" | "png" | "webp" {
  return kind === "jpeg" || kind === "png" || kind === "webp";
}

/** The MIME type these bytes should be served as. */
export function mimeForKind(kind: DocKind): string {
  switch (kind) {
    case "pdf": return "application/pdf";
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

/**
 * Pixel count of a PNG, read from its IHDR header -- without decoding it.
 *
 * pdf-lib's embedPng DECOMPRESSES the entire image to RGBA before it can write
 * it into the PDF, so a 12-megapixel PNG costs ~48 MB of raw pixels, plus the
 * separate colour and alpha planes, plus the deflate buffers on top. The Worker
 * isolate has 128 MB and dies without a status code -- which reaches the
 * candidate as exactly the silent failure this work exists to remove. Callers
 * use this to refuse the file with a message BEFORE pdf-lib allocates anything.
 *
 * JPEG needs no such guard: embedJpg copies the compressed bytes straight into
 * a DCTDecode stream and only parses the header for its dimensions.
 *
 * Returns null when the bytes are not a PNG, or the header is truncated.
 */
export function pngPixelCount(buf: Uint8Array): number | null {
  if (detectDocKind(buf) !== "png") return null;
  // IHDR must be the first chunk: 8-byte signature, 4-byte length, 4-byte type,
  // then width and height as big-endian uint32.
  if (buf.length < 24) return null;
  const be32 = (o: number) =>
    ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
  const width = be32(16);
  const height = be32(20);
  if (!width || !height) return null;
  return width * height;
}

/**
 * What to call bytes we are about to send to a browser.
 *
 * A JPEG served as "application/pdf" is a BLANK VIEWER, which reads as "the
 * portal is broken" rather than "this file is a photo" -- and two of the three
 * branches in app/api/portal/file/route.ts used to answer "application/pdf"
 * unconditionally. So the bytes decide whenever they are recognisable.
 *
 * When they are not, the caller's own label wins: a DOCX in a Sonstiges box
 * comes back "other" here, and the stored content type still knows more about
 * it than a magic number that found nothing.
 */
export function servedMime(bytes: Uint8Array, fallback: string): string {
  const kind = detectDocKind(bytes);
  return kind === "other" ? fallback : mimeForKind(kind);
}

/** pdf-lib must never be handed bytes that are not a PDF. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  return detectDocKind(bytes) === "pdf";
}

/**
 * The reasons a pair of documents cannot be joined into one PDF.
 *
 * Declared HERE, in the module with no dependencies, rather than beside the
 * merging in lib/mergeDocs.ts -- that one imports pdf-lib, and the candidate
 * dashboard and the admin panel both need to recognise these codes in a fetch
 * response. Sharing the list is the point: three string literals copied into
 * two client files is how a refusal silently turns back into "Download failed,
 * please try again", which is the wrong advice for every one of them.
 *
 * "too_large" is the PAIR being too big together, and it belongs in this list
 * for a reason that cost a real message: the merge route answered it with a
 * hand-rolled `error: "too_large"` body that was never added here, so
 * isMergeRefusalCode() said false, and both the dashboard and the admin panel
 * fell through to "Download failed - please try again" — advice that can only
 * fail again, for a pair that will never fit. Every refusal the route can
 * return has to be nameable here or it reaches her as the wrong sentence.
 */
export const MERGE_REFUSAL_CODES = ["unsupported_format", "image_too_large", "too_large", "unreadable"] as const;

export type MergeRefusalCode = (typeof MERGE_REFUSAL_CODES)[number];

/** True when a merge response body carries one of those reasons. */
export function isMergeRefusalCode(code: unknown): code is MergeRefusalCode {
  return typeof code === "string" && (MERGE_REFUSAL_CODES as readonly string[]).includes(code);
}

/**
 * Can this half never be merged, judging by its file name alone?
 *
 * pdf-lib has no WebP embedder, so a WebP half is refused by the server on its
 * bytes. But the iOS download path NAVIGATES to the merge URL rather than
 * fetching it, so a refusal there lands as a JSON page in a tab that closes
 * itself -- the silent nothing again, on the phone where it matters most.
 * Saying it from the file name gets the answer in front of her on every device.
 * The server check stays: a name is a hint, bytes are the truth.
 */
export function nameCannotMerge(fileName: string | null | undefined): boolean {
  return /\.webp$/i.test(fileName ?? "");
}

/**
 * WHICH WAY UP IS THIS PHOTOGRAPH, REALLY?
 *
 * A phone camera does not turn the pixels when you turn the phone. It writes
 * the sensor's own landscape frame and adds an EXIF Orientation tag saying how
 * a viewer should turn it. Browsers obey that tag, so a photographed diploma
 * looks perfectly upright in the portal's preview -- and pdf-lib's JpegEmbedder
 * does not read EXIF at all, so the SAME file lands on its side in the merged
 * dossier the German employer receives, permanently, with nothing on screen
 * ever having hinted at it. That is this function's whole reason to exist.
 *
 * Returns the raw EXIF value 1..8, or null when there is no orientation tag
 * (most scans, every PNG) -- null and 1 both mean "leave it alone".
 *
 * Bounded on purpose: it walks JPEG segment headers only, stops at the first
 * APP1/Exif or at Start-of-Scan, and every read is guarded against a truncated
 * or hostile file. These bytes come from candidate uploads.
 */
export function readJpegOrientation(buf: Uint8Array): number | null {
  if (detectDocKind(buf) !== "jpeg") return null;
  const len = buf.length;
  let p = 2; // past the SOI marker
  while (p + 4 <= len) {
    if (buf[p] !== 0xff) { p++; continue; }   // resync: some writers pad segments
    const marker = buf[p + 1];
    if (marker === 0xff) { p++; continue; }   // fill byte, not a marker yet
    // Standalone markers carry no length word.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { p += 2; continue; }
    // Start of Scan: the compressed image begins here and EXIF never follows it.
    if (marker === 0xda) return null;
    const segLen = (buf[p + 2] << 8) | buf[p + 3];
    if (segLen < 2) return null;              // malformed; refuse to guess
    if (
      marker === 0xe1 && p + 10 <= len &&
      buf[p + 4] === 0x45 && buf[p + 5] === 0x78 && buf[p + 6] === 0x69 &&
      buf[p + 7] === 0x66 && buf[p + 8] === 0x00 && buf[p + 9] === 0x00
    ) {
      return readTiffOrientation(buf, p + 10, Math.min(len, p + 2 + segLen));
    }
    p += 2 + segLen;
  }
  return null;
}

/** IFD0 of the TIFF block inside an APP1/Exif segment. `base` is its first byte. */
function readTiffOrientation(buf: Uint8Array, base: number, end: number): number | null {
  if (base + 8 > end) return null;
  const little = buf[base] === 0x49 && buf[base + 1] === 0x49; // "II"
  const big    = buf[base] === 0x4d && buf[base + 1] === 0x4d; // "MM"
  if (!little && !big) return null;
  const u16 = (o: number) => (little ? buf[o] | (buf[o + 1] << 8) : (buf[o] << 8) | buf[o + 1]);
  const u32 = (o: number) =>
    (little
      ? buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)
      : (buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
  if (u16(base + 2) !== 42) return null;      // TIFF magic
  const ifd0 = base + u32(base + 4);
  // An offset that points outside the segment is a broken (or crafted) file,
  // not an orientation. Never walk off the buffer on a candidate's upload.
  if (ifd0 < base + 8 || ifd0 + 2 > end) return null;
  const entries = u16(ifd0);
  for (let i = 0; i < entries; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > end) return null;
    if (u16(e) !== 0x0112) continue;          // Orientation
    if (u16(e + 2) !== 3) return null;        // must be SHORT
    // A single SHORT sits in the first two bytes of the value field, under
    // either byte order.
    const v = u16(e + 8);
    return v >= 1 && v <= 8 ? v : null;
  }
  return null;
}

/**
 * The EXIF tag turned into plain clockwise degrees, which is what a page
 * actually needs.
 *
 * Orientations 2, 4, 5 and 7 also MIRROR the picture. We deliberately keep only
 * their rotation component: a mirrored certificate reads as a forgery, and a
 * mirrored scan is never what a camera meant -- those four values essentially
 * only appear from editing software. Rotating is the part that is always right.
 *
 * 5-8 are the quarter turns, which is why they are also the ones whose page has
 * to swap width and height.
 */
export function exifOrientationRotationCw(orientation: number | null | undefined): 0 | 90 | 180 | 270 {
  switch (orientation) {
    case 3: case 4: return 180;
    case 6: case 7: return 90;
    case 5: case 8: return 270;
    default: return 0;      // 1, 2, null, or anything we could not read
  }
}
