/**
 * lib/pdflib/b2report.ts — pure-pdf-lib re-render of components/B2ReportDocument.tsx.
 *
 * Admin "B2-Status" export: Borivon. logo header + contact footer per page, a
 * title + count, a colored-dot summary row, then one block per candidate (colored
 * status dot, name, level, right-aligned stage label, German detail, meta). Rows
 * are keep-together; pages get the fixed chrome afterwards. Mirrors the @react-pdf
 * layout so the Workers output matches Vercel.
 */
import { PDFDocument, PageSizes } from "pdf-lib";
import { embedFonts, hexColor, Surface, wrapText } from "./render";
import { B2_STAGE_BY_KEY, type B2Stage } from "@/lib/b2Journey";
import type { B2ReportRow } from "@/components/B2ReportDocument";

const DARK = hexColor("#1C1C1E");
const GOLD = hexColor("#C9A84C");
const MUTED = hexColor("#6B7280");
const DIVIDER = hexColor("#E2E6EA");
const SEP = hexColor("#EDEFF1");
const FOOTER_COLOR = hexColor("#9CA3AF");
const HEADER_H = 80;
const FOOTER_H = 56;
const LH = 1.45;

const deDate = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
};
const statusDe = (stage: B2Stage): string =>
  stage === "passed" ? "B2 bestanden"
  : stage === "awaiting_results" ? "Prüfung abgelegt – Ergebnis ausstehend"
  : stage === "exam_booked" ? "Prüfungstermin gebucht & bezahlt (bestätigt)"
  : stage === "expected_date" ? "Voraussichtlicher Termin bestätigt"
  : "Lernphase – sucht noch einen Termin";

