/**
 * Strict validator for `data:` image URLs accepted from user input
 * (chat attachments, profile photos, feed images, org logos).
 *
 * Why this exists:
 *   The naive check `url.startsWith("data:image/")` accepts
 *   `data:image/svg+xml,<svg onload="…">`. SVG can host JavaScript that
 *   executes when the file is opened in a new tab, embedded as an
 *   <object>/<iframe>, or rendered by any path that interprets SVG as a
 *   document. We reject SVG entirely and verify the base64 payload's
 *   magic bytes match the claimed raster MIME — closes both the script-
 *   injection vector and the MIME-spoofing vector.
 *
 * Allowed MIMEs: PNG, JPEG, WebP, GIF. Anything else (svg, html, video,
 * pdf, etc.) is rejected.
 */

const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// First-bytes signatures for each allowed format.
const MAGIC_BYTES: Array<{ mime: string; bytes: number[] }> = [
  { mime: "image/png",  bytes: [0x89, 0x50, 0x4e, 0x47] },                 // ‰PNG
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },                       // FFD8FF
  { mime: "image/gif",  bytes: [0x47, 0x49, 0x46, 0x38] },                 // GIF8
  // WebP files start with "RIFF" then 4 bytes of size then "WEBP"
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },                 // RIFF (header)
];

function bytesStartWith(buf: Buffer, prefix: number[]): boolean {
  if (buf.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (buf[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Validates a `data:image/<png|jpeg|webp|gif>;base64,<…>` URL.
 *
 * Returns { ok: true, mime, byteLength } when the URL is well-formed AND
 * the base64 payload's magic bytes match the claimed MIME.
 *
 * Returns { ok: false, reason } otherwise. `reason` is safe to log; do
 * NOT expose to the client beyond a generic 400.
 */
export function validateImageDataUrl(url: unknown): {
  ok: true; mime: string; bytes: Buffer; byteLength: number;
} | { ok: false; reason: string } {
  if (typeof url !== "string") return { ok: false, reason: "not a string" };

  // Shape: data:<mime>;base64,<payload>
  // Allow charset / extra parameters (e.g. ;name=foo) but require base64.
  const match = url.match(/^data:([a-z0-9+.\-/]+)(?:;[^,]+)*;base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return { ok: false, reason: "malformed data URL" };

  const mime    = match[1].toLowerCase();
  const payload = match[2];

  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    return { ok: false, reason: `disallowed mime: ${mime}` };
  }
  if (payload.length === 0) return { ok: false, reason: "empty payload" };

  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch {
    return { ok: false, reason: "base64 decode failed" };
  }
  if (bytes.length < 8) return { ok: false, reason: "payload too short" };

  // Magic-byte sniff. Catches a `data:image/png;base64,<jpeg-bytes>` spoof
  // where the attacker lies about the MIME to slip past the allowlist.
  const sig = MAGIC_BYTES.find(s => s.mime === mime);
  if (!sig) return { ok: false, reason: "no signature for mime" };

  if (mime === "image/webp") {
    // RIFF header at 0-3, "WEBP" at offset 8-11.
    if (!bytesStartWith(bytes, sig.bytes)) {
      return { ok: false, reason: "magic bytes mismatch (riff)" };
    }
    if (bytes.length < 12 ||
        bytes[8] !== 0x57 || bytes[9] !== 0x45 ||
        bytes[10] !== 0x42 || bytes[11] !== 0x50) {
      return { ok: false, reason: "magic bytes mismatch (webp)" };
    }
  } else if (!bytesStartWith(bytes, sig.bytes)) {
    return { ok: false, reason: "magic bytes mismatch" };
  }

  return { ok: true, mime, bytes, byteLength: bytes.length };
}
