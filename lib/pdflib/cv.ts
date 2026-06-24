/**
 * lib/pdflib/cv.ts — pure-pdf-lib re-render of components/CVDocument.tsx.
 *
 * This is THE document that gated the Vercel→Cloudflare move: the German CV the
 * bot emails (resolveOutboundAttachments) and publishes (generateAndPublishCv),
 * plus /api/portal/cv/{generate,visa,live-file}. @react-pdf can't run on workerd
 * (yoga WASM), so this reproduces the same layout with pdf-lib (pure JS, in-process).
 *
 * Faithful to CVDocument.tsx: same fonts, colors, sizes, the density scaler that
 * keeps the CV ≤2 pages, per-page fixed header (logo) + footer (contact lines) +
 * page numbers, the circular photo, rounded EDV chips, and the keep-together
 * (wrap=false) entry blocks. Vertical rhythm uses the page lineHeight 1.45 like
 * the component. Verified against the @react-pdf original via pixel rasterization.
 */
import { PDFDocument, PageSizes } from "pdf-lib";
import {
  embedFonts,
  embedDataUriImage,
  hexColor,
  measure,
  wrapText,
  Surface,
  type DocFont,
} from "./render";
import type { CVData, CVBrand, WorkEntry, EduEntry, MonthYear } from "@/components/CVDocument";

// ── Design tokens (mirror CVDocument.tsx) ──
const DARK = hexColor("#1C1C1E");
const NAVY = hexColor("#1a3a5c");
const GOLD = hexColor("#C9A84C");
const MUTED = hexColor("#6B7280");
const DIVIDER = hexColor("#E2E6EA");
const FOOTER_COLOR = hexColor("#9CA3AF");
const CHIP_BG = hexColor("#F9FAFB");
const BLACK = hexColor("#000000");

const HEADER_H = 80;
const FOOTER_H = 56;
const LH = 1.45; // page default lineHeight

// ── Small helpers (copied 1:1 from the component) ──
function fmtMY(my: MonthYear): string {
  if (!my.month || !my.year) return "";
  return `${my.month}.${my.year}`;
}
function dateRange(start: MonthYear, end: MonthYear | null): string {
  const s = fmtMY(start);
  const e = end ? fmtMY(end) : "aktuell";
  if (!s) return "";
  return `${s} – ${e}`;
}
function nursingLabel(status: string, degree: string): string {
  if (status === "year1") return `${degree} (1. Ausbildungsjahr)`;
  if (status === "year2") return `${degree} (2. Ausbildungsjahr)`;
  if (status === "year3") return `${degree} (3. Ausbildungsjahr)`;
  return degree;
}

type Spacing = {
  entryMb: number; titleMb: number; subtitleMb: number; deptMt: number;
  bulletMt: number; sectionMb: number; sectionHeadMb: number;
  pdRowMb: number; sigMt: number; sigSpace: number;
};

