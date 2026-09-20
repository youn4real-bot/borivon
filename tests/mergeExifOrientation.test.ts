import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { readJpegOrientation, exifOrientationRotationCw } from "../lib/docBytes";
import {
  mergeDocumentsToPdf,
  imageDrawPlacement,
  sourceExifRotationCw,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
} from "../lib/mergeDocs";

/**
 * A PHOTOGRAPHED DIPLOMA THAT STANDS UP IN THE PREVIEW MUST STAND UP IN THE
 * MERGED DOSSIER.
 *
 * A phone does not turn the pixels when you turn the phone: it writes the
 * sensor's own landscape frame and adds an EXIF Orientation tag saying which
 * way up it is. Browsers obey that tag, so the portal's preview showed the
 * certificate upright -- and pdf-lib's JpegEmbedder does not read EXIF at all,
 * so the SAME bytes lay on their side in the merged PDF the German employer
 * receives. Nothing on screen ever hinted at it: the only place the two views
 * disagree is the file that has already left the building.
 */

/** A real photograph shipped with the app -- a genuine camera JPEG, not a stub. */
const realJpeg = () => new Uint8Array(readFileSync("public/demande-example.jpg"));

/**
 * Splice a genuine EXIF APP1 segment into that real JPEG.
 *
 * Built byte by byte to the TIFF spec rather than kept as a binary fixture, so
 * each case can ask for the exact tag it needs -- and so BOTH byte orders are
 * covered, which is the half of EXIF parsing that silently reads garbage when
 * it is wrong.
 */
function withExifOrientation(jpeg: Uint8Array, orientation: number, endian: "II" | "MM" = "II"): Uint8Array {
  const little = endian === "II";
  const tiff = new Uint8Array(26);
  const w16 = (o: number, v: number) => {
    if (little) { tiff[o] = v & 0xff; tiff[o + 1] = (v >> 8) & 0xff; }
    else { tiff[o] = (v >> 8) & 0xff; tiff[o + 1] = v & 0xff; }
  };
  const w32 = (o: number, v: number) => {
    if (little) {
      tiff[o] = v & 0xff; tiff[o + 1] = (v >> 8) & 0xff;
      tiff[o + 2] = (v >> 16) & 0xff; tiff[o + 3] = (v >>> 24) & 0xff;
    } else {
      tiff[o] = (v >>> 24) & 0xff; tiff[o + 1] = (v >> 16) & 0xff;
      tiff[o + 2] = (v >> 8) & 0xff; tiff[o + 3] = v & 0xff;
    }
  };
  tiff[0] = little ? 0x49 : 0x4d;
  tiff[1] = little ? 0x49 : 0x4d;
  w16(2, 42);            // TIFF magic
  w32(4, 8);             // offset of IFD0, from the start of the TIFF block
  w16(8, 1);             // one entry
  w16(10, 0x0112);       // tag: Orientation
  w16(12, 3);            // type: SHORT
  w32(14, 1);            // count
  w16(18, orientation);  // value, inline (2 bytes, then 2 of padding)
  w32(22, 0);            // no next IFD

  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
  payload.set(tiff, 6);

  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xff; seg[1] = 0xe1;
  seg[2] = ((payload.length + 2) >> 8) & 0xff;
  seg[3] = (payload.length + 2) & 0xff;
  seg.set(payload, 4);

  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2), 0);        // SOI
  out.set(seg, 2);                         // APP1/Exif, first marker after SOI
  out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}

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

/** A genuine, decodable 8-bit RGB PNG -- PNG carries no orientation tag at all. */
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
    raw[row] = 0;
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

