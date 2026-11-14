import { Ecc, QrCode } from "@/lib/qrcodegen";

// Invite QR codes are drawn here, never by a web service. Until 2026-11 the organisations page and
// /api/portal/qr asked api.qrserver.com for the image, and that request carried the whole invite URL:
// every single-use token (org-admin ones included) landed in a third party's logs before the invitee
// had even scanned it. The popup now draws an SVG in the browser and the download route builds the
// PNG itself, so the URL never leaves Borivon.

/** Module colour: the house ink. */
export const QR_DARK = "#15130f";
/** Background, quiet zone included. */
export const QR_LIGHT = "#ffffff";
/** The quiet zone the QR standard asks for, in modules. */
export const QR_BORDER = 4;

/** Medium error correction (15 %); the encoder raises it for free when the chosen size has room. */
export function encodeQr(text: string): QrCode {
  return QrCode.encodeText(text, Ecc.MEDIUM);
}

/** SVG path data for the dark modules, one subpath per horizontal run, shifted by the quiet zone.
 *  Draw it in a `0 0 (size + 2·border)` viewBox over a QR_LIGHT square. */
export function qrSvgPath(qr: QrCode, border: number = QR_BORDER): string {
  let d = "";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; ) {
      if (!qr.getModule(x, y)) { x++; continue; }
      let run = 1;
      while (x + run < qr.size && qr.getModule(x + run, y)) run++;
      d += `M${x + border},${y + border}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return d;
}

/** The code as a PNG: 1-bit, two-colour palette (QR_LIGHT, QR_DARK), quiet zone included, every module
 *  the same whole number of pixels so the edges stay sharp. The image is at least `minPx` wide. */
export async function qrPng(qr: QrCode, minPx = 400, border: number = QR_BORDER): Promise<Uint8Array<ArrayBuffer>> {
  const modules = qr.size + border * 2;
  const scale = Math.max(1, Math.ceil(minPx / modules));
  const px = modules * scale;

  // scanlines: a filter byte (0 = none) followed by the row packed 8 pixels per byte, palette index 1 = dark
  const stride = 1 + Math.ceil(px / 8);
  const raw = new Uint8Array(stride * px);
  for (let y = 0; y < px; y++) {
    const my = Math.floor(y / scale) - border;
    const row = y * stride + 1;
    for (let x = 0; x < px; x++) {
      if (qr.getModule(Math.floor(x / scale) - border, my)) raw[row + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, px);
  view.setUint32(4, px);
  ihdr.set([1, 3, 0, 0, 0], 8); // bit depth 1, colour type 3 (palette), deflate, adaptive filtering, no interlace

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", new Uint8Array([...hexRgb(QR_LIGHT), ...hexRgb(QR_DARK)])),
    pngChunk("IDAT", await zlibDeflate(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// length, type, data, CRC-32 of type + data
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk, 4, 8 + data.length));
  return chunk;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// zlib-wrapped deflate, which is exactly what a PNG IDAT holds (Workers, Node and browsers all ship it)
async function zlibDeflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
