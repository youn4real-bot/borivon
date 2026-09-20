import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { detectDocKind, isImageKind, mimeForKind, pngPixelCount } from "../lib/docBytes";
import {
  mergeDocumentsToPdf,
  imagePageSize,
  fitContain,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  PNG_MEGAPIXEL_LIMIT,
} from "../lib/mergeDocs";

/**
 * A PHOTOGRAPHED DOCUMENT MUST SURVIVE THE MERGE.
 *
 * A qualification document is half of an original/translated pair, and both the
 * admin panel and the candidate dashboard offer that pair as one merged
 * download. The merge was two bare PDFDocument.load() calls, so a photographed
 * diploma threw into a bare 500 "Merge failed" -- which is why every upload box
 * except the passport still had to say "PDF only" even though the SERVER had
 * accepted images all along.
 *
 * Not hypothetical: the login-less upload link (app/api/portal/u/[token]) and
 * the CV builder's B2 confirmation box already accept photos for every
 * non-passport key, so image documents can already exist in production and that
 * 500 is a live bug, not a future one.
 *
 * These prove the merge now takes a photo, and that everything it still cannot
 * take is refused with a code rather than a 500.
 */

// A real 1x1 JPEG. The same constant tests/cvPhoto.test.ts uses -- the smallest
// thing pdf-lib will actually decode.
const JPEG_1PX_B64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/** A real photograph shipped with the app -- a genuine camera JPEG, not a stub. */
const realJpeg = () => new Uint8Array(readFileSync("public/demande-example.jpg"));

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.slice(4, 8 + data.length)));
  return out;
}

/**
 * A genuine, decodable 8-bit RGB PNG of the given size. Built here rather than
 * shipped as a fixture so each test can ask for the exact shape it needs -- the
 * landscape/portrait choice is the thing being checked.
 */
function makePng(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour RGB
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = (x * 7) % 256;
      raw[row + 2 + x * 3] = (y * 11) % 256;
      raw[row + 3 + x * 3] = 128;
    }
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw)))),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * A PNG whose IHDR claims a huge picture, with a body that is not one.
 *
 * Deliberate: the ceiling exists precisely so the file is refused BEFORE
 * pdf-lib decodes anything, so a test that built twelve real megapixels would
 * be testing the wrong moment -- and would allocate the very memory the guard
 * protects.
 */
function makeOversizedPngHeader(width: number, height: number): Uint8Array {
  const out = new Uint8Array(makePng(2, 2));
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return out;
}

/** "RIFF" + size + "WEBP" -- only the signature matters, nothing decodes it. */
function makeWebpHeader(): Uint8Array {
  const out = new Uint8Array(32);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(out.buffer).setUint32(4, 24, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  out.set([0x56, 0x50, 0x38, 0x20], 12);
  return out;
}

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
  return doc.save();
}