describe("reading the orientation a camera wrote", () => {
  it("finds the tag in a real JPEG, in either byte order", () => {
    for (const endian of ["II", "MM"] as const) {
      for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
        expect(readJpegOrientation(withExifOrientation(realJpeg(), o, endian)), `${endian}/${o}`).toBe(o);
      }
    }
  });

  it("says null when there is no tag, which is most scans", () => {
    // The shipped photo is JFIF-only: no EXIF block anywhere in it.
    expect(readJpegOrientation(realJpeg())).toBeNull();
    expect(readJpegOrientation(makePng(4, 4)), "a PNG has no JPEG markers").toBeNull();
    expect(readJpegOrientation(new Uint8Array(0))).toBeNull();
  });

  it("cannot be walked off the end by a truncated or crafted file", () => {
    // These bytes arrive from candidate uploads, so every read is bounded.
    const tagged = withExifOrientation(realJpeg(), 6);
    for (const cut of [0, 2, 4, 8, 12, 20, 30, 40]) {
      expect(() => readJpegOrientation(tagged.slice(0, cut)), `cut at ${cut}`).not.toThrow();
    }
    // An IFD offset pointing outside the segment must read as "no tag", never
    // as whatever byte happens to sit at that address.
    const evil = withExifOrientation(realJpeg(), 6);
    evil[2 + 4 + 6 + 4] = 0xff; evil[2 + 4 + 6 + 5] = 0xff;
    expect(readJpegOrientation(evil)).toBeNull();
  });

  it("turns the tag into plain clockwise degrees", () => {
    expect(exifOrientationRotationCw(1)).toBe(0);
    expect(exifOrientationRotationCw(2), "mirror only: we keep rotation, never a mirror").toBe(0);
    expect(exifOrientationRotationCw(3)).toBe(180);
    expect(exifOrientationRotationCw(4)).toBe(180);
    expect(exifOrientationRotationCw(5)).toBe(270);
    expect(exifOrientationRotationCw(6), "the commonest: phone held upright").toBe(90);
    expect(exifOrientationRotationCw(7)).toBe(90);
    expect(exifOrientationRotationCw(8)).toBe(270);
    expect(exifOrientationRotationCw(null)).toBe(0);
    expect(exifOrientationRotationCw(99)).toBe(0);
  });

  it("only a JPEG is asked -- a PDF half is never sniffed for EXIF", () => {
    expect(sourceExifRotationCw(withExifOrientation(realJpeg(), 6), "jpeg")).toBe(90);
    expect(sourceExifRotationCw(withExifOrientation(realJpeg(), 6), "pdf")).toBe(0);
    expect(sourceExifRotationCw(makePng(4, 4), "png")).toBe(0);
  });
});

