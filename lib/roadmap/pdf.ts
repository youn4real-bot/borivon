/**
 * The personal Pflege-Fahrplan PDF (10 pages, A4). Drawn with pdf-lib on the
 * same helpers as the B2 report (lib/pdflib/render.ts), so it runs on Workers.
 *
 * Design = borivon.com (founder, 2026-10-22: "the design stuff must match"):
 * the site's colours (#0e0e10 night, #c9a240 gold, #eeecea text), its display
 * font Playfair Display for every heading and number (drawn as outlines from
 * the site's own WOFF2, lib/roadmap/vectorFont.ts), Lexend for the body, the
 * italic "Borivon." wordmark with a gold dot. Light pages use the warm paper of
 * the emails (#f6f4ef) so the checklist still prints. Two-tone pictograms
 * (lib/roadmap/icons.ts), lots of air, words a 5-year-old could follow.
 *
 * Page order is fixed (the delivery mail points at pages 6 and 7):
 *  1 cover · 2 you are here · 3 your level · 4 numbers · 5 area by area ·
 *  6 plan · 7 90 days · 8 7 reasons · 9 before/after · 10 see if you fit
 */
import { PDFDocument, PageSizes, PDFName, PDFString, type PDFPage, type RGB } from "pdf-lib";
import { embedFonts, hexColor, Surface, wrapText, measure, type DocFont } from "@/lib/pdflib/render";
import type { RoadmapResult, Level } from "./score";
import { LEVELS, CLIMB, BOTTLENECK, PLAN_90, REASONS, UI, pick, type Lang } from "./content";
import { STAGES, AREAS, PROFILE_ROWS, STAGE_UI } from "./stages";
import { drawIcon, REASON_ICONS, type IconName, type IconColors } from "./icons";
import { loadVectorFont, wrapVector, type VectorFont } from "./vectorFont";

// borivon.com tokens (content/pflege/*.html :root) + their light-paper twins
const NIGHT = hexColor("#0e0e10");      // --bg
const NIGHT_CARD = hexColor("#18181c"); // --card
const NIGHT_LINE = hexColor("#2b2b30");
const FG = hexColor("#eeecea");         // --fg
const MUTED_NIGHT = hexColor("#9a978f"); // --muted
const GOLD = hexColor("#c9a240");       // --gold
const GOLD_TEXT = hexColor("#9c7a27");  // gold that stays readable on paper
const GOLD_SOFT = hexColor("#efe7d2");  // --gold-soft on paper
const WARN_NIGHT = hexColor("#e07a5f"); // --warn
const PAPER = hexColor("#f6f4ef");      // email background
const CARD = hexColor("#ffffff");
const LINE = hexColor("#e7e1d4");
const INK = hexColor("#1c1c1e");
const MUTED = hexColor("#6d6a63");
const STEP_IDLE = hexColor("#e6e0d3");
const RED = hexColor("#b5553b");
const RED_SOFT = hexColor("#f8ebe5");
const GREEN = hexColor("#3f7a52");

const BOOK_URL = "https://borivon.com/book/clinic";
const PLAYFAIR = "pflege/assets/playfair-latin.woff2";
const PLAYFAIR_ITALIC = "pflege/assets/playfair-italic-latin.woff2";

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
  // fr-FR groups with U+202F (narrow no-break space): the fonts have no glyph for it
  const s = v.toLocaleString(lang === "de" ? "de-DE" : "fr-FR").replace(/[  ]/g, " ");
  return s + " €";
}

type Fonts = { reg: DocFont; semi: DocFont };