export async function renderCvPdf(data: CVData, brand?: CVBrand): Promise<Uint8Array> {
  const noBranding = !!brand?.noBranding;
  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, [
    "Lexend-Regular.ttf",
    "Lexend-SemiBold.ttf",
    "Lexend-Bold.ttf",
    "DMSerifDisplay-Italic.ttf",
  ]);
  const reg = f["Lexend-Regular.ttf"];
  const semi = f["Lexend-SemiBold.ttf"];
  const bold = f["Lexend-Bold.ttf"];
  const serif = f["DMSerifDisplay-Italic.ttf"];

  const [PW, PH] = PageSizes.A4;
  const padL = 44;
  const padR = 44;
  const contentW = PW - padL - padR; // 507.28
  const contentTop = noBranding ? 36 : HEADER_H;
  const contentBottom = PH - (noBranding ? 36 : FOOTER_H);

  // ── Data prep (mirror CVDocument) ──
  const fullName = [data.firstName, data.lastName].filter(Boolean).join(" ");
  const footerLines = brand?.footerLines?.length ? brand.footerLines : ["contact@borivon.com"];
  const allNationalities = [data.nationality, ...(data.additionalNationalities ?? [])].filter(Boolean);

  let addressLine = data.address;
  const addrNum = (data.addressNumber ?? "").trim();
  if (addrNum && data.address) {
    const esc = addrNum.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const trailing = new RegExp(`\\s+${esc}\\s*$`);
    if (trailing.test(data.address)) addressLine = data.address.replace(trailing, "") + ` NR ${addrNum}`;
  }
  const fullAddress = [
    addressLine,
    [data.postalCode, data.city].filter(Boolean).join(" "),
    data.countryOfResidence,
  ].filter(Boolean).join(", ");

  const sortByStart = <T extends { start: MonthYear; id: string }>(arr: T[]): T[] => {
    const dated = arr
      .filter((e) => e.start.month && e.start.year)
      .sort((a, b) =>
        parseInt(b.start.year) * 12 + parseInt(b.start.month) -
        (parseInt(a.start.year) * 12 + parseInt(a.start.month)),
      );
    return [...dated, ...arr.filter((e) => !dated.find((d) => d.id === e.id))];
  };
  const allWork = sortByStart(data.workEntries);
  const allEdu = sortByStart(data.eduEntries);
  const allEdv = [...data.edvSelected, ...data.edvCustomInputs.filter(Boolean)];

  const isDeutsch = (n: string | undefined) => (n ?? "").trim().toLowerCase() === "deutsch";
  const activeLangs = (() => {
    const all = data.langs.filter((l) => l.name && l.level);
    return [...all.filter((l) => !isDeutsch(l.name)), ...all.filter((l) => isDeutsch(l.name))];
  })();

  // ── Density scaler (copied exactly) ──
  const bulletCount = data.workEntries.reduce(
    (n, e) => n + (e.taetigkeiten ?? []).filter((b) => (b ?? "").trim()).length, 0,
  );
  const densityScore = allWork.length + allEdu.length + bulletCount * 0.5;
  const d = densityScore <= 12 ? 1.0 : densityScore <= 18 ? 0.72 : densityScore <= 26 ? 0.5 : 0.4;
  const sp: Spacing = {
    entryMb: Math.max(3.5, 6 * d),
    titleMb: Math.max(0.5, 1.5 * d),
    subtitleMb: Math.max(0.5, 1 * d),
    deptMt: Math.max(0.5, 1.5 * d),
    bulletMt: Math.max(1, 2.5 * d),
    sectionMb: Math.max(7, 14 * d),
    sectionHeadMb: Math.max(3, 6 * d),
    pdRowMb: Math.max(2, 3.5 * d),
    sigMt: Math.max(8, 16 * d),
    sigSpace: Math.max(18, 28 * d),
  };

  // ── Pre-embed images ──
  const photo = await embedDataUriImage(doc, data.photo);
  const logo = !noBranding && brand?.logoSrc ? await embedDataUriImage(doc, brand.logoSrc) : null;

  // ── Layout engine ──
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

  const lineAdv = (size: number, mult = LH) => size * mult;

  /** Draw wrapped lines from top-origin; returns consumed height. */
  const drawLines = (
    lines: string[], x: number, topY: number, font: DocFont, size: number,
    color = DARK, mult = LH, tracking = 0,
  ): number => {
    let yy = topY;
    for (const ln of lines) {
      surf.text(ln, x, yy, font, size, color, tracking);
      yy += lineAdv(size, mult);
    }
    return lines.length * lineAdv(size, mult);
  };

  // ── Section header (accent bar + navy uppercase title) → returns height ──
  const SECTION_TITLE_SIZE = 7.5;
  const drawSectionHead = (title: string, mb: number): number => {
    const rowH = Math.max(9, lineAdv(SECTION_TITLE_SIZE));
    surf.rect(padL, y + (rowH - 9) / 2, 2.5, 9, GOLD); // accentBar
    const tx = padL + 2.5 + 5; // bar width + marginRight
    surf.text(title.toUpperCase(), tx, y + (rowH - lineAdv(SECTION_TITLE_SIZE)) / 2, bold, SECTION_TITLE_SIZE, NAVY, 1.6);
    return rowH + 3 + mb; // paddingBottom 3 + marginBottom
  };

  // ── Measurement: work entry right-column height ──
  const RIGHT_X = padL + 105;
  const RIGHT_W = contentW - 105;
  const measureWork = (e: WorkEntry): number => {
    if (e.isGap) {
      const reason = (e.gapReason ?? "").trim();
      let h = lineAdv(8.5);
      if (reason) h += wrapText(reason, reg, 8, RIGHT_W).length * lineAdv(8);
      return Math.max(h, lineAdv(8) + 1);
    }
    let h = 0;
    if (e.title) h += wrapText(e.title, bold, 9, RIGHT_W).length * lineAdv(9) + sp.titleMb;
    const sub = [e.employer, e.location, e.country].filter(Boolean).join(" · ");
    if (sub) h += wrapText(sub, reg, 8, RIGHT_W).length * lineAdv(8) + sp.subtitleMb;
    for (const site of e.additionalSites ?? []) {
      const line = [site.employer, site.location, site.country].filter(Boolean).join(" · ");
      if (line) h += wrapText(line, reg, 8, RIGHT_W).length * lineAdv(8) + sp.subtitleMb;
    }
    if (e.departments.length) h += sp.deptMt + wrapText(e.departments.join("  ·  "), reg, 8, RIGHT_W).length * lineAdv(8);
    for (const raw of e.taetigkeiten ?? []) {
      const b = (raw ?? "").trim();
      if (b) h += sp.bulletMt + wrapText(b, reg, 8, RIGHT_W - 8).length * lineAdv(8, 1.4);
    }
    return Math.max(h, lineAdv(8) + 1);
  };
  const measureEdu = (e: EduEntry): number => {
    const label = e.type === "nursing"
      ? nursingLabel(e.nursingStatus, e.degree || "Krankenpflegediplom")
      : (e.degree || "");
    let h = 0;
    if (label) h += wrapText(label, bold, 9, RIGHT_W).length * lineAdv(9) + sp.titleMb;
    if (e.type === "abitur" && e.abiturFocus?.trim())
      h += wrapText(`Schwerpunkt: ${e.abiturFocus.trim()}`, reg, 8, RIGHT_W).length * lineAdv(8) + sp.subtitleMb;
    const inst = [e.institution, e.location, e.country].filter(Boolean).join(" · ");
    if (inst) h += wrapText(inst, reg, 8, RIGHT_W).length * lineAdv(8) + sp.subtitleMb;
    if (e.type === "nursing" && e.nursingStatus === "complete" && e.diplomaIssued?.month && e.diplomaIssued?.year)
      h += wrapText(`Diplom ausgestellt: ${fmtMY(e.diplomaIssued)}`, reg, 8, RIGHT_W).length * lineAdv(8) + sp.subtitleMb;
    return Math.max(h, lineAdv(8) + 1);
  };

  // ── Draw one work / edu entry at current y (assumes it fits) ──
  const drawEntry = (dr: string, rightHeight: number, drawRight: (topY: number) => void): void => {
    surf.text(dr, padL, y + 1, reg, 8, MUTED); // entryDate, paddingTop 1
    drawRight(y);
    y += Math.max(rightHeight, lineAdv(8) + 1) + sp.entryMb;
  };
  const drawWork = (e: WorkEntry, rightH: number): void => {
    const dr = dateRange(e.start, e.end);
    drawEntry(dr, rightH, (topY) => {
      let ry = topY;
      if (e.isGap) {
        surf.text("Nicht berufstätig", RIGHT_X, ry, reg, 8.5, MUTED);
        ry += lineAdv(8.5);
        const reason = (e.gapReason ?? "").trim();
        if (reason) drawLines(wrapText(reason, reg, 8, RIGHT_W), RIGHT_X, ry, reg, 8, MUTED);
        return;
      }
      if (e.title) ry += drawLines(wrapText(e.title, bold, 9, RIGHT_W), RIGHT_X, ry, bold, 9, DARK) + sp.titleMb;
      const sub = [e.employer, e.location, e.country].filter(Boolean).join(" · ");
      if (sub) ry += drawLines(wrapText(sub, reg, 8, RIGHT_W), RIGHT_X, ry, reg, 8, MUTED) + sp.subtitleMb;
      for (const site of e.additionalSites ?? []) {
        const line = [site.employer, site.location, site.country].filter(Boolean).join(" · ");
        if (line) ry += drawLines(wrapText(line, reg, 8, RIGHT_W), RIGHT_X, ry, reg, 8, MUTED) + sp.subtitleMb;
      }
      if (e.departments.length) {
        ry += sp.deptMt;
        ry += drawLines(wrapText(e.departments.join("  ·  "), reg, 8, RIGHT_W), RIGHT_X, ry, reg, 8, GOLD);
      }
      for (const raw of e.taetigkeiten ?? []) {
        const b = (raw ?? "").trim();
        if (!b) continue;
        ry += sp.bulletMt;
        surf.text("•", RIGHT_X, ry, reg, 8.5, NAVY);
        const lines = wrapText(b, reg, 8, RIGHT_W - 8);
        ry += drawLines(lines, RIGHT_X + 8, ry, reg, 8, DARK, 1.4);
      }
    });
  };
  const drawEdu = (e: EduEntry, rightH: number): void => {
    const dr = dateRange(e.start, e.end);
    const label = e.type === "nursing"
      ? nursingLabel(e.nursingStatus, e.degree || "Krankenpflegediplom")
      : (e.degree || "");
    drawEntry(dr, rightH, (topY) => {
      let ry = topY;
      if (label) ry += drawLines(wrapText(label, bold, 9, RIGHT_W), RIGHT_X, ry, bold, 9, DARK) + sp.titleMb;
      if (e.type === "abitur" && e.abiturFocus?.trim())
        ry += drawLines(wrapText(`Schwerpunkt: ${e.abiturFocus.trim()}`, reg, 8, RIGHT_W), RIGHT_X, ry, reg, 8, MUTED) + sp.subtitleMb;
      const inst = [e.institution, e.location, e.country].filter(Boolean).join(" · ");
      if (inst) ry += drawLines(wrapText(inst, reg, 8, RIGHT_W), RIGHT_X, ry, reg, 8, MUTED) + sp.subtitleMb;
      if (e.type === "nursing" && e.nursingStatus === "complete" && e.diplomaIssued?.month && e.diplomaIssued?.year)
        ry += drawLines(wrapText(`Diplom ausgestellt: ${fmtMY(e.diplomaIssued)}`, reg, 8, RIGHT_W), RIGHT_X, ry, reg, 8, MUTED) + sp.subtitleMb;
    });
  };

  // ─────────────────────── CONTENT ───────────────────────

  // Document title "Lebenslauf"
  y += 10; // marginTop
  surf.text("LEBENSLAUF", padL, y, semi, 7, GOLD, 2.2);
  y += lineAdv(7) + 10; // line + marginBottom

  // ── PERSÖNLICHE DATEN ──
  y += drawSectionHead("Persönliche Daten", sp.sectionHeadMb);
  {
    const pdTextW = contentW - 96 - 14; // minus photo(88)+gap(8), minus paddingRight(14)
    const valX = padL + 105;
    const valW = pdTextW - 105;
    const rows: [string, string][] = [];
    const push = (label: string, value: string) => { if (value) rows.push([label, value]); };
    push("Vorname", data.firstName);
    push("Nachname", data.lastName);
    push("Geburtsdatum", data.birthDate);
    push("Geburtsort", [data.birthPlace, data.countryOfBirth].filter(Boolean).join(", "));
    if (allNationalities.length) push("Staatsangehörigkeit", allNationalities.join(", "));
    push("Familienstand", data.maritalStatus);
    push("Adresse", fullAddress);
    push("Telefon", data.phone);
    push("E-Mail", data.email);

    const rowsTop = y;
    let ry = y;
    for (const [label, value] of rows) {
      surf.text(label, padL, ry, reg, 8, MUTED);
      const vlines = wrapText(value, reg, 8.5, valW);
      const vh = drawLines(vlines, valX, ry, reg, 8.5, DARK);
      ry += Math.max(lineAdv(8), vh) + sp.pdRowMb;
    }
    const rowsH = ry - rowsTop;
    if (photo) surf.circleImage(photo.image, padL + contentW - 96, rowsTop - 6, 88);
    y = rowsTop + Math.max(rowsH, photo ? 82 : 0) + sp.sectionMb;
  }

  // ── BERUFSERFAHRUNG ──
  if (allWork.length) {
    const headH = drawSectionHeadMeasure("Berufserfahrung", sp.sectionHeadMb);
    const firstH = measureWork(allWork[0]) + sp.entryMb;
    if (!fits(headH + firstH)) addPage();
    y += drawSectionHead("Berufserfahrung", sp.sectionHeadMb);
    drawWork(allWork[0], measureWork(allWork[0]));
    for (const e of allWork.slice(1)) {
      const h = measureWork(e) + sp.entryMb;
      if (!fits(h)) addPage();
      drawWork(e, measureWork(e));
    }
    y += sp.sectionMb;
  }

  // ── BILDUNGSWEG ──
  if (allEdu.length) {
    const headH = drawSectionHeadMeasure("Bildungsweg", sp.sectionHeadMb);
    const firstH = measureEdu(allEdu[0]) + sp.entryMb;
    if (!fits(headH + firstH)) addPage();
    y += drawSectionHead("Bildungsweg", sp.sectionHeadMb);
    drawEdu(allEdu[0], measureEdu(allEdu[0]));
    for (const e of allEdu.slice(1)) {
      const h = measureEdu(e) + sp.entryMb;
      if (!fits(h)) addPage();
      drawEdu(e, measureEdu(e));
    }
    y += sp.sectionMb;
  }

  // ── SPRACHKENNTNISSE (keep-together) ──
  if (activeLangs.length) {
    const langItems = activeLangs.map((l) => {
      const dch = isDeutsch(l.name);
      const raw = l.level ?? "";
      const lvl = !dch ? raw : raw === "A1" || raw === "A2" ? raw : raw === "B2" && l.b2?.result === "full" ? "B2" : "B1";
      return { name: `${l.name}:`, level: lvl };
    });
    // flex-wrap row: name(bold 9) + " " + level(8 muted), marginRight 20, marginBottom 3
    const rowsLaid = layoutLangRow(langItems, bold, reg, contentW);
    const blockH = drawSectionHeadMeasure("Sprachkenntnisse", sp.sectionHeadMb) + rowsLaid.height;
    if (!fits(blockH)) addPage();
    y += drawSectionHead("Sprachkenntnisse", sp.sectionHeadMb);
    for (const it of rowsLaid.items) {
      surf.text(it.name, padL + it.x, y + it.lineY, bold, 9, DARK);
      surf.text(it.level, padL + it.x + it.nameW + 3, y + it.levelTopY, reg, 8, MUTED);
    }
    y += rowsLaid.height + sp.sectionMb;
  }

  // ── EDV-KENNTNISSE (keep-together) ──
  if (allEdv.length) {
    const chips = layoutChips(allEdv, reg, contentW);
    const blockH = drawSectionHeadMeasure("EDV-Kenntnisse", sp.sectionHeadMb) + chips.height;
    if (!fits(blockH)) addPage();
    y += drawSectionHead("EDV-Kenntnisse", sp.sectionHeadMb);
    for (const c of chips.items) {
      surf.roundedRect(padL + c.x, y + c.y, c.w, c.h, 3, { fill: CHIP_BG, border: DIVIDER, borderWidth: 0.5 });
      surf.text(c.label, padL + c.x + 6, y + c.y + 2.5, reg, 8, DARK);
    }
    y += chips.height + sp.sectionMb;
  }

  // ── SONSTIGES + UNTERSCHRIFT (keep-together) ──
  {
    const hasSonstiges = data.driverLicense === "B" || !!data.hobbies;
    let blockH = 0;
    if (hasSonstiges) {
      blockH += drawSectionHeadMeasure("Sonstiges", sp.sectionHeadMb);
      if (data.driverLicense === "B") blockH += Math.max(lineAdv(8), lineAdv(8.5)) + sp.pdRowMb;
      if (data.hobbies) blockH += Math.max(lineAdv(8), wrapText(data.hobbies, reg, 8.5, contentW - 105).length * lineAdv(8.5)) + sp.pdRowMb;
      blockH += sp.sectionMb;
    }
    const sigBlockH = sp.sigMt + sp.sigSpace + 0.5 + 3 + lineAdv(7.5);
    if (!fits(blockH + sigBlockH)) addPage();

    if (hasSonstiges) {
      y += drawSectionHead("Sonstiges", sp.sectionHeadMb);
      if (data.driverLicense === "B") {
        surf.text("Führerschein", padL, y, reg, 8, MUTED);
        surf.text("Klasse B", padL + 105, y, reg, 8.5, DARK);
        y += Math.max(lineAdv(8), lineAdv(8.5)) + sp.pdRowMb;
      }
      if (data.hobbies) {
        surf.text("Interessen", padL, y, reg, 8, MUTED);
        const hl = wrapText(data.hobbies, reg, 8.5, contentW - 105);
        const hh = drawLines(hl, padL + 105, y, reg, 8.5, DARK);
        y += Math.max(lineAdv(8), hh) + sp.pdRowMb;
      }
      y += sp.sectionMb;
    }

    // signature: two slots (width 115), space-between
    y += sp.sigMt;
    const sigTop = y + sp.sigSpace;
    const drawSig = (x: number, label: string) => {
      surf.hline(x, x + 115, sigTop, MUTED, 0.5);
      surf.text(label, x, sigTop + 3, reg, 7.5, MUTED);
    };
    drawSig(padL, "Ort, Datum");
    drawSig(padL + contentW - 115, "Unterschrift");
    y = sigTop + 0.5 + 3 + lineAdv(7.5);
  }

  // ─────────────── PER-PAGE CHROME (deferred) ───────────────
  const total = pages.length;
  for (let i = 0; i < total; i++) {
    const s = pages[i];
    if (!noBranding) {
      // Header logo (centered, top 18)
      if (logo) {
        let w = 46 * (logo.width / logo.height);
        let h = 46;
        if (w > 240) { w = 240; h = 240 * (logo.height / logo.width); }
        s.image(logo.image, PW / 2 - w / 2, 18, w, h);
      } else {
        const wB = serif.widthOf("Borivon", 22);
        const wDot = serif.widthOf(".", 22);
        const lx = PW / 2 - (wB + wDot) / 2;
        s.text("Borivon", lx, 18, serif, 22, DARK);
        s.text(".", lx + wB, 18, serif, 22, GOLD);
      }
      // Footer lines (centered, pinned to bottom)
      const fLineH = lineAdv(7.5, 1.55);
      const totalFH = footerLines.length * fLineH;
      let fy = PH - 11 - totalFH; // paddingBottom 11
      for (const line of footerLines) {
        const lw = measure(line, reg, 7.5);
        s.text(line, PW / 2 - lw / 2, fy, reg, 7.5, FOOTER_COLOR);
        fy += fLineH;
      }
    }
    // Page number (multi-page only), bottom-right, black bold
    if (total > 1) {
      const label = `${i + 1} / ${total}`;
      const lw = measure(label, bold, 8);
      s.text(label, PW - padR - lw, PH - 18 - lineAdv(8), bold, 8, BLACK);
    }
  }

  return doc.save();

  // ── inner helpers that need sp/fonts but not surf state ──
  function drawSectionHeadMeasure(_title: string, mb: number): number {
    return Math.max(9, lineAdv(SECTION_TITLE_SIZE)) + 3 + mb;
  }
}

