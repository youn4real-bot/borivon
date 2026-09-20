/**
 * What the passport OCR pipeline is allowed to spend of a 128 MB isolate.
 *
 * WHY THIS FILE EXISTS -- the measurement, not a guess.
 * ----------------------------------------------------
 * A Cloudflare Worker isolate gets 128 MB, total, for the OpenNext bundle plus
 * everything the request allocates. POST /api/portal/upload used to hand the
 * WHOLE uploaded file to Azure Document Intelligence and then, on fallback, to
 * Google Vision (that fallback was removed on 2026-09-20), each time as
 * `buffer.toString("base64")` wrapped in
 * `JSON.stringify(...)`. Measured on node v22 with a 25 MB scan
 * (`process.memoryUsage().rss`, baseline 46.1 MB):
 *
 *     step                                      rss      delta over baseline
 *     file bytes (arrayBuffer + Buffer view)    71.6       +25.5
 *     buffer.toString("base64")                105.0       +58.9
 *     JSON.stringify({ base64Source })         138.3       +92.2
 *     utf8 encode of that JSON for the wire    171.7      +125.6   <- Azure alone
 *     ... then the Google Vision fallback      205.4      +159.3
 *
 * 125.6 MB above baseline for ONE call, on a 128 MB budget, before R2 or the
 * Supabase writes are counted. That is the OOM the hunters proved: the upload
 * dies AFTER the candidate has watched the progress bar reach 100%.
 *
 * Two changes bring it back inside the budget, and both live here:
 *
 *  1. `base64JsonBody()` builds the request body ONCE, straight into bytes,
 *     base64-ing the source in 192 KB chunks. No full base64 JS string and no
 *     JSON.stringify copy ever exist. Re-measured, same 25 MB file:
 *     rss 105.6, i.e. +59.7 instead of +125.6 -- the multiplier over the file
 *     size drops from 4.9x to 2.4x. Re-measured a second time against THIS
 *     module rather than a copy of it, under vitest, same 25 MB input:
 *     +125.0 MB for the old expression, +60.9 MB for this one.
 *
 *  2. `OCR_MAX_BYTES` caps what we are willing to READ. It is deliberately NOT
 *     an upload cap: a 25 MB passport scan must still be STORED (R2 and the
 *     documents row both happen before OCR runs), it just does not get the
 *     prefilled fields. Losing the auto-fill costs her two minutes of typing.
 *     Losing the upload costs her the document.
 */

/**
 * Largest file we will hand to the passport reader.
 *
 * At the measured 2.4x multiplier a 10 MB scan peaks around +24 MB over
 * baseline, which fits beside the bundle and the Supabase writes with room to
 * spare. 10 MB also covers the real fleet: an iPhone 12 MP passport photo is
 * 2-4 MB, and the 50 MP Android phones common in Morocco top out around 8-12 MB
 * at full quality. Anything larger is a multi-page flatbed scan, where the MRZ
 * is usually unreadable anyway.
 */
export const OCR_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Ceiling on the accumulated raw OCR text. It is only used to answer "is this
 * actually a passport or a Carte Nationale?" (detectDocumentType), which reads
 * keywords, so a truncated tail costs nothing -- whereas the full raw text of
 * a multi-page scan is an unbounded string on the same 128 MB budget.
 */
export const OCR_TEXT_MAX_CHARS = 200_000;

/** The measured multiplier of `base64JsonBody` over its input. */
export const OCR_PEAK_MULTIPLIER = 2.4;

/** Peak bytes above baseline that OCR-ing `sizeBytes` is expected to cost. */
export function estimateOcrPeakBytes(sizeBytes: number): number {
  return Math.round(sizeBytes * OCR_PEAK_MULTIPLIER);
}

export type OcrPlan =
  | { run: true }
  | { run: false; reason: "empty" | "too_large"; sizeBytes: number; limitBytes: number };

/**
 * Decide whether to OCR this upload at all. The caller MUST treat `run: false`
 * as "store the file, skip the prefill" -- never as an upload failure.
 */
export function planOcr(sizeBytes: number, limitBytes: number = OCR_MAX_BYTES): OcrPlan {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { run: false, reason: "empty", sizeBytes: 0, limitBytes };
  }
  if (sizeBytes > limitBytes) {
    return { run: false, reason: "too_large", sizeBytes, limitBytes };
  }
  return { run: true };
}

/** Append OCR text without letting the accumulator grow without bound. */
export function appendOcrText(accumulated: string, next: string, max: number = OCR_TEXT_MAX_CHARS): string {
  if (!next) return accumulated;
  if (accumulated.length >= max) return accumulated;
  const room = max - accumulated.length;
  return accumulated + (next.length > room ? next.slice(0, room) : next);
}

/**
 * Build `<prefix><base64 of bytes><suffix>` directly as UTF-8 bytes.
 *
 * The naive version of this line was
 *     JSON.stringify({ base64Source: buffer.toString("base64") })
 * which holds THREE copies at once: the base64 JS string (1.33x), the
 * stringified JSON (another 1.33x) and the encoded body (another 1.37x), on top
 * of the file itself. See the measurement table at the top of this file:
 * +125.6 MB for a 25 MB scan, on a 128 MB isolate.
 *
 * Here the destination buffer is allocated once at its exact final length and
 * the source is base64-ed in 192 KB chunks written straight into it. The chunk
 * size is a multiple of 3 on purpose: base64 encodes 3 input bytes to 4 output
 * characters, so a 3-aligned chunk never emits "=" padding mid-stream and the
 * concatenation is byte-identical to encoding the whole buffer at once (pinned
 * by tests/ocrBudget.test.ts). Base64 output is pure ASCII, so writing it as
 * latin1 is exact and skips a UTF-8 re-encode.
 *
 * `prefix` and `suffix` must already be valid JSON fragments -- callers pass
 * literals, never user input.
 */
export function base64JsonBody(prefix: string, bytes: Uint8Array, suffix: string): Buffer {
  const src = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const CHUNK = 3 * 64 * 1024; // 192 KB in, 256 KB out, 3-aligned
    const b64Len = Math.ceil(src.length / 3) * 4;
    const out = Buffer.allocUnsafe(Buffer.byteLength(prefix, "utf8") + b64Len + Buffer.byteLength(suffix, "utf8"));
    let pos = out.write(prefix, 0, "utf8");
    for (let off = 0; off < src.length; off += CHUNK) {
      const end = Math.min(off + CHUNK, src.length);
      pos += out.write(src.toString("base64", off, end), pos, "latin1");
    }
    pos += out.write(suffix, pos, "utf8");
    // `subarray`, not the whole buffer: allocUnsafe does not zero-fill, so any
    // byte past `pos` is whatever was in that memory. Nothing uninitialised
    // reaches the wire.
    return out.subarray(0, pos);
  } catch {
    // FALL BACK RATHER THAN FAIL. This is the only place in the codebase that
    // uses Buffer.allocUnsafe and Buffer.prototype.write(..., "latin1"), and it
    // runs on workerd's nodejs_compat Buffer rather than Node's own. If either
    // is missing or behaves differently there, a passport upload must NOT die
    // on a memory optimisation: the old, heavier concatenation still produces a
    // correct body, and the OCR_MAX_BYTES cap keeps even that inside the
    // isolate. Loud, because a silent fallback here quietly restores the 4.9x
    // memory profile this function exists to remove.
    console.warn("[ocrBudget] chunked base64 body unavailable — falling back to string concat");
    return Buffer.from(prefix + src.toString("base64") + suffix, "utf8");
  }
}