export async function renderRoadmapPdf(input: RoadmapPdfInput): Promise<Uint8Array> {
  const { result, lang } = input;
  const t = UI[lang];
  const SU = STAGE_UI[lang];
  const doc = await PDFDocument.create();
  doc.setTitle(`${t.title} · ${input.facility || "Borivon"}`);
  doc.setAuthor("Borivon");
  doc.setCreator("borivon.com");
  const f = await embedFonts(doc, ["Lexend-Regular.ttf", "Lexend-SemiBold.ttf"]);
  const F: Fonts = { reg: f["Lexend-Regular.ttf"], semi: f["Lexend-SemiBold.ttf"] };
  // the site's headings: Playfair 500 (h1/h2) and 600 (the big numbers)
  const [H, HN, HI] = await Promise.all([loadVectorFont(PLAYFAIR, 0.012), loadVectorFont(PLAYFAIR, 0.024), loadVectorFont(PLAYFAIR_ITALIC)]);

  const [PW, PH] = PageSizes.A4;
  const M = 60;               // side margin
  const W = PW - 2 * M;       // content width
  const lv = result.level;
  const L = LEVELS[lv];
  const St = STAGES[lv];
  let pageNo = 0;

  // ── helpers (all top-origin) ──────────────────────────────────────────────
  /** Display text (Playfair) with the site's -0.02em tracking; returns the y after it. */
  const disp = (page: PDFPage, vf: VectorFont, text: string, x: number, y: number, width: number, size: number, color: RGB, lh = 1.12, track = -0.02): number => {
    for (const ln of wrapVector(text, vf, size, width, size * track)) {
      vf.draw(page, PH, ln, x, y, size, color, size * track);
      y += size * lh;
    }
    return y;
  };
  const wordmark = (page: PDFPage, x: number, top: number, size: number, color: RGB) => {
    HI.draw(page, PH, "Borivon", x, top, size, color);
    H.draw(page, PH, ".", x + HI.measure("Borivon", size), top, size, GOLD);
  };
  const newPage = (dark = false) => {
    const page = doc.addPage([PW, PH]);
    pageNo++;
    const s = new Surface(page, PH);
    s.rect(0, 0, PW, PH, dark ? NIGHT : PAPER);
    wordmark(page, M, 31, 17, dark ? FG : INK);
    if (pageNo > 1) {
      const tag = `${t.title}  ·  ${t.level} ${lv}`.toUpperCase();
      s.text(tag, PW - M - measure(tag, F.semi, 6.5, 1.3), 41, F.semi, 6.5, dark ? MUTED_NIGHT : MUTED, 1.3);
      const pn = String(pageNo).padStart(2, "0");
      s.text(pn, PW - M - measure(pn, F.semi, 8), PH - 44, F.semi, 8, dark ? MUTED_NIGHT : MUTED);
      s.text("borivon.com", M, PH - 44, F.reg, 8, dark ? MUTED_NIGHT : MUTED);
    }
    return { page, s };
  };
  const icon = (page: PDFPage, name: IconName, x: number, top: number, size: number, c: IconColors) => drawIcon(page, PH, name, x, top, size, c);
  const on = (bg: RGB): IconColors => ({ base: INK, accent: GOLD, hole: bg });
  const ON_NIGHT: IconColors = { base: FG, accent: GOLD, hole: NIGHT };

  /** Wrapped Lexend paragraph; returns the y after it. */
  function para(s: Surface, text: string, x: number, y: number, width: number, font: DocFont, size: number, color: RGB, lh = 1.6): number {
    for (const ln of wrapText(text, font, size, width)) {
      s.text(ln, x, y, font, size, color);
      y += size * lh;
    }
    return y;
  }
  const paraH = (text: string, font: DocFont, size: number, width: number, lh = 1.6) => wrapText(text, font, size, width).length * size * lh;
  const dispH = (vf: VectorFont, text: string, size: number, width: number, lh = 1.12) => wrapVector(text, vf, size, width, size * -0.02).length * size * lh;
  const eyebrow = (s: Surface, text: string, x: number, y: number, color: RGB = GOLD_TEXT) => s.text(text.toUpperCase(), x, y, F.semi, 7.5, color, 1.7);
  const title = (page: PDFPage, text: string, y: number, size = 34, color: RGB = INK) => disp(page, H, text, M, y, W, size, color);
  /** A soft circle with an icon in the middle. */
  const badge = (page: PDFPage, s: Surface, name: IconName, x: number, top: number, d: number, bg: RGB) => {
    s.roundedRect(x, top, d, d, d / 2, { fill: bg });
    const is = d * 0.56;
    icon(page, name, x + (d - is) / 2, top + (d - is) / 2, is, on(bg));
  };

  // ── 1 · cover ─────────────────────────────────────────────────────────────
  {
    const { page, s } = newPage(true);
    icon(page, "stairs", M, 150, 84, ON_NIGHT);
    let y = 280;
    eyebrow(s, input.firstName ? `${t.for} ${input.firstName}` : t.title, M, y, GOLD);
    y = disp(page, H, t.title, M, y + 20, W, 48, FG, 1.08);
    if (input.facility) y = disp(page, HI, input.facility, M, y + 4, W, 26, GOLD, 1.2, 0);
    s.text(input.date.toLocaleDateString(lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "de-DE"), M, y + 12, F.reg, 10.5, MUTED_NIGHT);

    const cy = 548, ch = 176;
    s.roundedRect(M, cy, W, ch, 22, { fill: NIGHT_CARD, border: NIGHT_LINE, borderWidth: 0.8 });
    eyebrow(s, `${t.level} ${lv} ${t.of5}`, M + 30, cy + 30, GOLD);
    disp(page, H, pick(L.name, lang), M + 30, cy + 48, W - 60, 36, FG);
    para(s, pick(L.line, lang), M + 30, cy + 100, W - 60, F.reg, 13, MUTED_NIGHT);
    const bw = (W - 60 - 4 * 8) / 5;
    for (let i = 1; i <= 5; i++) s.roundedRect(M + 30 + (i - 1) * (bw + 8), cy + 142, bw, 6, 3, { fill: i <= lv ? GOLD : NIGHT_LINE });

    if (result.totalYear > 0) {
      s.text(t.lossYear, M, cy + ch + 28, F.reg, 10.5, MUTED_NIGHT);
      disp(page, HN, `−${formatEuro(result.totalYear, lang)} ${t.perYear}`, M, cy + ch + 44, W, 22, WARN_NIGHT, 1.1, 0);
    }
  }

  // ── 2 · you are here: the staircase ───────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.ladder, M, y);
    title(page, t.youAreHere + ".", y + 20, 38);
    const base = 548, gap = 12, cw = (W - 4 * gap) / 5;
    const hs = [84, 128, 172, 216, 260];
    for (let i = 1; i <= 5; i++) {
      const x = M + (i - 1) * (cw + gap), hh = hs[i - 1], top = base - hh;
      const me = i === lv, done = i < lv;
      s.roundedRect(x, top, cw, hh, 14, { fill: me ? GOLD : done ? NIGHT : STEP_IDLE });
      HN.draw(page, PH, String(i), x + 16, top + 12, 26, me ? NIGHT : done ? FG : MUTED);
      para(s, pick(LEVELS[i as Level].name, lang), x, base + 14, cw, F.semi, 9.5, me ? INK : MUTED, 1.35);
      if (me) {
        const tag = t.youAreHere;
        const tw = measure(tag, F.semi, 9) + 26;
        const px = Math.min(Math.max(x + cw / 2 - tw / 2, M), M + W - tw);
        s.roundedRect(px, top - 44, tw, 26, 13, { fill: NIGHT });
        s.text(tag, px + 13, top - 37, F.semi, 9, FG);
        page.drawSvgPath("M 0 0 L 14 0 L 7 8 Z", { x: x + cw / 2 - 7, y: PH - (top - 19), color: NIGHT });
      }
    }
    y = 622;
    disp(page, H, pick(L.name, lang), M, y, W, 26, INK);
    para(s, pick(L.line, lang), M, y + 36, W, F.reg, 12.5, MUTED);
    const lw = (W - 2 * 18) / 3;
    L.looks.forEach((lk, i) => {
      const x = M + i * (lw + 18);
      s.roundedRect(x, y + 78, 8, 8, 4, { fill: GOLD });
      para(s, pick(lk, lang), x + 16, y + 74, lw - 16, F.reg, 11, INK, 1.5);
    });
  }

  // ── 3 · your level: story, typical profile, bottom line ──────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, `${t.level} ${lv} · ${pick(L.name, lang)}`, M, y);
    title(page, SU.whenYou.replace("{n}", String(lv)), y + 20, 38);
    const top = 184;
    const story = pick(St.story, lang);
    const sh = paraH(story, F.reg, 14.5, W, 1.7);
    const bh = 58 + sh + 38;
    s.rect(0, top, PW, bh, NIGHT);
    s.rect(M, top + 38, 28, 2.5, GOLD);
    para(s, story, M, top + 58, W, F.reg, 14.5, FG, 1.7);
    y = top + bh + 34;
    eyebrow(s, SU.typical.replace("{n}", String(lv)), M, y, MUTED);
    y += 22;
    const gw = (W - 14) / 2, gh = 72;
    PROFILE_ROWS.forEach((r, i) => {
      const x = M + (i % 2) * (gw + 14);
      const tp = y + Math.floor(i / 2) * (gh + 14);
      s.roundedRect(x, tp, gw, gh, 18, { fill: CARD, border: LINE, borderWidth: 0.8 });
      icon(page, r.icon, x + 18, tp + (gh - 32) / 2, 32, on(CARD));
      s.text(pick(r.name, lang), x + 64, tp + 17, F.reg, 9.5, MUTED);
      disp(page, H, pick(St.profile[r.key], lang), x + 64, tp + 32, gw - 80, 17, INK, 1.1);
    });
    y += 2 * gh + 14 + 26;
    const bl = pick(St.bottom, lang), gb = pick(St.gradBy, lang);
    const blH = dispH(H, bl, 20, W - 56, 1.18), gbH = dispH(H, gb, 17, W - 56, 1.18);
    const ch = 28 + 18 + blH + 16 + 18 + gbH + 20;
    s.roundedRect(M, y, W, ch, 20, { fill: GOLD_SOFT });
    let cy = y + 28;
    eyebrow(s, SU.bottom, M + 28, cy);
    cy = disp(page, H, bl, M + 28, cy + 16, W - 56, 20, INK, 1.18) + 16;
    eyebrow(s, SU.gradBy, M + 28, cy, GREEN);
    disp(page, H, gb, M + 28, cy + 16, W - 56, 17, GREEN, 1.18);
  }

  // ── 4 · your numbers ──────────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.numbers, M, y);
    y = disp(page, HN, "−" + formatEuro(result.totalYear, lang), M, y + 18, W, 54, RED, 1.15, 0);
    s.text(t.total, M, y + 4, F.reg, 12.5, MUTED);
    y += 50;
    const row = (ic: IconName, label: string, big: string, small: string, color: RGB) => {
      const rh = 110;
      s.roundedRect(M, y, W, rh, 20, { fill: CARD, border: LINE, borderWidth: 0.8 });
      badge(page, s, ic, M + 24, y + (rh - 60) / 2, 60, GOLD_SOFT);
      const tx = M + 108;
      s.text(label, tx, y + 22, F.reg, 11.5, MUTED);
      HN.draw(page, PH, big, tx, y + 40, 30, color);
      if (small) s.text(small, tx, y + 84, F.reg, 10, MUTED);
      y += rh + 16;
    };
    row("bed", t.openPosts, `−${formatEuro(result.openCostMonth, lang)} ${t.perMonth}`, `−${formatEuro(result.openCostYear, lang)} ${t.perYear}`, RED);
    row("door", t.leaving, `−${formatEuro(result.turnoverCostYear, lang)} ${t.perYear}`, "", RED);
    row("heart", t.perNurse, `+${formatEuro(result.perNurseMonth, lang)} ${t.perMonth}`, `+${formatEuro(result.perNurseMonth * 12, lang)} ${t.perYear}`, GREEN);
    y += 12;
    eyebrow(s, t.howCounted, M, y, MUTED);
    y += 22;
    for (const [ic, txt] of [["bed", t.openModel], ["door", t.leaveModel]] as [IconName, string][]) {
      icon(page, ic, M, y - 1, 18, on(PAPER));
      y = para(s, txt, M + 30, y, W - 30, F.reg, 10, MUTED, 1.55) + 10;
    }
    para(s, t.ownNumbers, M, y + 6, W, F.semi, 10.5, INK);
  }

  // ── 5 · area by area ──────────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, `${t.level} ${lv} · ${pick(L.name, lang)}`, M, y);
    y = title(page, SU.areasTitle, y + 20, 36);
    y = para(s, SU.areasSub, M, y + 8, W, F.reg, 13, MUTED) + 20;
    const c0 = 150, gap = 18, cw = (W - c0 - 2 * gap) / 2;
    const x1 = M + c0 + gap, x2 = x1 + cw + gap;
    eyebrow(s, SU.constraint, x1, y, MUTED);
    eyebrow(s, SU.graduate, x2, y, GREEN);
    y += 20;
    for (const a of AREAS) {
      const r = St.rows[a.key];
      s.hline(M, M + W, y, LINE, 0.8);
      const tp = y + 16;
      icon(page, a.icon, M, tp - 2, 28, on(PAPER));
      const r0 = para(s, pick(a.name, lang), M + 40, tp + 4, c0 - 40, F.semi, 11.5, INK, 1.35);
      const r1 = para(s, pick(r.c, lang), x1, tp, cw, F.reg, 11, INK, 1.5);
      const r2 = para(s, pick(r.g, lang), x2, tp, cw, F.semi, 11, GREEN, 1.5);
      y = Math.max(tp + 30, r0, r1, r2) + 14;
    }
    s.hline(M, M + W, y, LINE, 0.8);
    y += 26;
    const rt = SU.rememberTxt;
    const rh = Math.max(78, 26 + 16 + paraH(rt, F.reg, 12, W - 100, 1.5) + 20);
    s.roundedRect(M, y, W, rh, 20, { fill: GOLD_SOFT });
    icon(page, "target", M + 24, y + (rh - 36) / 2, 36, on(GOLD_SOFT));
    eyebrow(s, SU.remember, M + 78, y + 24);
    para(s, rt, M + 78, y + 40, W - 100, F.reg, 12, INK, 1.5);
  }

  // ── 6 · bottleneck + the plan, as a timeline ──────────────────────────────
  {
    const { page, s } = newPage();
    const B = BOTTLENECK[result.bottleneck];
    const top = 72, tx = M + 66, tw = W - 66;
    const bt = pick(B.t, lang), bd = pick(B.d, lang);
    const bh = 36 + 18 + dispH(H, bt, 24, tw, 1.15) + 8 + paraH(bd, F.reg, 12.5, tw, 1.6) + 30;
    s.rect(0, top, PW, bh, NIGHT);
    icon(page, "target", M, top + 38, 46, ON_NIGHT);
    eyebrow(s, t.plan, tx, top + 36, GOLD);
    let y = disp(page, H, bt, tx, top + 52, tw, 24, FG, 1.15);
    para(s, bd, tx, y + 8, tw, F.reg, 12.5, MUTED_NIGHT, 1.6);
    y = top + bh + 34;
    const C = CLIMB[lv];
    y = disp(page, H, pick(C.goal, lang), M, y, W, 21, INK, 1.2) + 18;
    // the vertical line first, circles on top
    const steps = C.steps.map((st) => ({ t: pick(st.t, lang), d: pick(st.d, lang) }));
    const hs = steps.map((st) => Math.max(36, 24 + paraH(st.d, F.reg, 12, W - 58, 1.55)) + 20);
    const total = hs.reduce((p, c) => p + c, 0);
    s.rect(M + 17, y + 18, 2, total - hs[hs.length - 1], GOLD);
    steps.forEach((st, i) => {
      const n = String(i + 1);
      s.roundedRect(M, y, 36, 36, 18, { fill: GOLD });
      s.text(n, M + 18 - measure(n, F.semi, 13) / 2, y + 11, F.semi, 13, hexColor("#131312"));
      s.text(st.t, M + 58, y + 4, F.semi, 14, INK);
      para(s, st.d, M + 58, y + 26, W - 58, F.reg, 12, MUTED, 1.55);
      y += hs[i];
    });
    const trap = pick(L.trap, lang);
    const th = Math.max(70, 22 + paraH(trap, F.reg, 11.5, W - 96, 1.55) + 20);
    y += 6;
    s.roundedRect(M, y, W, th, 20, { fill: RED_SOFT });
    icon(page, "warning", M + 24, y + (th - 32) / 2, 32, on(RED_SOFT));
    para(s, trap, M + 74, y + 22, W - 96, F.reg, 11.5, INK, 1.55);
  }

  // ── 7 · the 90-day plan ───────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.e90, M, y);
    icon(page, "calendar", M + W - 56, 92, 56, on(PAPER));
    y = title(page, t.plan90, y + 20, 36);
    y = para(s, t.plan90sub, M, y + 8, W - 80, F.reg, 13, MUTED) + 24;
    const gw = (W - 16) / 2, iw = gw - 60;
    const cardH = (b: (typeof PLAN_90)[number]) => 24 + 14 + 18 + b.items.reduce((p, it) => p + paraH(pick(it, lang), F.reg, 11.5, iw, 1.45) + 9, 0) + 12;
    for (let r = 0; r < PLAN_90.length; r += 2) {
      const pair = PLAN_90.slice(r, r + 2);
      const rh = Math.max(...pair.map(cardH));
      pair.forEach((b, j) => {
        const x = M + j * (gw + 16);
        s.roundedRect(x, y, gw, rh, 20, { fill: CARD, border: LINE, borderWidth: 0.8 });
        eyebrow(s, pick(b.when, lang), x + 22, y + 24);
        let iy = y + 24 + 14 + 18;
        for (const it of b.items) {
          s.roundedRect(x + 22, iy + 1, 12, 12, 3, { border: MUTED, borderWidth: 1 });
          iy = para(s, pick(it, lang), x + 44, iy, iw, F.reg, 11.5, INK, 1.45) + 9;
        }
      });
      y += rh + 16;
    }
  }

  // ── 8 · 7 reasons nurses leave ────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.eReasons, M, y);
    y = title(page, t.reasons, y + 20, 34);
    y = para(s, t.reasonsSub, M, y + 8, W, F.reg, 13, MUTED) + 22;
    const check: IconColors = { base: GREEN, accent: GREEN, hole: PAPER };
    REASONS.forEach((r, i) => {
      s.hline(M, M + W, y, LINE, 0.8);
      const tp = y + 18;
      icon(page, REASON_ICONS[i], M, tp, 30, on(PAPER));
      const a = para(s, pick(r.why, lang), M + 50, tp + 1, W - 50, F.semi, 13, INK, 1.35);
      icon(page, "check", M + 50, a + 3, 12, check);
      const b = para(s, pick(r.fix, lang), M + 68, a + 2, W - 68, F.reg, 12, GREEN, 1.45);
      y = Math.max(tp + 34, b) + 16;
    });
    s.hline(M, M + W, y, LINE, 0.8);
  }

  // ── 9 · the level behind you, the level ahead ─────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.ladder, M, y);
    y = title(page, SU.aroundTitle, y + 20, 36) + 18;
    const card = (lvl: Level, ahead: boolean) => {
      const D = LEVELS[lvl], S2 = STAGES[lvl];
      const bg = ahead ? GOLD_SOFT : CARD;
      const story = pick(S2.story, lang);
      const iw = W - 56;
      const tilesH = ahead ? 72 : 0;
      const h = 30 + 50 + 10 + paraH(story, F.reg, 12, iw, 1.6) + (ahead ? 14 + tilesH : 0) + 16 + 18 + 30;
      s.roundedRect(M, y, W, h, 22, ahead ? { fill: bg, border: GOLD, borderWidth: 1 } : { fill: bg, border: LINE, borderWidth: 0.8 });
      const ic: IconColors = ahead ? { base: INK, accent: GOLD, hole: bg } : { base: GREEN, accent: GOLD, hole: bg };
      icon(page, ahead ? "up" : "check", M + 28, y + 30, 40, ic);
      eyebrow(s, ahead ? SU.next : SU.prev, M + 82, y + 31, ahead ? GOLD_TEXT : GREEN);
      disp(page, H, `${t.level} ${lvl} · ${pick(D.name, lang)}`, M + 82, y + 44, iw - 54, 21, INK);
      let cy = para(s, story, M + 28, y + 30 + 50 + 10, iw, F.reg, 12, ahead ? INK : MUTED, 1.6);
      if (ahead) {
        cy += 14;
        const tw4 = (iw - 3 * 10) / 4;
        PROFILE_ROWS.forEach((r, i) => {
          const x = M + 28 + i * (tw4 + 10);
          s.roundedRect(x, cy, tw4, tilesH, 14, { fill: CARD });
          icon(page, r.icon, x + 12, cy + 12, 18, on(CARD));
          s.text(pick(r.name, lang), x + 12, cy + 36, F.reg, 7.5, MUTED);
          para(s, pick(S2.profile[r.key], lang), x + 12, cy + 48, tw4 - 20, F.semi, 9.5, INK, 1.25);
        });
        cy += tilesH;
      }
      cy += 16;
      eyebrow(s, SU.bottom, M + 28, cy, ahead ? GOLD_TEXT : MUTED);
      disp(page, H, pick(S2.bottom, lang), M + 28, cy + 14, iw, 15, INK, 1.2, 0);
      y += h + 18;
    };
    if (lv > 1) card((lv - 1) as Level, false);
    if (lv < 5) card((lv + 1) as Level, true);
  }

  // ── 10 · next step, framed as "see if you fit" ────────────────────────────
  {
    const { page, s } = newPage(true);
    let y = 112;
    eyebrow(s, t.eNext, M, y, GOLD);
    y = disp(page, H, lv === 5 ? SU.wantStay : SU.wantNext, M, y + 20, W, 40, FG, 1.1);
    y = para(s, SU.stuck, M, y + 18, W, F.reg, 14, MUTED_NIGHT, 1.65);
    y = para(s, t.nextBody, M, y + 12, W, F.reg, 14, FG, 1.65) + 22;
    eyebrow(s, t.callGet, M, y, GOLD);
    y += 24;
    for (const pt of t.callPts.split("|")) {
      icon(page, "check", M, y - 3, 22, { base: GOLD, accent: GOLD, hole: NIGHT });
      s.text(pt, M + 36, y, F.reg, 13.5, FG);
      y += 34;
    }
    y = para(s, SU.fitLine, M, y + 4, W, F.reg, 12, MUTED_NIGHT, 1.6) + 22;
    const btn = t.book;
    const bw = measure(btn, F.semi, 14) + 64, bh = 52;
    s.roundedRect(M, y, bw, bh, 26, { fill: GOLD });
    s.text(btn, M + 32, y + 17, F.semi, 14, hexColor("#131312"));
    const link = doc.context.register(doc.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [M, PH - y - bh, M + bw, PH - y], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(BOOK_URL) },
    }));
    page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
    s.text(BOOK_URL.replace("https://", ""), M, y + bh + 18, F.reg, 10.5, MUTED_NIGHT);
    s.text(`${t.contact}: contact@borivon.com`, M, y + bh + 36, F.reg, 10.5, MUTED_NIGHT);
    para(s, t.disclaimer, M, PH - 78, W, F.reg, 8, MUTED_NIGHT);
  }

  return doc.save();
}
