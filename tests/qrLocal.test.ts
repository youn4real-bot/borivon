import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { encodeQr, qrPng, qrSvgPath, QR_BORDER } from "@/lib/qr";

// Invite QR codes are drawn in-house (lib/qr + lib/qrcodegen, Nayuki MIT). Before 2026-11 the invite URL —
// a single-use token — was sent to api.qrserver.com. These tests pin the structure; the decodability was
// checked with an independent decoder (jsQR) for short, long (v13) and UTF-8 URLs, from both the module
// matrix and the PNG, before shipping.

const URLS = ["https://borivon.com/join/abc", "https://borivon.com/join/" + "k".repeat(300), "https://borivon.com/join/Ümlaut-é"];

function finderAt(qr: ReturnType<typeof encodeQr>, ox: number, oy: number): boolean {
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
    const want = ring !== 2; // dark 7x7 border, light ring, dark 3x3 core
    if (qr.getModule(ox + x, oy + y) !== want) return false;
  }
  return true;
}

describe("in-house QR codes", () => {
  it("encodes with the standard size and the three finder patterns", () => {
    for (const u of URLS) {
      const qr = encodeQr(u);
      expect(qr.size).toBe(qr.version * 4 + 17);
      expect(finderAt(qr, 0, 0)).toBe(true);
      expect(finderAt(qr, qr.size - 7, 0)).toBe(true);
      expect(finderAt(qr, 0, qr.size - 7)).toBe(true);
    }
    expect(encodeQr(URLS[1]).version).toBeGreaterThan(encodeQr(URLS[0]).version);
  });

  it("draws an SVG path for every dark module run", () => {
    const qr = encodeQr(URLS[0]);
    const d = qrSvgPath(qr);
    let dark = 0;
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) dark++;
    const widths = [...d.matchAll(/h(\d+)v1/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(widths).toBe(dark);
  });

  it("builds a valid 1-bit palette PNG with the quiet zone", async () => {
    const qr = encodeQr(URLS[0]);
    const png = await qrPng(qr, 400);
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const w = dv.getUint32(16), h = dv.getUint32(20);
    const modules = qr.size + QR_BORDER * 2;
    expect(w).toBe(h);
    expect(w % modules).toBe(0);
    expect(w).toBeGreaterThanOrEqual(400);
    // collect IDAT and inflate: one filter byte + packed row per scanline
    let at = 8; const idat: Buffer[] = [];
    while (at < png.length) {
      const len = dv.getUint32(at);
      const type = String.fromCharCode(...png.slice(at + 4, at + 8));
      if (type === "IDAT") idat.push(Buffer.from(png.slice(at + 8, at + 8 + len)));
      at += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    expect(raw.length).toBe(h * (1 + Math.ceil(w / 8)));
  });

  it("never sends the invite link anywhere", () => {
    const root = path.join(__dirname, "..");
    const route = readFileSync(path.join(root, "app", "api", "portal", "qr", "route.ts"), "utf8");
    expect(route).not.toMatch(/fetch\(/);
    const orgs = readFileSync(path.join(root, "app", "portal", "admin", "organizations", "page.tsx"), "utf8");
    expect(orgs).not.toMatch(/https:\/\/api\.qrserver\.com/);
  });
});