describe("where a turned picture actually lands on the page", () => {
  /** The bounding box pdf-lib's drawImage really produces for these arguments. */
  function drawnExtent(p: { x: number; y: number; width: number; height: number; rotate: number }) {
    const rad = (p.rotate * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const xs: number[] = [], ys: number[] = [];
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const sx = u * p.width, sy = v * p.height;
      xs.push(p.x + sx * cos - sy * sin);
      ys.push(p.y + sx * sin + sy * cos);
    }
    return {
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }

  it("fills exactly the box it was given, at every quarter turn", () => {
    // drawImage rotates about its (x, y) CORNER, not the centre, so a turned
    // picture walks clean off the page unless that corner is moved to the one
    // the rotation sweeps FROM. A page that is merely off-centre still looks
    // like it works, which is why this is pinned rather than eyeballed.
    const box = { x: 18, y: 30, width: 400, height: 700 };
    for (const cw of [0, 90, 180, 270] as const) {
      const got = drawnExtent(imageDrawPlacement(box, cw));
      expect(got.x, `cw=${cw}`).toBeCloseTo(box.x, 6);
      expect(got.y, `cw=${cw}`).toBeCloseTo(box.y, 6);
      expect(got.width, `cw=${cw}`).toBeCloseTo(box.width, 6);
      expect(got.height, `cw=${cw}`).toBeCloseTo(box.height, 6);
    }
  });

  it("turns clockwise on screen, which is the direction EXIF means", () => {
    // PDF angles are counter-clockwise in user space; EXIF speaks clockwise as
    // seen. Getting that sign wrong turns a sideways diploma the WRONG way,
    // which looks exactly like the bug it is here to fix.
    expect(imageDrawPlacement({ x: 0, y: 0, width: 10, height: 20 }, 90).rotate).toBe(270);
    expect(imageDrawPlacement({ x: 0, y: 0, width: 10, height: 20 }, 270).rotate).toBe(90);
    expect(imageDrawPlacement({ x: 0, y: 0, width: 10, height: 20 }, 180).rotate).toBe(180);
    expect(imageDrawPlacement({ x: 0, y: 0, width: 10, height: 20 }, 0).rotate).toBe(0);
  });
});

describe("the merge honours what the camera wrote", () => {
  it("an upright phone photo gets an upright page, not a sideways one", async () => {
    // The shipped photo is 899x1225 in its STORED frame -- portrait pixels.
    // Orientation 6 means "turn me a quarter clockwise to read me", so the
    // page it deserves is LANDSCAPE. Without the EXIF read it stayed portrait
    // and the certificate lay on its side in the employer's copy, forever.
    const untagged = await mergeDocumentsToPdf([{ bytes: realJpeg() }]);
    const turned   = await mergeDocumentsToPdf([{ bytes: withExifOrientation(realJpeg(), 6) }]);
    expect(untagged.ok && turned.ok).toBe(true);
    if (!untagged.ok || !turned.ok) return;

    const plain = (await PDFDocument.load(untagged.bytes)).getPage(0);
    const exif  = (await PDFDocument.load(turned.bytes)).getPage(0);
    expect(plain.getWidth(), "untagged: portrait pixels, portrait page").toBeLessThan(plain.getHeight());
    expect(exif.getWidth(), "orientation 6: the page swaps with the picture").toBeGreaterThan(exif.getHeight());
    expect(exif.getWidth()).toBeCloseTo(A4_HEIGHT_PT, 1);
    expect(exif.getHeight()).toBeCloseTo(A4_WIDTH_PT, 1);
  });

  it("orientations 5-8 swap the page; 1 and 3 leave it alone", async () => {
    for (const o of [5, 6, 7, 8]) {
      const res = await mergeDocumentsToPdf([{ bytes: withExifOrientation(realJpeg(), o) }]);
      expect(res.ok, `orientation ${o}`).toBe(true);
      if (!res.ok) return;
      const page = (await PDFDocument.load(res.bytes)).getPage(0);
      expect(page.getWidth(), `orientation ${o} must swap width and height`).toBeGreaterThan(page.getHeight());
    }
    for (const o of [1, 3]) {
      const res = await mergeDocumentsToPdf([{ bytes: withExifOrientation(realJpeg(), o) }]);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const page = (await PDFDocument.load(res.bytes)).getPage(0);
      expect(page.getWidth(), `orientation ${o} must NOT swap`).toBeLessThan(page.getHeight());
    }
  });

  it("the admin's saved rotation still applies ON TOP of the camera's", async () => {
    // documents.rotation is what she chose while looking at the EXIF-corrected
    // preview, so it composes with the camera's turn rather than replacing it.
    const res = await mergeDocumentsToPdf([{ bytes: withExifOrientation(realJpeg(), 6), rotation: 90 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const page = (await PDFDocument.load(res.bytes)).getPage(0);
    expect(page.getRotation().angle, "the stored rotation is untouched").toBe(90);
    expect(page.getWidth(), "and the EXIF swap is still there underneath").toBeGreaterThan(page.getHeight());
  });

  it("a PNG is unaffected -- PNG has no orientation tag to read", async () => {
    const res = await mergeDocumentsToPdf([{ bytes: makePng(600, 400) }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const page = (await PDFDocument.load(res.bytes)).getPage(0);
    expect(page.getWidth()).toBeGreaterThan(page.getHeight());
  });

  it("pdf.js -- what actually renders it -- sees the turned page and a painted picture", async () => {
    // pdf-lib reloading its own output proves little; the question is what the
    // reader on the employer's desk shows.
    const res = await mergeDocumentsToPdf([{ bytes: withExifOrientation(realJpeg(), 6) }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: res.bytes, useSystemFonts: false }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    expect(vp.width, "the reader shows it landscape, the way the photo reads").toBeGreaterThan(vp.height);
    const ops = await page.getOperatorList();
    const names = ops.fnArray.map((f: number) =>
      Object.keys(pdfjs.OPS).find(k => (pdfjs.OPS as Record<string, number>)[k] === f));
    expect(names.some(n => !!n && /Image/i.test(n)), "the photo must be painted, not merely embedded").toBe(true);
  });
});

/**
 * THE OTHER HALF: A ROTATION THE ADMIN MAKES HAS TO SURVIVE THE CLOSE.
 *
 * EXIF fixes the photos a camera tagged. Everything else -- a scan fed in
 * sideways, a photo with no tag at all -- needs a human to turn it, and the
 * only place that turn can live is documents.rotation, which the merge above
 * already honours. The image viewer's rotate button was a private view toggle:
 * it turned the picture on screen, saved nothing, and the next open (and the
 * employer's copy) were sideways again. The PDF viewer had persisted its
 * rotation for months; the image branch had simply never been wired.
 *
 * No jsdom in this suite, so these read the wiring itself -- the same way
 * tests/photoDocPaths.test.ts pins the other React paths.
 */
const VIEWER = readFileSync("components/ZoomPanRotateViewer.tsx", "utf8");
const PREVIEW_MODAL = readFileSync("components/AdminDocPreviewModal.tsx", "utf8");

describe("the rotate control on a photographed document persists", () => {
  it("the viewer offers a way to save the turn, and opens at the saved angle", () => {
    expect(VIEWER, "a caller must be able to persist the turn").toMatch(/onRotate\?:\s*\(\)\s*=>\s*void/);
    expect(VIEWER, "and to seed the viewer from the stored angle").toMatch(/initialRotation\s*=\s*0/);
    expect(VIEWER).toMatch(/useState\(initialRotation\)/);
  });

  it("the rotate button actually calls it -- not a bare local setState", () => {
    // Revert this and the button turns the picture and tells nobody, which is
    // precisely the bug.
    expect(VIEWER).toMatch(/function rotateCw\(\)[\s\S]{0,140}onRotate\?\.\(\)/);
    expect(VIEWER).toMatch(/onClick=\{rotateCw\}/);
    expect(VIEWER, "the old fire-and-forget handler must be gone")
      .not.toMatch(/onClick=\{\(\)\s*=>\s*setRotation\(r\s*=>\s*r\s*\+\s*90\)\}/);
  });

  it("double-click returns to the SAVED angle, never to zero", () => {
    // Snapping back to upright would quietly disagree with the merged PDF,
    // which reads documents.rotation.
    expect(VIEWER).toMatch(/setScale\(1\);\s*setRotation\(initialRotation\)/);
    expect(VIEWER).toMatch(/rotation === initialRotation/);
  });

  it("the admin's image preview wires both ends", () => {
    const at = PREVIEW_MODAL.indexOf("<ZoomPanRotateViewer");
    expect(at, "the image branch must still render the viewer").toBeGreaterThan(-1);
    const tag = PREVIEW_MODAL.slice(at, at + 260);
    expect(tag).toContain("initialRotation={doc.rotation ?? 0}");
    expect(tag, "the same PATCH the PDF branch has used for months").toContain("onRotate={persistRotate}");
  });

  it("persistRotate is shared, not a PDF-only closure any more", () => {
    // It used to be declared INSIDE `if (ext === \"pdf\")`, which is why an
    // image could not reach it.
    const decl = PREVIEW_MODAL.indexOf("const persistRotate =");
    const pdfBranch = PREVIEW_MODAL.indexOf('if (ext === "pdf")');
    expect(decl).toBeGreaterThan(-1);
    expect(pdfBranch).toBeGreaterThan(-1);
    expect(decl, "it has to be declared BEFORE the PDF branch to be reusable").toBeLessThan(pdfBranch);
    expect(PREVIEW_MODAL, "and still refuse to persist against a synthetic merged doc")
      .toMatch(/const persistRotate = \(\) => \{[\s\S]{0,200}overrideFetchUrl \|\| !doc\.id/);
  });
});
