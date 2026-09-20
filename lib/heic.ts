/**
 * HEIC / HEIF: recognise it, and refuse it with its OWN message.
 *
 * THE BUG. An iPhone that has never been switched to "Most Compatible" stores
 * photos as HEIC. Pick one through the photo library and iOS Safari transcodes
 * it to JPEG on the way into <input type="file">, which is why the passport box
 * works for most people. Pick the SAME photo through the Files app / "Browse"
 * (or share it in from another app) and the browser hands over the raw .heic.
 * Both the client allow-lists and the server's ALLOWED_TYPES then reject it as
 * "Type non autorise" / "PDF only" -- a sentence that is simply false for the
 * commonest phone on earth, and that gives her nothing to do next. She has a
 * perfectly good photo of her passport and the portal tells her the format is
 * wrong without saying which format would be right.
 *
 * THE DECISION: refuse, honestly and specifically. Not transcode.
 *
 * Transcoding would mean a HEVC decoder in the request path. The only practical
 * one for this runtime is libheif compiled to WASM (libheif-js / heic-decode),
 * which is several MB of WASM on top of a bundle whose size already costs every
 * route a 2-5s cold start, and it decodes to raw RGBA -- a 12 MP photo is
 * 12e6 * 4 = 48 MB of pixels before re-encoding, inside the same 128 MB isolate
 * that lib/ocrBudget.ts exists to defend. Trading a two-tap instruction for an
 * OOM on every phone photo is a bad trade, so the honest refusal wins.
 *
 * What she is told (the client owns the wording, LAW #19 -- FR/EN/DE -- keyed
 * off `code: "HEIC_UNSUPPORTED"`): the photo is in Apple's HEIC format; pick it
 * again from Photos / the camera roll instead of Files, and the iPhone hands
 * over a JPEG by itself. No settings change, no conversion app, no support
 * ticket.
 */

/** Error code the client switches its translated message on. */
export const HEIC_CODE = "HEIC_UNSUPPORTED";

/**
 * Fallback sentence for any caller that shows the raw `error` string (the
 * public /u upload page, curl, a log line). The localized version lives in the
 * portal; this is the one that must never be "PDF only".
 */
export const HEIC_MESSAGE =
  "HEIC (iPhone) photos cannot be read. Open Photos and pick the picture from your camera roll " +
  "instead of Files -- the iPhone then sends a JPEG automatically.";

const HEIC_MIMES = new Set([
  "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence",
  // Some Android file managers and older Safari builds send these for the same
  // bytes; all of them are ISO-BMFF with an HEVC payload we cannot decode.
  "image/x-heic", "image/x-heif",
]);

/**
 * ISO base-media brands that mean "HEIF container". A HEIC file starts with a
 * 4-byte box length, the literal "ftyp", then the major brand, e.g.
 *     00 00 00 18  66 74 79 70  68 65 69 63   ....ftypheic
 * `mif1` / `msf1` are the generic HEIF brands Samsung and Google Photos emit.
 * `avif`/`avis` are AV1, not HEVC, but they are equally undecodable here and
 * arrive from the same pickers, so they get the same honest answer.
 */
const HEIF_BRANDS = new Set([
  "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs",
  "mif1", "msf1", "avif", "avis",
]);

/**
 * Magic-byte check. Deliberately independent of the declared MIME type: a file
 * picked out of Files can arrive as `application/octet-stream` with no
 * extension hint at all, and `file.type` is attacker-controlled anyway.
 */
export function sniffHeic(head: Uint8Array | null | undefined): boolean {
  if (!head || head.length < 12) return false;
  if (head[4] !== 0x66 || head[5] !== 0x74 || head[6] !== 0x79 || head[7] !== 0x70) return false; // "ftyp"
  const brand = String.fromCharCode(head[8], head[9], head[10], head[11]).toLowerCase();
  if (HEIF_BRANDS.has(brand)) return true;
  // Not the major brand -- scan the compatible-brands list that follows it,
  // bounded by the ftyp box length so a crafted file cannot walk the buffer.
  const boxLen = (head[0] << 24 | head[1] << 16 | head[2] << 8 | head[3]) >>> 0;
  const end = Math.min(head.length, boxLen > 0 && boxLen <= 4096 ? boxLen : 64);
  for (let i = 16; i + 4 <= end; i += 4) {
    const b = String.fromCharCode(head[i], head[i + 1], head[i + 2], head[i + 3]).toLowerCase();
    if (HEIF_BRANDS.has(b)) return true;
  }
  return false;
}

/**
 * Is this upload an iPhone/Android HEIC or HEIF photo?
 *
 * Any one of the three signals is enough, because each fails on its own: the
 * MIME is missing when the pick came through Files, the name is missing when
 * the browser synthesises one, and the bytes are the only thing that is always
 * true -- but a caller that has not buffered them yet can still answer from the
 * other two.
 */
export function isHeicUpload(
  mime: string | null | undefined,
  fileName: string | null | undefined,
  head?: Uint8Array | null,
): boolean {
  if (mime && HEIC_MIMES.has(mime.toLowerCase().trim())) return true;
  if (fileName && /\.(heic|heif)$/i.test(fileName.trim())) return true;
  return sniffHeic(head);
}