describe("detectDocKind", () => {
  it("names every format a document can arrive as", async () => {
    expect(detectDocKind(await makePdf(1))).toBe("pdf");
    expect(detectDocKind(b64(JPEG_1PX_B64))).toBe("jpeg");
    expect(detectDocKind(realJpeg())).toBe("jpeg");
    expect(detectDocKind(makePng(4, 4))).toBe("png");
    expect(detectDocKind(makeWebpHeader())).toBe("webp");
  });

  it("calls anything else 'other' instead of guessing", () => {
    expect(detectDocKind(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe("other");
    expect(detectDocKind(new Uint8Array(0)), "empty bytes must not crash it").toBe("other");
    // A DOCX (a PK zip) is a legitimate Sonstiges upload and is NOT something
    // we can merge, so it has to land in "other" rather than be mistaken for
    // anything embeddable.
    expect(detectDocKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toBe("other");
  });

  it("reads the bytes, not a stored content type", () => {
    // Rows written before images were possible say "application/pdf" whatever
    // they hold. The bytes are the only thing that cannot be stale.
    const jpegThatARowWouldCallPdf = realJpeg();
    expect(detectDocKind(jpegThatARowWouldCallPdf)).toBe("jpeg");
    expect(mimeForKind(detectDocKind(jpegThatARowWouldCallPdf))).toBe("image/jpeg");
  });

  it("isImageKind separates a picture from a PDF", () => {
    expect(isImageKind("jpeg")).toBe(true);
    expect(isImageKind("png")).toBe(true);
    expect(isImageKind("webp")).toBe(true);
    expect(isImageKind("pdf")).toBe(false);
    expect(isImageKind("other")).toBe(false);
  });
});

describe("pngPixelCount", () => {
  it("reads the size out of IHDR without decoding the image", () => {
    expect(pngPixelCount(makePng(30, 20))).toBe(600);
    expect(pngPixelCount(makeOversizedPngHeader(4000, 3000))).toBe(12_000_000);
  });

  it("returns null for anything that is not a PNG", () => {
    expect(pngPixelCount(realJpeg())).toBeNull();
    expect(pngPixelCount(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("page geometry for a photographed page", () => {
  it("gives a landscape photo a landscape page", () => {
    // A certificate photographed sideways onto a portrait page shrinks to a
    // band across the middle at about half the readable size.
    expect(imagePageSize(3000, 2000)).toEqual([A4_HEIGHT_PT, A4_WIDTH_PT]);
    expect(imagePageSize(2000, 3000)).toEqual([A4_WIDTH_PT, A4_HEIGHT_PT]);
    expect(imagePageSize(1000, 1000), "a square falls to portrait").toEqual([A4_WIDTH_PT, A4_HEIGHT_PT]);
  });

  it("never trades away the aspect ratio -- a stretched document reads as a forgery", () => {
    const box = fitContain(3000, 2000, A4_WIDTH_PT, A4_HEIGHT_PT);
    expect(box.width / box.height).toBeCloseTo(3000 / 2000, 5);
  });

  it("fits inside the margins and centres what is left", () => {
    const box = fitContain(3000, 2000, A4_WIDTH_PT, A4_HEIGHT_PT);
    expect(box.width).toBeLessThanOrEqual(A4_WIDTH_PT - 36 + 0.01);
    expect(box.height).toBeLessThanOrEqual(A4_HEIGHT_PT - 36 + 0.01);
    expect(box.x).toBeCloseTo((A4_WIDTH_PT - box.width) / 2, 5);
    expect(box.y).toBeCloseTo((A4_HEIGHT_PT - box.height) / 2, 5);
  });

  it("fills the page with a small photo rather than leaving a stamp in the corner", () => {
    const box = fitContain(300, 400, A4_WIDTH_PT, A4_HEIGHT_PT);
    expect(box.width).toBeGreaterThan(300);
  });
});

describe("merging a photographed half", () => {
  it("a photographed ORIGINAL and a PDF translation become one readable PDF", async () => {
    const res = await mergeDocumentsToPdf([
      { bytes: await makePdf(2) },   // translation first, the order the route uses
      { bytes: realJpeg() },         // the photographed original
    ]);
    expect(res.ok, "this threw a bare 500 before").toBe(true);
    if (!res.ok) return;
    const out = await PDFDocument.load(res.bytes);
    expect(out.getPageCount(), "two PDF pages plus one page for the photo").toBe(3);
    expect(detectDocKind(res.bytes), "the output is a real PDF").toBe("pdf");
  });

  it("and the other way round -- a PDF original with a photographed translation", async () => {
    const res = await mergeDocumentsToPdf([
      { bytes: makePng(60, 40) },
      { bytes: await makePdf(3) },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = await PDFDocument.load(res.bytes);
    expect(out.getPageCount()).toBe(4);
    // The photo went first, on a landscape page, because the picture is wide.
    expect(out.getPage(0).getWidth()).toBeCloseTo(A4_HEIGHT_PT, 1);
    expect(out.getPage(0).getHeight()).toBeCloseTo(A4_WIDTH_PT, 1);
  });

  it("two photos merge into a two-page PDF", async () => {
    const res = await mergeDocumentsToPdf([
      { bytes: realJpeg() },
      { bytes: makePng(40, 60) },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = await PDFDocument.load(res.bytes);
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(1).getWidth(), "the tall PNG keeps a portrait page")
      .toBeCloseTo(A4_WIDTH_PT, 1);
  });

  it("keeps the pages in the order given -- translation first, then original", async () => {
    // The pair is read side by side; silently swapping them would mislabel
    // every merged download without failing anything.
    const res = await mergeDocumentsToPdf([
      { bytes: makePng(60, 40) },   // landscape marker
      { bytes: makePng(40, 60) },   // portrait marker
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = await PDFDocument.load(res.bytes);
    expect(out.getPage(0).getWidth()).toBeGreaterThan(out.getPage(0).getHeight());
    expect(out.getPage(1).getWidth()).toBeLessThan(out.getPage(1).getHeight());
  });

  it("applies the stored rotation to a photographed page too", async () => {
    const res = await mergeDocumentsToPdf([{ bytes: realJpeg(), rotation: 90 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = await PDFDocument.load(res.bytes);
    expect(out.getPage(0).getRotation().angle).toBe(90);
  });

  it("still merges two PDFs exactly as it always did", async () => {
    const res = await mergeDocumentsToPdf([
      { bytes: await makePdf(1), rotation: 90 },
      { bytes: await makePdf(2) },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = await PDFDocument.load(res.bytes);
    expect(out.getPageCount()).toBe(3);
    expect(out.getPage(0).getRotation().angle).toBe(90);
    expect(out.getPage(1).getRotation().angle).toBe(0);
  });
});

describe("what the merge refuses, it refuses out loud", () => {
  it("WebP is refused with a code, never a throw", async () => {
    // pdf-lib has no WebP embedder, and the Workers runtime has no image
    // decoder to transcode with. Saying so beats a 500 that says nothing.
    const res = await mergeDocumentsToPdf([
      { bytes: makeWebpHeader() },
      { bytes: await makePdf(1) },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("unsupported_format");
    expect(res.kind).toBe("webp");
  });

  it("a WebP in the SECOND half is caught before anything is built", async () => {
    const res = await mergeDocumentsToPdf([
      { bytes: await makePdf(1) },
      { bytes: makeWebpHeader() },
    ]);
    expect(res.ok, "the refusal must not depend on which half it is").toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("unsupported_format");
  });

  it("a PNG above the megapixel ceiling is refused before pdf-lib decodes it", async () => {
    const height = Math.round(((PNG_MEGAPIXEL_LIMIT + 4) * 1_000_000) / 4000);
    const res = await mergeDocumentsToPdf([
      { bytes: makeOversizedPngHeader(4000, height) },
      { bytes: await makePdf(1) },
    ]);
    expect(res.ok, "an OOM in the isolate has no status code at all").toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("image_too_large");
    expect(res.megapixels).toBeGreaterThan(PNG_MEGAPIXEL_LIMIT);
  });

  it("a PNG under the ceiling still merges", async () => {
    const res = await mergeDocumentsToPdf([{ bytes: makePng(120, 90) }]);
    expect(res.ok).toBe(true);
  });

  it("garbage bytes are refused, not thrown on", async () => {
    const res = await mergeDocumentsToPdf([
      { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) },
      { bytes: await makePdf(1) },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("unsupported_format");
    expect(res.kind).toBe("other");
  });

  it("a truncated PDF gives 'unreadable', not an exception", async () => {
    const real = await makePdf(2);
    const res = await mergeDocumentsToPdf([{ bytes: real.slice(0, Math.floor(real.length / 3)) }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("unreadable");
    expect(res.kind).toBe("pdf");
  });

  it("never rejects -- every caller can render the answer", async () => {
    const inputs = [
      makeWebpHeader(),
      new Uint8Array([0, 1, 2, 3]),
      makeOversizedPngHeader(9000, 9000),
      realJpeg(),
    ];
    for (const bytes of inputs) {
      await expect(mergeDocumentsToPdf([{ bytes }])).resolves.toBeTruthy();
    }
  });
});

const MERGE_ROUTE = readFileSync("app/api/portal/documents/merge-pdf/route.ts", "utf8");
const UPLOAD_ROUTE = readFileSync("app/api/portal/upload/route.ts", "utf8");

describe("the merge route wires the helper, and still refuses a passport", () => {
  it("LAW #39: the passport refusal comes BEFORE any merging", async () => {
    // pdf-lib's load+save silently drops the content streams of a
    // scanner-produced passport: the photo and the holograms survive, the MRZ
    // and VIZ text vanish, and the file size barely moves. A passport has no
    // translated counterpart, so merge refuses it outright rather than risk it.
    const gate = MERGE_ROUTE.indexOf("isPassportFileType(origMeta.fileType)");
    const merge = MERGE_ROUTE.indexOf("mergeDocumentsToPdf(");
    expect(gate, "the passport gate must still exist").toBeGreaterThan(-1);
    expect(MERGE_ROUTE).toContain("isPassportFileType(transMeta.fileType)");
    expect(merge, "the route must call the helper").toBeGreaterThan(-1);
    expect(gate, "the gate must run before the merge, not after").toBeLessThan(merge);
    expect(MERGE_ROUTE).toContain("Passport documents cannot be merged");
  });

  it("the route no longer parses either half with pdf-lib itself", () => {
    // The two bare loads were the blocker. If they come back, a photographed
    // diploma is a bare 500 again.
    expect(MERGE_ROUTE).not.toContain("PDFDocument.load(transBytes)");
    expect(MERGE_ROUTE).not.toContain("PDFDocument.load(origBytes)");
    expect(MERGE_ROUTE).not.toContain('from "pdf-lib"');
  });

  it("a refusal leaves the route as a 4xx with a code, never the bare 500", () => {
    expect(MERGE_ROUTE).toMatch(/if \(!result\.ok\)/);
    expect(MERGE_ROUTE).toContain("error: result.code");
    expect(MERGE_ROUTE, "413 for too big, 415 for a format we cannot take")
      .toContain('result.code === "image_too_large" ? 413 : 415');
  });
});

describe("the upload page-count probe does not trip over a photo", () => {
  it("pdf-lib really cannot parse a JPEG -- which is why the guard matters", async () => {
    await expect(PDFDocument.load(realJpeg())).rejects.toThrow();
  });

  it("the probe only runs when the sniffed bytes are actually a PDF", () => {
    expect(UPLOAD_ROUTE).toMatch(
      /\(sniffedType \?\? file\.type\) === "application\/pdf"[\s\S]{0,400}?PDFDocument\.load\(buffer/,
    );
  });

  it("and even then a parse failure never blocks the upload", () => {
    // Belt and braces: the probe is wrapped, so an unusual PDF (or anything
    // that slipped past the sniff) costs the cap, not the upload.
    const at = UPLOAD_ROUTE.indexOf("PDFDocument.load(buffer");
    const probe = UPLOAD_ROUTE.slice(at - 200, at + 300);
    expect(probe).toContain("try {");
    expect(probe).toContain("catch");
    expect(probe, "LAW #39: the probe reads, it never re-saves").not.toContain(".save(");
  });
});