export async function renderB2ReportPdf(rows: B2ReportRow[], generatedAt: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, ["Lexend-Regular.ttf", "Lexend-Bold.ttf", "DMSerifDisplay-Italic.ttf"]);
  const reg = f["Lexend-Regular.ttf"];
  const bold = f["Lexend-Bold.ttf"];
  const serif = f["DMSerifDisplay-Italic.ttf"];

  const [PW, PH] = PageSizes.A4;
  const padL = 44;
  const padR = 44;
  const contentW = PW - padL - padR;
  const contentTop = HEADER_H;
  const contentBottom = PH - FOOTER_H;
  const adv = (size: number, mult = LH) => size * mult;

  const counts = new Map<B2Stage, number>();
  for (const r of rows) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  const summary = (Object.values(B2_STAGE_BY_KEY) as { key: string; position: number; color: string; label: { de: string } }[])
    .sort((a, b) => a.position - b.position)
    .map((d) => ({ ...d, n: counts.get(d.key as B2Stage) ?? 0 }))
    .filter((d) => d.n > 0);

  const pages: Surface[] = [];
  let surf!: Surface;
  let y = contentTop;
  const addPage = () => {
    const page = doc.addPage([PW, PH]);
    surf = new Surface(page, PH);
    pages.push(surf);
    y = contentTop;
  };
  const fits = (h: number) => y + h <= contentBottom + 0.01;
  addPage();

  // Title + sub
  surf.text("B2-Status", padL, y, bold, 17, DARK);
  y += adv(17);
  y += 2; // sub marginTop
  surf.text(`${rows.length} Kandidat${rows.length === 1 ? "" : "en"} · ${generatedAt}`, padL, y, reg, 9, MUTED);
  y += adv(9) + 10; // sub marginBottom

  // Summary row (colored dots + counts), flex-wrap, gap 10, marginBottom 10
  {
    const lineH = adv(8.5);
    let sx = padL;
    for (const dseg of summary) {
      const label = `${dseg.n} ${dseg.label.de}`;
      const textW = reg.widthOf(label, 8.5);
      const itemW = 6 + 4 + textW; // dot + gap + text
      if (sx > padL && sx + itemW > padL + contentW) { sx = padL; y += lineH + 4; }
      surf.roundedRect(sx, y + (lineH - 6) / 2, 6, 6, 3, { fill: hexColor(dseg.color) });
      surf.text(label, sx + 6 + 4, y, reg, 8.5, MUTED);
      sx += itemW + 10; // gap 10
    }
    y += lineH + 10;
  }

  // Rule
  surf.hline(padL, padL + contentW, y, DIVIDER, 1);
  y += 1 + 12;

  // ── Rows ──
  const STAGE_MAXW = 230;
  const measureRow = (r: B2ReportRow, isLast: boolean): number => {
    const stageLines = wrapText(statusDe(r.stage), bold, 9.5, STAGE_MAXW);
    const headH = Math.max(adv(12), stageLines.length * adv(9.5), 7);
    const detailText = r.german || "Noch keine B2-Angaben im CV ausgefüllt";
    const detailH = 4 + wrapText(detailText, reg, 9.5, contentW - 12).length * adv(9.5);
    const metaBits = [
      r.examDate ? `Prüfungstermin: ${deDate(r.examDate)}` : null,
      r.failed ? (r.stage === "passed" ? "bestanden nach Wiederholung" : "schon einmal nicht bestanden") : null,
    ].filter(Boolean).join("   ·   ");
    const metaH = metaBits ? 3 + wrapText(metaBits, reg, 8.5, contentW - 12).length * adv(8.5) : 0;
    const sepH = isLast ? 0 : 10 + 0.5;
    return headH + detailH + metaH + sepH + 12; // + row marginBottom
  };

  rows.forEach((r, i) => {
    const isLast = i === rows.length - 1;
    const rowH = measureRow(r, isLast);
    if (!fits(rowH)) addPage();

    const def = B2_STAGE_BY_KEY[r.stage] as { color: string };
    const stageColor = hexColor(def.color);

    // rowHead: name group (left) + stage (right, maxWidth 230)
    const headTop = y;
    // dot (7) + name (12 bold) + optional level (8 bold gold)
    const nameLineH = adv(12);
    surf.roundedRect(padL, headTop + (nameLineH - 7) / 2, 7, 7, 3.5, { fill: stageColor });
    let nx = padL + 7 + 5; // gap 5
    surf.text(r.name, nx, headTop, bold, 12, DARK);
    nx += bold.widthOf(r.name, 12) + 5;
    if (r.germanLevel) {
      // baseline-align the small level chip to the name
      const drop = bold.ascent(12) - bold.ascent(8);
      surf.text(r.germanLevel, nx, headTop + drop, bold, 8, GOLD);
    }
    // stage, right-aligned within [.., padL+contentW]
    const stageLines = wrapText(statusDe(r.stage), bold, 9.5, STAGE_MAXW);
    let sy = headTop;
    for (const ln of stageLines) {
      surf.text(ln, padL + contentW - bold.widthOf(ln, 9.5), sy, bold, 9.5, stageColor);
      sy += adv(9.5);
    }
    const headH = Math.max(nameLineH, stageLines.length * adv(9.5), 7);
    y = headTop + headH;

    // detail
    y += 4;
    const detailText = r.german || "Noch keine B2-Angaben im CV ausgefüllt";
    const detailColor = r.german ? DARK : MUTED;
    for (const ln of wrapText(detailText, reg, 9.5, contentW - 12)) {
      surf.text(ln, padL + 12, y, reg, 9.5, detailColor);
      y += adv(9.5);
    }

    // meta
    const metaBits = [
      r.examDate ? `Prüfungstermin: ${deDate(r.examDate)}` : null,
      r.failed ? (r.stage === "passed" ? "bestanden nach Wiederholung" : "schon einmal nicht bestanden") : null,
    ].filter(Boolean).join("   ·   ");
    if (metaBits) {
      y += 3;
      for (const ln of wrapText(metaBits, reg, 8.5, contentW - 12)) {
        surf.text(ln, padL + 12, y, reg, 8.5, MUTED);
        y += adv(8.5);
      }
    }

    // separator
    if (!isLast) {
      y += 10;
      surf.hline(padL, padL + contentW, y, SEP, 0.5);
      y += 0.5;
    }
    y += 12; // row marginBottom
  });

  // ── Per-page chrome ──
  for (const s of pages) {
    const wB = serif.widthOf("Borivon", 22);
    const wDot = serif.widthOf(".", 22);
    const lx = PW / 2 - (wB + wDot) / 2;
    s.text("Borivon", lx, 18, serif, 22, DARK);
    s.text(".", lx + wB, 18, serif, 22, GOLD);
    const fLineH = adv(7.5, 1.55);
    s.text("contact@borivon.com", PW / 2 - reg.widthOf("contact@borivon.com", 7.5) / 2, PH - 11 - fLineH, reg, 7.5, FOOTER_COLOR);
  }

  return doc.save();
}
