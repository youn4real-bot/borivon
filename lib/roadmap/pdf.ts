/**
 * The personal Pflege-Fahrplan PDF (10 pages, A4). Drawn with pdf-lib on the same
 * helpers as the B2 report (lib/pdflib/render.ts), so it runs on Workers with
 * the fonts already shipped in /public/fonts. White paper, gold accents: it gets
 * printed and passed around in HR, so it must look good on a black-and-white
 * printer too.
 */
import { PDFDocument, PageSizes, PDFName, PDFString, type PDFPage } from "pdf-lib";
import { embedFonts, hexColor, Surface, wrapText, measure, type DocFont } from "@/lib/pdflib/render";
import type { RoadmapResult, Level } from "./score";
import { LEVELS, CLIMB, BOTTLENECK, PLAN_90, REASONS, UI, pick, type Lang } from "./content";
import { STAGES, AREAS, PROFILE_ROWS, STAGE_UI } from "./stages";

const INK = hexColor("#1C1C1E");
const GOLD = hexColor("#B08A35");
const GOLD_SOFT = hexColor("#F6EFDD");
const MUTED = hexColor("#6B7280");
const LINE = hexColor("#E6E2D8");
const RED = hexColor("#B4533A");
const GREEN = hexColor("#3E7D52");
const WHITE = hexColor("#FFFFFF");

const BOOK_URL = "https://borivon.com/book/clinic";

export type RoadmapPdfInput = {
  result: RoadmapResult;
  lang: Lang;
  firstName: string;
  facility: string;
  date: Date;
};

export function formatEuro(n: number, lang: Lang): string {
  const v = Math.round(n);
  if (lang === "en") return "€" + v.toLocaleString("en-GB");
  const s = v.toLocaleString(lang === "de" ? "de-DE" : "fr-FR").replace(/[  ]/g, " ");
  return s + " €";
}

type Fonts = { reg: DocFont; bold: DocFont; semi: DocFont; serif: DocFont };

