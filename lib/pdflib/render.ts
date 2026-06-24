/**
 * lib/pdflib/render.ts — shared primitives for the pure-pdf-lib PDF renderers.
 *
 * Why this exists: @react-pdf/renderer (our PDF engine for the CV, cover letter,
 * B2 report + passport-data sheet) can't run on Cloudflare Workers — its layout
 * engine (yoga-layout) needs RUNTIME WASM codegen, which workerd forbids. pdf-lib
 * is pure JS and runs in-process on the Worker (it already powers merge-pdf), so
 * we re-render those documents with pdf-lib when ON_WORKERS, keeping the live
 * Vercel path on @react-pdf untouched.
 *
 * pdf-lib draws from the BASELINE up, with y measured from the page BOTTOM. CSS /
 * @react-pdf think in top-left boxes. This module bridges that: a Surface whose
 * methods take a top-origin Y and convert internally, plus font wrappers that
 * expose the metrics (ascent / line-height) needed to stack text like a flex
 * column. Character "tracking" (letter-spacing) is emulated by drawing glyph by
 * glyph since pdf-lib's drawText has no character-spacing option.
 */
import { PDFDocument, PDFFont, PDFPage, rgb, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { loadPublicAsset } from "./assets";

// ── Color ────────────────────────────────────────────────────────────────────
/** "#rrggbb" (or "#rgb") → pdf-lib RGB. */
export function hexColor(hex: string): RGB {
  let h = hex.replace(/^#/, "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// ── Fonts ──────────────────────────────────────────────────────────────────--
/** An embedded font plus the metrics needed to lay it out top-down. */
export type DocFont = {
  pdf: PDFFont;
  unitsPerEm: number;
  /** Width of `text` at `size` (pt), ignoring tracking. */
  widthOf(text: string, size: number): number;
  /** Distance (pt) from the top of the line box to the baseline. */
  ascent(size: number): number;
  /** Full line advance (pt) — ascent + |descent| + lineGap. */
  lineHeight(size: number): number;
};

type FontkitMetrics = { unitsPerEm?: number; ascent?: number; descent?: number; lineGap?: number };

function wrapDocFont(pdf: PDFFont): DocFont {
  // pdf-lib's CustomFontEmbedder keeps the parsed fontkit font at .embedder.font,
  // which carries the real ascent/descent/unitsPerEm we need for vertical rhythm.
  const fk = (pdf as unknown as { embedder?: { font?: FontkitMetrics } }).embedder?.font;
  const unitsPerEm = fk?.unitsPerEm ?? 1000;
  const ascentU = fk?.ascent ?? 750;
  const descentU = fk?.descent ?? -250; // font units, negative
  const lineGapU = fk?.lineGap ?? 0;
  return {
    pdf,
    unitsPerEm,
    widthOf: (t, s) => pdf.widthOfTextAtSize(t, s),
    ascent: (s) => (ascentU / unitsPerEm) * s,
    lineHeight: (s) => ((ascentU - descentU + lineGapU) / unitsPerEm) * s,
  };
}

/**
 * Embed a set of /public/fonts/*.ttf files into `doc` (subset → small output).
 * Returns a map keyed by the filename. registerFontkit must run before embed.
 */
export async function embedFonts(
  doc: PDFDocument,
  files: string[],
): Promise<Record<string, DocFont>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc.registerFontkit(fontkit as any);
  const out: Record<string, DocFont> = {};
  for (const f of files) {
    const bytes = await loadPublicAsset(`fonts/${f}`);
    const pdf = await doc.embedFont(bytes, { subset: true });
    out[f] = wrapDocFont(pdf);
  }
  return out;
}

// ── Surface (top-origin drawing over a pdf-lib page) ──────────────────────────
export class Surface {
  constructor(public page: PDFPage, public height: number) {}

  /** Draw `text` so its top-left sits at (x, topY). `tracking` = letter-spacing (pt). */
  text(
    text: string,
    x: number,
    topY: number,
    font: DocFont,
    size: number,
    color: RGB,
    tracking = 0,
  ): void {
    const baseline = this.height - (topY + font.ascent(size));
    if (!tracking) {
      this.page.drawText(text, { x, y: baseline, size, font: font.pdf, color });
      return;
    }
    let cx = x;
    for (const ch of Array.from(text)) {
      this.page.drawText(ch, { x: cx, y: baseline, size, font: font.pdf, color });
      cx += font.widthOf(ch, size) + tracking;
    }
  }

  /** Horizontal rule with its top edge at topY. */
  hline(x1: number, x2: number, topY: number, color: RGB, thickness = 1): void {
    const y = this.height - topY - thickness / 2;
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }

  /** Filled rectangle with top-left at (x, topY). */
  rect(x: number, topY: number, w: number, h: number, color: RGB): void {
    this.page.drawRectangle({ x, y: this.height - topY - h, width: w, height: h, color });
  }
}

// ── Text measurement / wrapping ───────────────────────────────────────────────
/** Total advance width of `text` at `size` including tracking. */
export function measure(text: string, font: DocFont, size: number, tracking = 0): number {
  const base = font.widthOf(text, size);
  const n = Array.from(text).length;
  return base + (n > 1 ? tracking * (n - 1) : 0);
}

/**
 * Greedy word-wrap to `maxWidth`. Honors explicit "\n". Falls back to hard
 * character breaks for single words wider than the column (never overflows).
 */
export function wrapText(
  text: string,
  font: DocFont,
  size: number,
  maxWidth: number,
  tracking = 0,
): string[] {
  const out: string[] = [];
  const paragraphs = String(text ?? "").split("\n");
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (measure(trial, font, size, tracking) <= maxWidth || !line) {
        // If a single word is wider than the column, hard-break it.
        if (!line && measure(word, font, size, tracking) > maxWidth) {
          let chunk = "";
          for (const ch of Array.from(word)) {
            if (measure(chunk + ch, font, size, tracking) > maxWidth && chunk) {
              out.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        } else {
          line = trial;
        }
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}
