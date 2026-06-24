/**
 * lib/pdflib/passportData.ts — pure-pdf-lib re-render of components/PassportDataDocument.tsx.
 *
 * Faithful port of the @react-pdf layout so the Workers output matches Vercel's:
 *   header (gold accent + title + subtitle) → rule → field groups (2-col grid of
 *   label/value) → footer pinned to the page bottom (rule + "Generated …" + logo).
 *
 * Geometry mirrors the StyleSheet in the component 1:1 (paddings, margins, font
 * sizes, colors, letter-spacing). Vertical rhythm uses each font's real metrics
 * (see lib/pdflib/render.ts). Multi-page is supported defensively (the sheet is
 * virtually always one page); the footer is drawn once, on the last page.
 */
import { PDFDocument, PageSizes } from "pdf-lib";
import { embedFonts, hexColor, wrapText, Surface, type DocFont } from "./render";

// Type-only import — erased at compile, so the @react-pdf-importing component is
// NEVER pulled into the Workers bundle.
import type { PassportDataPdfGroup } from "@/components/PassportDataDocument";

const GOLD = hexColor("#C9A240");
const DARK = hexColor("#0f0f0f");
const LIGHT = hexColor("#999999");
const RULE = hexColor("#e8e8e8");

export async function renderPassportDataPdf(opts: {
  groups: PassportDataPdfGroup[];
  docTitle?: string;
  docSubtitle?: string;
}): Promise<Uint8Array> {
  const groups = Array.isArray(opts.groups) ? opts.groups : [];
  const docTitle = opts.docTitle ?? "Passport Data";
  const docSubtitle = opts.docSubtitle ?? "Extracted and confirmed passport information";

  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, ["Lato-Regular.ttf", "Lato-Bold.ttf", "DMSerifDisplay-Italic.ttf"]);
  const latoR = f["Lato-Regular.ttf"];
  const latoB = f["Lato-Bold.ttf"];
  const dmSerif = f["DMSerifDisplay-Italic.ttf"];

  const [PW, PH] = PageSizes.A4; // 595.28 × 841.89
  const padTop = 52;
  const padBottom = 64;
  const padX = 48;
  const contentW = PW - padX * 2; // 499.28
  const colW = contentW / 2;
  const fieldTextW = colW - 16; // field paddingRight: 16

  // Footer is pinned to the bottom (the component uses a flex:1 spacer). Its top
  // edge is fixed; reserve that band so content never collides with it.
  const logoLine = dmSerif.lineHeight(14);
  const footerH = 1 /* borderTop */ + 12 /* paddingTop */ + logoLine;
  const footerTop = PH - padBottom - footerH;
  const contentBottomLimit = footerTop - 8; // small breathing gap above footer

  let page = doc.addPage([PW, PH]);
  let s = new Surface(page, PH);
  let y = padTop;

  const newPage = () => {
    page = doc.addPage([PW, PH]);
    s = new Surface(page, PH);
    y = padTop;
  };

  // ── Header ──
  s.rect(padX, y, 28, 2, GOLD); // headerAccent
  y += 2 + 12; // accent height + marginBottom
  s.text(docTitle, padX, y, latoB, 18, DARK, 0.3); // title
  y += latoB.lineHeight(18) + 4; // + marginBottom
  s.text(docSubtitle, padX, y, latoR, 8.5, LIGHT, 0.3); // subtitle
  y += latoR.lineHeight(8.5);
  y += 28; // header marginBottom

  // ── Rule ──
  s.hline(padX, padX + contentW, y, RULE, 1);
  y += 1 + 20; // border + marginBottom

  // ── Field-height helper (handles value wrapping) ──
  const fieldHeight = (field: { label: string; value: string }): number => {
    const labelLines = wrapText((field.label ?? "").toUpperCase(), latoB, 7, fieldTextW, 0.6);
    const empty = !field.value || field.value === "—";
    const valFont: DocFont = empty ? latoR : latoB;
    const valLines = wrapText(empty ? "—" : field.value, valFont, 9.5, fieldTextW, 0.1);
    return labelLines.length * latoB.lineHeight(7) + 2 + valLines.length * valFont.lineHeight(9.5);
  };

  const drawField = (field: { label: string; value: string }, x: number, topY: number): void => {
    let yy = topY;
    for (const ln of wrapText((field.label ?? "").toUpperCase(), latoB, 7, fieldTextW, 0.6)) {
      s.text(ln, x, yy, latoB, 7, LIGHT, 0.6); // fieldLabel
      yy += latoB.lineHeight(7);
    }
    yy += 2; // label marginBottom
    const empty = !field.value || field.value === "—";
    const valFont: DocFont = empty ? latoR : latoB;
    for (const ln of wrapText(empty ? "—" : field.value, valFont, 9.5, fieldTextW, 0.1)) {
      s.text(ln, x, yy, valFont, 9.5, empty ? LIGHT : DARK, 0.1); // fieldValue / fieldEmpty
      yy += valFont.lineHeight(9.5);
    }
  };

  // ── Groups ──
  for (const group of groups) {
    const groupTitleH = latoB.lineHeight(7) + 10;
    // Keep the group title with its first row.
    const firstRowH = group.fields?.length ? fieldHeight(group.fields[0]) : 0;
    if (y + groupTitleH + firstRowH > contentBottomLimit) newPage();

    s.text((group.title ?? "").toUpperCase(), padX, y, latoB, 7, GOLD, 1.2); // groupTitle
    y += groupTitleH;

    const fields = group.fields ?? [];
    for (let i = 0; i < fields.length; i += 2) {
      const left = fields[i];
      const right = fields[i + 1];
      const rowH = Math.max(fieldHeight(left), right ? fieldHeight(right) : 0);
      if (y + rowH > contentBottomLimit) newPage();
      drawField(left, padX, y);
      if (right) drawField(right, padX + colW, y);
      y += rowH + 12; // field marginBottom
    }
    y += 22; // group marginBottom
  }

  // ── Footer (last page, pinned bottom) ──
  s.hline(padX, padX + contentW, footerTop, RULE, 1);
  const rowTop = footerTop + 1 + 12; // border + paddingTop
  const wB = dmSerif.widthOf("Borivon", 14);
  const wDot = dmSerif.widthOf(".", 14);
  const logoX = padX + contentW - (wB + wDot);
  s.text("Borivon", logoX, rowTop, dmSerif, 14, DARK);
  s.text(".", logoX + wB, rowTop, dmSerif, 14, GOLD);

  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const noteText = `Generated ${now}`;
  const noteLine = latoR.lineHeight(7);
  // alignItems:center within the footer row → vertically center the small note
  // against the taller logo line.
  s.text(noteText, padX, rowTop + (logoLine - noteLine) / 2, latoR, 7, LIGHT, 0.2);

  return doc.save();
}
