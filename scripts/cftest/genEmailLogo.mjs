// One-off: render the "Borivon." email wordmark to a STATIC PNG (public/email-logo.png)
// so the email signature never depends on next/og (resvg WASM 500s on workerd).
// Matches app/email-logo/route.tsx: 560×180, #fcfaf7 bg, DM Serif Italic, gold dot.
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import fs from "node:fs";
import zlib from "node:zlib";

const W = 560, H = 180, SIZE = 110;
const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const font = await doc.embedFont(fs.readFileSync("public/fonts/DMSerifDisplay-Italic.ttf"), { subset: true });
const page = doc.addPage([W, H]);
page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hex("#fcfaf7") });
const wMain = font.widthOfTextAtSize("Borivon", SIZE);
const wDot = font.widthOfTextAtSize(".", SIZE);
const x0 = (W - (wMain + wDot)) / 2;
const baseline = 56; // from bottom — visually centers the cap height in 180px
page.drawText("Borivon", { x: x0, y: baseline, size: SIZE, font, color: hex("#1a1b1d") });
page.drawText(".", { x: x0 + wMain, y: baseline, size: SIZE, font, color: hex("#c9a240") });
const pdfBytes = await doc.save();

// rasterize at scale 1 → exactly 560×180 px
const lib = await PDFiumLibrary.init();
const pdoc = await lib.loadDocument(pdfBytes);
const img = await pdoc.getPage(0).render({ scale: 1 });

// RGBA → PNG
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function chunk(t, d) { const len = Buffer.alloc(4); len.writeUInt32BE(d.length, 0); const body = Buffer.concat([Buffer.from(t, "ascii"), Buffer.from(d)]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function png(rgba, w, h) { const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; const st = w * 4; const raw = Buffer.alloc((st + 1) * h); for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * st, st).copy(raw, y * (st + 1) + 1); return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]); }

fs.writeFileSync("public/email-logo.png", png(img.data, img.width, img.height));
console.log(`wrote public/email-logo.png (${img.width}x${img.height})`);
pdoc.destroy(); lib.destroy();