// ── Language row flex-wrap layout (name + level), baseline-aligned ──
function layoutLangRow(
  items: { name: string; level: string }[],
  nameFont: DocFont,
  levelFont: DocFont,
  maxW: number,
): { items: { x: number; lineY: number; levelTopY: number; nameW: number; name: string; level: string }[]; height: number } {
  const lineH = 9 * 1.45;
  const rowGap = 3; // langItem marginBottom
  // baseline-align: name(9) at line top; level(8) shifted so baselines match.
  const levelDrop = nameFont.ascent(9) - levelFont.ascent(8);
  const out: { x: number; lineY: number; levelTopY: number; nameW: number; name: string; level: string }[] = [];
  let x = 0;
  let line = 0;
  for (const it of items) {
    const nameW = nameFont.widthOf(it.name, 9);
    const levelW = levelFont.widthOf(it.level, 8);
    const itemW = nameW + 3 + levelW;
    if (x > 0 && x + itemW > maxW) { line++; x = 0; }
    const lineY = line * (lineH + rowGap);
    out.push({ x, lineY, levelTopY: lineY + levelDrop, nameW, name: it.name, level: it.level });
    x += itemW + 20; // marginRight 20
  }
  const lines = line + 1;
  return { items: out, height: lines * (lineH + rowGap) };
}

// ── EDV chip flex-wrap layout ──
function layoutChips(
  labels: string[],
  font: DocFont,
  maxW: number,
): { items: { x: number; y: number; w: number; h: number; label: string }[]; height: number } {
  const chipH = 8 * 1.45 + 5; // text line + paddingVertical 2.5*2
  const rowGap = 3; // marginBottom
  const out: { x: number; y: number; w: number; h: number; label: string }[] = [];
  let x = 0;
  let line = 0;
  for (const label of labels) {
    const w = font.widthOf(label, 8) + 12; // paddingHorizontal 6*2
    if (x > 0 && x + w > maxW) { line++; x = 0; }
    out.push({ x, y: line * (chipH + rowGap), w, h: chipH, label });
    x += w + 4; // marginRight 4
  }
  const lines = labels.length ? line + 1 : 0;
  return { items: out, height: lines * (chipH + rowGap) };
}
