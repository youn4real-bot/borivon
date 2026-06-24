/**
 * lib/pdflib/passportSheet.ts — pure-pdf-lib re-render of the "Reisepassdaten"
 * data sheet produced by lib/passport-pdf.ts generatePassportPdf() (the auto-saved
 * passport data PDF). Uses the built-in Helvetica base font — no font files. Used
 * on Cloudflare Workers in place of the @react-pdf renderer.
 *
 * Layout mirrors generatePassportPdf: header (title + subtitle) → sections (each a
 * gray uppercase rule-underlined title + label/value rows, expired dates in red) →
 * centered footer pinned to the page bottom. Single page (data is always short).
 */
import { PDFDocument, PageSizes } from "pdf-lib";
import { embedHelvetica, hexColor, wrapText, Surface } from "./render";

export type PassportSheetRow = { label: string; value: string; warn: boolean };
export type PassportSheetGroup = { title: string; rows: PassportSheetRow[] };

// The built-in Helvetica uses WinAnsi (CP1252) encoding, which can't represent
// every character (e.g. "⚠", or scripts outside Latin-1). pdf-lib THROWS on an
// unencodable glyph, which would crash passport-sheet generation on unusual data.
// Strip anything WinAnsi can't encode so rendering is always safe. (Latin-1 covers
// German umlauts + French accents; this only drops exotic symbols / non-Latin.)
const WINANSI_SPECIALS = new Set([
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021,
  0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122, 0x0152, 0x0153, 0x0160,
  0x0161, 0x0178, 0x017d, 0x017e, 0x0192, 0x02c6, 0x02dc,
]);
function winAnsiSafe(s: string): string {
  let out = "";
  for (const chr of Array.from(s ?? "")) {
    const cp = chr.codePointAt(0) ?? 0;
    if (cp === 0x26a0) continue; // ⚠ — drop (the value is already shown in red)
    if (cp <= 0x7e || (cp >= 0xa0 && cp <= 0xff) || WINANSI_SPECIALS.has(cp)) out += chr;
  }
  return out;
}

const INK = hexColor("#1a1a1a");
const TITLE = hexColor("#0a0a0a");
const SUB = hexColor("#888888");
const LABEL = hexColor("#666666");
const WARN = hexColor("#c0392b");
const SECT = hexColor("#888888");
const RULE = hexColor("#e0e0e0");
const FOOT = hexColor("#bbbbbb");
const FOOTRULE = hexColor("#eeeeee");

export async function renderPassportSheetPdf(opts: {
  title: string;
  subtitle: string;
  footer: string;
  groups: PassportSheetGroup[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { reg, bold } = await embedHelvetica(doc);

  // Sanitize all text up front so an unencodable glyph can never throw mid-render.
  const title = winAnsiSafe(opts.title);
  const subtitle = winAnsiSafe(opts.subtitle);
  const footer = winAnsiSafe(opts.footer);
  const groups = opts.groups.map((g) => ({
    title: winAnsiSafe(g.title),
    rows: g.rows.map((r) => ({ label: winAnsiSafe(r.label), value: winAnsiSafe(r.value), warn: r.warn })),
  }));

  const [PW, PH] = PageSizes.A4;
  const pad = 48;
  const contentW = PW - pad * 2;
  const labelW = 150;
  const valueX = pad + labelW;
  const valueW = contentW - labelW;

  const page = doc.addPage([PW, PH]);
  const s = new Surface(page, PH);
  let y = pad;

  // ── Header ──
  s.text(title, pad, y, bold, 18, TITLE);
  y += bold.lineHeight(18) + 4; // title marginBottom 4
  s.text(subtitle, pad, y, reg, 8, SUB);
  y += reg.lineHeight(8);
  y += 28; // header marginBottom

  // ── Sections ──
  for (const g of groups) {
    // section title (uppercase, letterSpacing 1.2, rule under it)
    s.text(g.title.toUpperCase(), pad, y, bold, 7, SECT, 1.2);
    y += bold.lineHeight(7) + 5; // paddingBottom 5
    s.hline(pad, pad + contentW, y, RULE, 0.5);
    y += 0.5 + 8; // border + marginBottom 8

    for (const r of g.rows) {
      const valFont = bold; // value is always Helvetica-Bold; warn only changes color
      const valColor = r.warn ? WARN : INK;
      s.text(r.label, pad, y, reg, 8, LABEL);
      const lines = wrapText(r.value || "—", valFont, 9, valueW);
      let vy = y;
      for (const ln of lines) {
        s.text(ln, valueX, vy, valFont, 9, valColor);
        vy += valFont.lineHeight(9);
      }
      y += Math.max(reg.lineHeight(8), lines.length * valFont.lineHeight(9)) + 7; // row marginBottom 7
    }
    y += 20 - 7; // section marginBottom 20 (minus the last row's 7 already added)
  }

  // ── Footer (pinned bottom, centered) ──
  const footTop = PH - 28 - reg.lineHeight(7);
  s.hline(pad, pad + contentW, footTop - 6, FOOTRULE, 0.5); // borderTop + paddingTop 6
  const fw = reg.widthOf(footer, 7);
  s.text(footer, PW / 2 - fw / 2, footTop, reg, 7, FOOT);

  return doc.save();
}