export async function renderRoadmapPdf(input: RoadmapPdfInput): Promise<Uint8Array> {
  const { result, lang } = input;
  const t = UI[lang];
  const SU = STAGE_UI[lang];
  const doc = await PDFDocument.create();
  doc.setTitle(`${t.title} · ${input.facility || "Borivon"}`);
  doc.setAuthor("Borivon");
  doc.setCreator("borivon.com");
  const f = await embedFonts(doc, ["Lexend-Regular.ttf", "Lexend-Bold.ttf", "Lexend-SemiBold.ttf", "DMSerifDisplay-Italic.ttf"]);
  const F: Fonts = { reg: f["Lexend-Regular.ttf"], bold: f["Lexend-Bold.ttf"], semi: f["Lexend-SemiBold.ttf"], serif: f["DMSerifDisplay-Italic.ttf"] };

  const [PW, PH] = PageSizes.A4;
  const M = 52;               // side margin
  const W = PW - 2 * M;       // content width
  let pageNo = 0;

  // ── drawing helpers (top-origin) ──────────────────────────────────────────
  const newPage = () => {
    const page = doc.addPage([PW, PH]);
    pageNo++;
    const s = new Surface(page, PH);
    // header: wordmark + thin gold rule
    s.text("Borivon", M, 30, F.serif, 17, INK);
    s.text(".", M + measure("Borivon", F.serif, 17), 30, F.serif, 17, GOLD);
    rect(page, M, 58, W, 0.8, LINE);
    // footer
    s.text("borivon.com", M, PH - 40, F.reg, 8.5, MUTED);
    const pn = `${t.page} ${pageNo}`;
    s.text(pn, PW - M - measure(pn, F.reg, 8.5), PH - 40, F.reg, 8.5, MUTED);
    return { page, s };
  };
  function rect(page: PDFPage, x: number, top: number, w: number, h: number, color = LINE, border?: ReturnType<typeof hexColor>) {
    page.drawRectangle({ x, y: PH - top - h, width: w, height: h, color, ...(border ? { borderColor: border, borderWidth: 0.8 } : {}) });
  }
  /** Wrapped paragraph; returns the y after it. */
  function para(s: Surface, text: string, x: number, y: number, width: number, font: DocFont, size: number, color = INK, lh = 1.5): number {
    for (const line of wrapText(text, font, size, width)) {
      s.text(line, x, y, font, size, color);
      y += size * lh;
    }
    return y;
  }
  const eyebrow = (s: Surface, text: string, y: number) => s.text(text.toUpperCase(), M, y, F.semi, 8.5, GOLD, 1.2);
  const h1 = (s: Surface, text: string, y: number, size = 26) => para(s, text, M, y, W, F.bold, size, INK, 1.2);

  const L = LEVELS[result.level];

  // ── 1 · cover ─────────────────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 150;
    eyebrow(s, t.title, y);
    y = h1(s, input.facility || t.title, y + 22, 32);
    y = para(s, `${t.for} ${input.firstName || ""} · ${input.date.toLocaleDateString(lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "de-DE")}`, M, y + 6, W, F.reg, 11, MUTED);
    // level card
    y += 40;
    rect(page, M, y, W, 190, GOLD_SOFT);
    rect(page, M, y, 4, 190, GOLD);
    s.text(`${t.level} ${result.level} ${t.of5}`.toUpperCase(), M + 26, y + 26, F.semi, 10, GOLD, 1.2);
    s.text(pick(L.name, lang), M + 26, y + 48, F.bold, 34, INK);
    para(s, pick(L.line, lang), M + 26, y + 98, W - 52, F.reg, 14, INK);
    // the 5-step bar
    const bw = (W - 52 - 4 * 8) / 5;
    for (let i = 1; i <= 5; i++) {
      const x = M + 26 + (i - 1) * (bw + 8);
      rect(page, x, y + 146, bw, 8, i <= result.level ? GOLD : WHITE, i <= result.level ? undefined : LINE);
      s.text(String(i), x, y + 162, F.reg, 8, MUTED);
    }
    y += 222;
    s.text(t.lossYear, M, y, F.reg, 11, MUTED);
    s.text("−" + formatEuro(result.totalYear, lang) + " " + t.perYear, M, y + 18, F.bold, 22, RED);
    para(s, pick(BOTTLENECK[result.bottleneck].t, lang), M, y + 52, W, F.semi, 12.5, INK);
    // contents
    let ty = y + 100;
    rect(page, M, ty, W, 0.8, LINE);
    s.text(t.inside.toUpperCase(), M, ty + 14, F.semi, 8.5, MUTED, 1.2);
    ty += 34;
    t.toc.split("|").forEach((item, i) => {
      s.text(String(i + 2), M, ty, F.semi, 10, GOLD);
      s.text(item, M + 22, ty, F.reg, 10.5, INK);
      ty += 18;
    });
  }

  // ── 2 · you are here: the ladder ────────────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.ladder, y);
    y += 26;
    for (const lv of [5, 4, 3, 2, 1] as Level[]) {
      const me = lv === result.level;
      const D = LEVELS[lv];
      const lines = me ? D.looks.map((x) => "• " + pick(x, lang)) : [];
      const h = me ? 74 + lines.length * 16 + 30 : 58;
      rect(page, M, y, W, h, me ? GOLD_SOFT : WHITE, me ? GOLD : LINE);
      s.text(`${t.level} ${lv}`.toUpperCase(), M + 18, y + 14, F.semi, 8.5, me ? GOLD : MUTED, 1.2);
      s.text(pick(D.name, lang), M + 18, y + 28, F.bold, 15, INK);
      s.text(pick(D.line, lang), M + 18 + measure(pick(D.name, lang), F.bold, 15) + 12, y + 32, F.reg, 10.5, MUTED);
      if (me) {
        const tag = t.youAreHere;
        const tw = measure(tag, F.semi, 9) + 18;
        rect(page, M + W - tw - 14, y + 12, tw, 18, GOLD);
        s.text(tag, M + W - tw - 5, y + 16, F.semi, 9, WHITE);
        let ly = y + 58;
        for (const l of lines) { s.text(l, M + 18, ly, F.reg, 10, INK); ly += 16; }
        para(s, pick(D.trap, lang), M + 18, ly + 6, W - 36, F.reg, 9.5, RED);
      }
      y += h + 10;
    }
  }

  // ── 3 · your level: story, typical profile, bottom line ──────────────────
  {
    const { page, s } = newPage();
    const St = STAGES[result.level];
    let y = 96;
    eyebrow(s, `${t.level} ${result.level} · ${pick(L.name, lang)}`, y);
    y = h1(s, SU.whenYou.replace("{n}", String(result.level)), y + 20, 24);
    y = para(s, pick(St.story, lang), M, y + 8, W, F.reg, 12, INK, 1.55) + 16;
    s.text(SU.typical.replace("{n}", String(result.level)).toUpperCase(), M, y, F.semi, 8.5, MUTED, 1.2);
    y += 18;
    const gw = (W - 12) / 2, gh = 64;
    PROFILE_ROWS.forEach((r, i) => {
      const x = M + (i % 2) * (gw + 12);
      const top = y + Math.floor(i / 2) * (gh + 12);
      rect(page, x, top, gw, gh, WHITE, LINE);
      s.text(pick(r.name, lang), x + 16, top + 14, F.reg, 10, MUTED);
      s.text(pick(St.profile[r.key], lang), x + 16, top + 32, F.bold, 16, INK);
    });
    y += 2 * (gh + 12) + 8;
    const bl = wrapText(pick(St.bottom, lang), F.bold, 16, W - 52);
    const gl = wrapText(pick(St.gradBy, lang), F.bold, 16, W - 52);
    const ch = 22 + 18 + bl.length * 22 + 16 + 18 + gl.length * 22 + 10;
    rect(page, M, y, W, ch, GOLD_SOFT);
    rect(page, M, y, 4, ch, GOLD);
    let cy = y + 22;
    s.text(SU.bottom.toUpperCase(), M + 26, cy, F.semi, 8.5, GOLD, 1.2);
    cy += 18;
    for (const l of bl) { s.text(l, M + 26, cy, F.bold, 16, INK); cy += 22; }
    cy += 16;
    s.text(SU.gradBy.toUpperCase(), M + 26, cy, F.semi, 8.5, GOLD, 1.2);
    cy += 18;
    for (const l of gl) { s.text(l, M + 26, cy, F.bold, 16, GREEN); cy += 22; }
  }

  // ── 4 · numbers ───────────────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.numbers, y);
    y = h1(s, "−" + formatEuro(result.totalYear, lang), y + 20, 30);
    s.text(t.total, M, y + 2, F.reg, 11, MUTED);
    y += 40;
    const block = (label: string, big: string, small: string, color: ReturnType<typeof hexColor>) => {
      rect(page, M, y, W, 92, WHITE, LINE);
      s.text(label, M + 20, y + 18, F.reg, 11, MUTED);
      s.text(big, M + 20, y + 38, F.bold, 24, color);
      s.text(small, M + 20 + measure(big, F.bold, 24) + 12, y + 50, F.reg, 11, MUTED);
      y += 108;
    };
    block(t.openPosts, "−" + formatEuro(result.openCostMonth, lang), `${t.perMonth} · −${formatEuro(result.openCostYear, lang)} ${t.perYear}`, RED);
    block(t.leaving, "−" + formatEuro(result.turnoverCostYear, lang), t.perYear, RED);
    block(t.perNurse, "+" + formatEuro(result.perNurseMonth, lang), `${t.perMonth} · +${formatEuro(result.perNurseMonth * 12, lang)} ${t.perYear}`, GREEN);
    y += 6;
    s.text(t.howCounted, M, y, F.semi, 11, INK);
    y = para(s, "• " + t.openModel, M, y + 20, W, F.reg, 9.5, MUTED);
    y = para(s, "• " + t.leaveModel, M, y + 4, W, F.reg, 9.5, MUTED);
    para(s, t.ownNumbers, M, y + 10, W, F.reg, 9.5, INK);
  }

  // ── 5 · area by area: what blocks you, how you move up ────────────────────
  {
    const { page, s } = newPage();
    const St = STAGES[result.level];
    let y = 96;
    eyebrow(s, `${t.level} ${result.level} · ${pick(L.name, lang)}`, y);
    y = h1(s, SU.areasTitle, y + 20, 22);
    y = para(s, SU.areasSub, M, y + 4, W, F.reg, 10.5, MUTED) + 14;
    const c0 = 104, gap = 14, cw = (W - c0 - 2 * gap) / 2;
    const x1 = M + c0 + gap, x2 = x1 + cw + gap;
    s.text(SU.constraint.toUpperCase(), x1, y, F.semi, 8.5, MUTED, 1.1);
    s.text(SU.graduate.toUpperCase(), x2, y, F.semi, 8.5, MUTED, 1.1);
    y += 18;
    for (const a of AREAS) {
      const row = St.rows[a.key];
      rect(page, M, y, W, 0.8, LINE);
      const top = y + 12;
      const r0 = para(s, pick(a.name, lang), M, top, c0, F.semi, 10.5, INK, 1.4);
      const r1 = para(s, pick(row.c, lang), x1, top, cw, F.reg, 10.5, INK, 1.4);
      const r2 = para(s, pick(row.g, lang), x2, top, cw, F.semi, 10.5, GREEN, 1.4);
      y = Math.max(r0, r1, r2) + 8;
    }
    rect(page, M, y, W, 0.8, LINE);
    y += 22;
    s.text(SU.remember.toUpperCase(), M, y, F.semi, 8.5, GOLD, 1.2);
    para(s, SU.rememberTxt, M, y + 16, W, F.reg, 11, INK, 1.5);
  }

  // ── 6 · bottleneck + climb plan ───────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    const B = BOTTLENECK[result.bottleneck];
    eyebrow(s, t.plan, y);
    y = h1(s, pick(B.t, lang), y + 20, 22);
    y = para(s, pick(B.d, lang), M, y + 6, W, F.reg, 11, INK) + 14;
    const C = CLIMB[result.level];
    rect(page, M, y, W, 0.8, LINE);
    y = para(s, pick(C.goal, lang), M, y + 16, W, F.semi, 13, INK) + 8;
    C.steps.forEach((st, i) => {
      const n = String(i + 1);
      rect(page, M, y, 24, 24, GOLD);
      s.text(n, M + 12 - measure(n, F.bold, 11) / 2, y + 6, F.bold, 11, WHITE);
      s.text(pick(st.t, lang), M + 38, y + 3, F.semi, 12, INK);
      y = para(s, pick(st.d, lang), M + 38, y + 22, W - 38, F.reg, 10.5, INK) + 12;
    });
  }

  // ── 7 · 90-day plan ───────────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.e90, y);
    y = h1(s, t.plan90, y + 20, 22);
    y = para(s, t.plan90sub, M, y + 4, W, F.reg, 10.5, MUTED) + 12;
    for (const block of PLAN_90) {
      s.text(pick(block.when, lang).toUpperCase(), M, y, F.semi, 9, GOLD, 1.1);
      y += 18;
      for (const it of block.items) {
        rect(page, M + 2, y + 1, 10, 10, WHITE, MUTED);
        y = para(s, pick(it, lang), M + 22, y, W - 22, F.reg, 10.5, INK, 1.45) + 4;
      }
      y += 8;
    }
  }

  // ── 8 · 7 reasons ─────────────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.eReasons, y);
    y = h1(s, t.reasons, y + 20, 22);
    y = para(s, t.reasonsSub, M, y + 4, W, F.reg, 10.5, MUTED) + 14;
    const c1 = W * 0.42;
    s.text(t.why.toUpperCase(), M, y, F.semi, 8.5, MUTED, 1.1);
    s.text(t.fix.toUpperCase(), M + c1 + 16, y, F.semi, 8.5, MUTED, 1.1);
    y += 18;
    REASONS.forEach((r, i) => {
      rect(page, M, y, W, 0.8, LINE);
      const top = y + 12;
      const a = para(s, `${i + 1}. ${pick(r.why, lang)}`, M, top, c1, F.semi, 11, INK);
      const b = para(s, pick(r.fix, lang), M + c1 + 16, top, W - c1 - 16, F.reg, 11, INK);
      y = Math.max(a, b) + 8;
    });
  }

  // ── 9 · the level behind you, the level ahead ─────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    const section = (lv: Level, label: string, withProfile: boolean) => {
      const D = LEVELS[lv], St = STAGES[lv];
      eyebrow(s, label, y);
      s.text(`${t.level} ${lv}`.toUpperCase(), M, y + 22, F.semi, 8.5, MUTED, 1.2);
      s.text(pick(D.name, lang), M, y + 36, F.bold, 20, INK);
      y = para(s, pick(D.line, lang), M, y + 64, W, F.reg, 11, MUTED) + 4;
      y = para(s, pick(St.story, lang), M, y, W, F.reg, 11, INK, 1.5) + 10;
      if (withProfile) {
        const cw4 = (W - 3 * 10) / 4;
        PROFILE_ROWS.forEach((r, i) => {
          const x = M + i * (cw4 + 10);
          rect(page, x, y, cw4, 50, WHITE, LINE);
          s.text(pick(r.name, lang), x + 10, y + 10, F.reg, 8, MUTED);
          para(s, pick(St.profile[r.key], lang), x + 10, y + 24, cw4 - 16, F.semi, 10, INK, 1.25);
        });
        y += 62;
      }
      s.text(SU.bottom + ": ", M, y, F.semi, 10.5, GOLD);
      y = para(s, pick(St.bottom, lang), M + measure(SU.bottom + ": ", F.semi, 10.5), y, W - measure(SU.bottom + ": ", F.semi, 10.5), F.semi, 10.5, INK) + 26;
    };
    if (result.level > 1) section((result.level - 1) as Level, SU.prev, false);
    if (result.level > 1 && result.level < 5) { rect(page, M, y - 12, W, 0.8, LINE); y += 14; }
    if (result.level < 5) section((result.level + 1) as Level, SU.next, true);
  }

  // ── 10 · next step: framed as "see if you fit" ─────────────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 150;
    eyebrow(s, t.eNext, y);
    y = h1(s, SU.wantNext, y + 20, 28);
    y = para(s, SU.stuck, M, y + 10, W, F.reg, 12.5, INK, 1.55) + 8;
    y = para(s, t.nextBody, M, y, W, F.reg, 12.5, INK, 1.55) + 18;
    s.text(t.callGet, M, y, F.semi, 11.5, INK);
    y += 22;
    for (const pt of t.callPts.split("|")) {
      rect(page, M + 2, y + 3, 8, 8, GREEN);
      s.text(pt, M + 20, y, F.reg, 11, INK);
      y += 20;
    }
    y += 16;
    const btn = t.book;
    const bw = measure(btn, F.semi, 13) + 48;
    rect(page, M, y, bw, 40, GOLD);
    s.text(btn, M + 24, y + 13, F.semi, 13, WHITE);
    // clickable
    const link = doc.context.register(doc.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [M, PH - y - 40, M + bw, PH - y], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(BOOK_URL) },
    }));
    page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
    s.text(BOOK_URL.replace("https://", ""), M, y + 54, F.reg, 10, MUTED);
    s.text(`${t.contact}: contact@borivon.com`, M, y + 72, F.reg, 10, MUTED);
    para(s, t.disclaimer, M, PH - 90, W, F.reg, 8.5, MUTED);
  }

  return doc.save();
}
