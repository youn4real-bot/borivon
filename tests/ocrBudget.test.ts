import { describe, it, expect } from "vitest";
import {
  base64JsonBody, planOcr, appendOcrText, estimateOcrPeakBytes,
  OCR_MAX_BYTES, OCR_TEXT_MAX_CHARS,
} from "../lib/ocrBudget";

/**
 * The passport OCR pipeline used to spend +125.6 MB of RSS on a 25 MB scan, on
 * a 128 MB Worker isolate, because every request body existed three times over
 * (base64 string, JSON.stringify copy, wire encoding). These pin the two
 * mitigations: the body builder that never makes those copies, and the input
 * cap that keeps a huge scan STORED but unread.
 */

describe("base64JsonBody — identical output, without the copies", () => {
  it("produces exactly what JSON.stringify would have produced", () => {
    const bytes = Buffer.from("a photographed passport data page, more or less");
    const built = base64JsonBody('{"base64Source":"', bytes, '"}');
    const naive = JSON.stringify({ base64Source: bytes.toString("base64") });
    expect(built.toString("utf8")).toBe(naive);
  });

  it("round-trips the exact bytes back out", () => {
    const bytes = Buffer.alloc(9_973);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
    const parsed = JSON.parse(base64JsonBody('{"base64Source":"', bytes, '"}').toString("utf8"));
    expect(Buffer.from(parsed.base64Source, "base64").equals(bytes)).toBe(true);
  });

  it("chunks on a 3-byte boundary, so no padding leaks into the middle", () => {
    // Three full 192 KB chunks plus a ragged tail is the case that breaks a
    // naive chunked encoder: a non-3-aligned chunk emits "=" mid-stream and
    // the decoded bytes come back wrong (or short) with no error anywhere.
    const CHUNK = 3 * 64 * 1024;
    for (const size of [CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 2 + 7, CHUNK * 3 + 2]) {
      const bytes = Buffer.alloc(size, 0x5a);
      const parsed = JSON.parse(base64JsonBody('{"x":"', bytes, '"}').toString("utf8"));
      expect(parsed.x, `size ${size}`).toBe(bytes.toString("base64"));
      expect(parsed.x.indexOf("="), `size ${size}`).toBeLessThan(0 + parsed.x.length);
      // padding, if any, only at the very end
      expect(parsed.x.replace(/=+$/, "").includes("="), `size ${size}`).toBe(false);
    }
  });

  it("handles an empty buffer without emitting invalid JSON", () => {
    const parsed = JSON.parse(base64JsonBody('{"base64Source":"', Buffer.alloc(0), '"}').toString("utf8"));
    expect(parsed.base64Source).toBe("");
  });

  it("accepts a plain Uint8Array view, not just a Buffer", () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 4, 9, 9]);
    const view = backing.subarray(2, 6); // offset != 0 — the case that silently
    // encodes the WHOLE backing array if the helper ignores byteOffset
    const parsed = JSON.parse(base64JsonBody('{"x":"', view, '"}').toString("utf8"));
    expect(Buffer.from(parsed.x, "base64").equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
  });

  // There used to be two more here, pinning the two Google Vision request
  // bodies. That fallback was removed on 2026-09-20 -- billing is disabled on
  // its Google project, so every call it made came back refused -- and a test
  // that builds a body nothing sends proves nothing. What IS sent is the Azure
  // submit body above, and this pins the real nesting it goes into.
  it("builds the real Azure submit body as valid JSON", () => {
    const j = JSON.parse(base64JsonBody(
      '{"base64Source":"',
      Buffer.from("%PDF-1.4 fake"),
      '"}',
    ).toString("utf8"));
    expect(Object.keys(j)).toEqual(["base64Source"]);
    expect(Buffer.from(j.base64Source, "base64").toString()).toBe("%PDF-1.4 fake");
  });
});

describe("planOcr — the cap reads, it does not refuse the upload", () => {
  it("runs for a normal phone photo of a passport", () => {
    expect(planOcr(3 * 1024 * 1024).run).toBe(true);
    expect(planOcr(OCR_MAX_BYTES).run).toBe(true);
  });

  it("skips a scan past the cap, and says why", () => {
    const p = planOcr(25 * 1024 * 1024);
    expect(p.run).toBe(false);
    if (!p.run) {
      expect(p.reason).toBe("too_large");
      expect(p.sizeBytes).toBe(25 * 1024 * 1024);
      expect(p.limitBytes).toBe(OCR_MAX_BYTES);
    }
  });

  it("skips an empty or nonsense size rather than OCR-ing nothing", () => {
    expect(planOcr(0).run).toBe(false);
    expect(planOcr(-1).run).toBe(false);
    expect(planOcr(Number.NaN).run).toBe(false);
  });

  it("keeps the whole 25 MB upload ceiling inside a 128 MB isolate once skipped", () => {
    // The number that mattered: OCR-ing 25 MB measured +125.6 MB over baseline.
    // At the cap it is a quarter of that.
    expect(estimateOcrPeakBytes(25 * 1024 * 1024)).toBeGreaterThanOrEqual(59 * 1024 * 1024);
    expect(estimateOcrPeakBytes(OCR_MAX_BYTES)).toBeLessThan(26 * 1024 * 1024);
  });
});

describe("appendOcrText — bounded accumulator", () => {
  it("concatenates normally under the ceiling", () => {
    expect(appendOcrText("abc", "def")).toBe("abcdef");
  });

  it("stops at the ceiling instead of growing without bound", () => {
    const out = appendOcrText("x".repeat(OCR_TEXT_MAX_CHARS - 5), "y".repeat(1000));
    expect(out).toHaveLength(OCR_TEXT_MAX_CHARS);
    expect(out.endsWith("yyyyy")).toBe(true);
  });

  it("is a no-op once full, and on empty input", () => {
    const full = "z".repeat(OCR_TEXT_MAX_CHARS);
    expect(appendOcrText(full, "more")).toBe(full);
    expect(appendOcrText("abc", "")).toBe("abc");
  });
});
