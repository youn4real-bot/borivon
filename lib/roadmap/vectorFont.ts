/**
 * Draw text in the website's own display font (Playfair Display) inside a
 * pdf-lib PDF, so the Fahrplan PDF matches borivon.com exactly.
 *
 * Why outlines and not an embedded font: the site ships Playfair only as WOFF2
 * (public/pflege/assets), and pdf-lib's fontkit can read WOFF2 but cannot
 * subset/embed it (it walks a raw `glyf` table WOFF2 doesn't have; measured:
 * RangeError, and a whole-font embed hangs). So we let fontkit lay the text out
 * (kerning included) and paint each glyph's outline as a vector path. It looks
 * identical and stays sharp; only these headings are not selectable as text,
 * the body copy stays real Lexend text.
 *
 * The site sets headings at weight 500; the WOFF2 is a variable font whose
 * default is 400 and fontkit's getVariation() crashes on WOFF2 (no cmap on the
 * derived font). `embolden` adds a hairline stroke in the fill colour instead
 * (a fraction of the em, e.g. 0.012 ≈ 500).
 */
import fontkit from "@pdf-lib/fontkit";
import type { PDFPage, RGB } from "pdf-lib";
import { loadPublicAsset } from "@/lib/pdflib/assets";

/* eslint-disable @typescript-eslint/no-explicit-any */
type FkGlyph = { id: number; path: { scale(x: number, y: number): { toSVG(): string } } };
type FkRun = { glyphs: FkGlyph[]; positions: { xAdvance: number; xOffset: number; yOffset: number }[]; advanceWidth: number };
type FkFont = { unitsPerEm: number; ascent: number; capHeight?: number; layout(t: string): FkRun };

export type VectorFont = {
  ascent(size: number): number;
  measure(text: string, size: number, tracking?: number): number;
  /** Draw `text` with its top-left at (x, top) in TOP-origin page space. */
  draw(page: PDFPage, pageHeight: number, text: string, x: number, top: number, size: number, color: RGB, tracking?: number): void;
  /** Stroke width (fraction of the em) added to every glyph. */
  embolden: number;
};

const fonts = new Map<string, Promise<VectorFont>>();

export function loadVectorFont(relPath: string, embolden = 0): Promise<VectorFont> {
  const key = `${relPath}@${embolden}`;
  let p = fonts.get(key);
  if (!p) {
    p = (async () => {
      const font = (fontkit as any).create(await loadPublicAsset(relPath)) as FkFont;
      const upm = font.unitsPerEm;
      // "top" = a little above the capitals, NOT the font's ascent: Playfair's
      // ascent is 1.08 em, so an ascent-based top left lines overlapping
      // whatever came next (measured on the PDF). With this, a line of size s
      // spans about [top, top + 1.1 s] including descenders, like Lexend.
      const topToBase = (font.capHeight ? font.capHeight / upm : 0.71) + 0.13;
      const svg = new Map<number, string>();
      const d = (g: FkGlyph) => {
        let s = svg.get(g.id);
        if (s === undefined) { s = g.path.scale(1, -1).toSVG(); svg.set(g.id, s); }
        return s;
      };
      return {
        embolden,
        ascent: (size) => topToBase * size,
        measure: (text, size, tracking = 0) => {
          const run = font.layout(text);
          return (run.advanceWidth / upm) * size + tracking * Math.max(0, run.glyphs.length - 1);
        },
        draw: (page, pageHeight, text, x, top, size, color, tracking = 0) => {
          const run = font.layout(text);
          const k = size / upm;
          const base = pageHeight - (top + topToBase * size);
          let cx = x;
          run.glyphs.forEach((g, i) => {
            const pos = run.positions[i];
            const path = d(g);
            if (path) page.drawSvgPath(path, { x: cx + pos.xOffset * k, y: base + pos.yOffset * k, scale: k, color, ...(embolden ? { borderColor: color, borderWidth: embolden * upm } : {}) });
            cx += pos.xAdvance * k + tracking;
          });
        },
      } satisfies VectorFont;
    })();
    fonts.set(key, p);
    p.catch(() => fonts.delete(key));
  }
  return p;
}

/** Greedy word wrap for a VectorFont. */
export function wrapVector(text: string, vf: VectorFont, size: number, maxWidth: number, tracking = 0): string[] {
  const out: string[] = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word;
      if (!line || vf.measure(trial, size, tracking) <= maxWidth) line = trial;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}
