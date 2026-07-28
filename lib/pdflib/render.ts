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
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  appendBezierCurve,
  clip,
  endPath,
  type RGB,
} from "pdf-lib";
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
 * Embed the built-in standard Helvetica (regular + bold) — no font files / no
 * fontkit needed (one of the 14 PDF base fonts). Used by the passport-data sheet,
 * which renders in Helvetica. Metrics are Helvetica's AFM ratios.
 */
export async function embedHelvetica(doc: PDFDocument): Promise<{ reg: DocFont; bold: DocFont }> {
  const mk = (pdf: PDFFont): DocFont => ({
    pdf,
    unitsPerEm: 1000,
    widthOf: (t, s) => pdf.widthOfTextAtSize(t, s),
    ascent: (s) => 0.718 * s,
    lineHeight: (s) => 1.15 * s,
  });
  return {
    reg: mk(await doc.embedFont(StandardFonts.Helvetica)),
    bold: mk(await doc.embedFont(StandardFonts.HelveticaBold)),
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

  /** Draw an image into a (w × h) box with its top-left at (x, topY). */
  image(img: PDFImage, x: number, topY: number, w: number, h: number): void {
    this.page.drawImage(img, { x, y: this.height - topY - h, width: w, height: h });
  }

  /**
   * Draw an image clipped to a circle (top-left of the bounding square at
   * (x, topY), diameter = size). Mirrors @react-pdf's borderRadius:50% photo.
   */
  circleImage(img: PDFImage, x: number, topY: number, size: number): void {
    const r = size / 2;
    const cx = x + r;
    const cy = this.height - (topY + r); // pdf-space center
    const k = 0.5522847498307936 * r; // bezier circle constant × r
    this.page.pushOperators(
      pushGraphicsState(),
      moveTo(cx + r, cy),
      appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
      appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
      appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
      appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
      clip(),
      endPath(),
    );
    this.page.drawImage(img, { x, y: this.height - topY - size, width: size, height: size });
    this.page.pushOperators(popGraphicsState());
  }

  /**
   * Rounded rectangle (fill and/or border), top-left at (x, topY). Uses an SVG
   * path so corners are real arcs (pdf-lib's drawRectangle has no radius).
   */
  roundedRect(
    x: number,
    topY: number,
    w: number,
    h: number,
    r: number,
    opts: { fill?: RGB; border?: RGB; borderWidth?: number },
  ): void {
    const rr = Math.min(r, w / 2, h / 2);
    // SVG path in a y-DOWN local space; drawSvgPath anchors (0,0) at (x, y) and
    // flips for us, so y is the pdf coordinate of the box's TOP edge.
    const d =
      `M ${rr} 0 H ${w - rr} A ${rr} ${rr} 0 0 1 ${w} ${rr} ` +
      `V ${h - rr} A ${rr} ${rr} 0 0 1 ${w - rr} ${h} ` +
      `H ${rr} A ${rr} ${rr} 0 0 1 0 ${h - rr} ` +
      `V ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`;
    this.page.drawSvgPath(d, {
      x,
      y: this.height - topY,
      ...(opts.fill ? { color: opts.fill } : {}),
      ...(opts.border ? { borderColor: opts.border } : {}),
      ...(opts.borderWidth != null ? { borderWidth: opts.borderWidth } : {}),
    });
  }
}

/** No image on a CV is worth more than a few MB or a few seconds. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 8_000;

/**
 * Embed an image into `doc` from EITHER a base64 data-URI or an http(s) URL.
 *
 * THE URL CASE IS NOT OPTIONAL. Every candidate photo is stored as a Supabase
 * Storage URL — measured against the live DB: 56 of 56 profiles — and this
 * accepted data URIs only, so it returned null for every one of them and each
 * generated CV came out with no photo at all. @react-pdf/renderer fetched URLs
 * itself; when the CV was ported to pdf-lib that fetch had to come with it, and
 * didn't. Nothing threw, so the CVs just quietly lost their faces.
 *
 * The caller re-injects the TRUSTED stored photo after sanitising (lib/cvRender
 * .ts), so this is our own storage URL, not something a candidate can set.
 * Capped and timed out anyway: a hung fetch would hold a PDF request open, and
 * an enormous file would sit in Worker memory.
 *
 * Returns the PDFImage plus its intrinsic pixel size, or null if it cannot be
 * fetched or decoded — a broken photo must never fail the whole CV.
 */
export async function embedDataUriImage(
  doc: PDFDocument,
  src: string | null | undefined,
): Promise<{ image: PDFImage; width: number; height: number } | null> {
  if (!src || typeof src !== "string") return null;
  const raw = src.trim();
  let bytes: Uint8Array | null = null;

  const m = /^data:(image\/[a-z0-9.+-]+)?;base64,(.+)$/i.exec(raw);
  if (m) {
    try {
      const bin = atob(m[2]);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return null;
    }
  } else if (/^https?:\/\//i.test(raw)) {
    bytes = await fetchImageBytes(raw);
  }

  if (!bytes || !bytes.length) return null;

  try {
    // Sniff the real format rather than trusting a mime label or extension — a
    // .png that is actually a JPEG would otherwise throw and drop the photo.
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50; // \x89PNG
    const image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    return { image, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

/** GET an image URL with a hard timeout and a size cap. Never throws. */
async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "follow" });
    if (!res.ok) return null;
    // Storage sometimes serves octet-stream, and the magic-byte sniff above is
    // the real gate — so only reject what is definitely NOT an image.
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type && !type.startsWith("image/") && !type.includes("octet-stream")) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared && declared > MAX_IMAGE_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length && buf.length <= MAX_IMAGE_BYTES ? buf : null;
  } catch {
    return null;   // timeout, DNS, TLS, 404 — the CV renders without the photo
  } finally {
    clearTimeout(timer);
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
