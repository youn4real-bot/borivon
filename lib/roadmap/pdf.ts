/**
 * The personal Pflege-Fahrplan PDF (10 pages, A4). Drawn with pdf-lib on the
 * same helpers as the B2 report (lib/pdflib/render.ts), so it runs on Workers
 * with the fonts already shipped in /public/fonts.
 *
 * Look (founder, 2026-10-22): premium and calm, lots of air, simple two-tone
 * pictograms (lib/roadmap/icons.ts) like the acquisition.com roadmap, and
 * words a 5-year-old could follow. Warm paper, deep navy, one gold accent.
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
import { drawIcon, type IconName, type IconColors } from "./icons";

const NAVY = hexColor("#141821");
const NAVY_2 = hexColor("#1F2430");
const NAVY_3 = hexColor("#353B49");
const GOLD = hexColor("#B8913A");
const GOLD_LIGHT = hexColor("#D9BE7B");
const GOLD_SOFT = hexColor("#F5EEDC");
const PAPER = hexColor("#FCFAF6");
const CARD = hexColor("#FFFFFF");
const INK = NAVY;
const MUTED = hexColor("#6E7380");
const MUTED_DARK = hexColor("#A7ACB8");
const LINE = hexColor("#E8E2D4");
const STEP_IDLE = hexColor("#ECE7DB");
const RED = hexColor("#B4533A");
const RED_LIGHT = hexColor("#E9977E");
const RED_SOFT = hexColor("#FBEDE8");
const GREEN = hexColor("#3E7D52");

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
  // fr-FR groups with U+202F (narrow no-break space): Lexend has no glyph for it
  const s = v.toLocaleString(lang === "de" ? "de-DE" : "fr-FR").replace(/[\u202F\u00A0]/g, " ");
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
  const M = 60;               // side margin
  const W = PW - 2 * M;       // content width
  const lv = result.level;
  const L = LEVELS[lv];
  const St = STAGES[lv];
  let pageNo = 0;

  // ── helpers (all top-origin) ──────────────────────────────────────────────
  const newPage = (dark = false) => {
    const page = doc.addPage([PW, PH]);
    pageNo++;
    const s = new Surface(page, PH);
    s.rect(0, 0, PW, PH, dark ? NAVY : PAPER);
    s.text("Borivon", M, 34, F.serif, 15, dark ? CARD : INK);
    s.text(".", M + measure("Borivon", F.serif, 15), 34, F.serif, 15, GOLD);
    if (pageNo > 1) {
      const tag = `${t.title}  ·  ${t.level} ${lv}`.toUpperCase();
      s.text(tag, PW - M - measure(tag, F.semi, 6.5, 1.3), 41, F.semi, 6.5, dark ? MUTED_DARK : MUTED, 1.3);
      const pn = String(pageNo).padStart(2, "0");
      s.text(pn, PW - M - measure(pn, F.semi, 8), PH - 44, F.semi, 8, dark ? MUTED_DARK : MUTED);
      s.text("borivon.com", M, PH - 44, F.reg, 8, dark ? MUTED_DARK : MUTED);
    }
    return { page, s };
  };
  const icon = (page: PDFPage, name: IconName, x: number, top: number, size: number, c: IconColors) => drawIcon(page, PH, name, x, top, size, c);
  const on = (bg: RGB): IconColors => ({ base: NAVY, accent: GOLD, hole: bg });
  const ON_DARK: IconColors = { base: CARD, accent: GOLD, hole: NAVY };

  /** Wrapped paragraph; returns the y after it. */
  function para(s: Surface, text: string, x: number, y: number, width: number, font: DocFont, size: number, color: RGB, lh = 1.6): number {
    for (const ln of wrapText(text, font, size, width)) {
      s.text(ln, x, y, font, size, color);
      y += size * lh;
    }
    return y;
  }
  const paraH = (text: string, font: DocFont, size: number, width: number, lh = 1.6) => wrapText(text, font, size, width).length * size * lh;
  const eyebrow = (s: Surface, text: string, x: number, y: number, color: RGB = GOLD) => s.text(text.toUpperCase(), x, y, F.semi, 7.5, color, 1.6);
  const title = (s: Surface, text: string, y: number, size = 32, color: RGB = INK) => para(s, text, M, y, W, F.bold, size, color, 1.16);
  /** A soft circle with an icon in the middle. */
  const badge = (page: PDFPage, s: Surface, name: IconName, x: number, top: number, d: number, bg: RGB) => {
    s.roundedRect(x, top, d, d, d / 2, { fill: bg });
    const is = d * 0.56;
    icon(page, name, x + (d - is) / 2, top + (d - is) / 2, is, on(bg));
  };

  // ── 1 · cover ─────────────────────────────────────────────────────────────
  {
    const { page, s } = newPage(true);
    icon(page, "stairs", M, 150, 84, ON_DARK);
    let y = 280;
    eyebrow(s, input.firstName ? `${t.for} ${input.firstName}` : t.title, M, y, GOLD_LIGHT);
    y = para(s, t.title, M, y + 22, W, F.bold, 44, CARD, 1.1);
    if (input.facility) y = para(s, input.facility, M, y + 6, W, F.serif, 26, GOLD_LIGHT, 1.2);
    s.text(input.date.toLocaleDateString(lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "de-DE"), M, y + 10, F.reg, 10.5, MUTED_DARK);

    const cy = 548, ch = 172;
    s.roundedRect(M, cy, W, ch, 20, { fill: NAVY_2 });
    eyebrow(s, `${t.level} ${lv} ${t.of5}`, M + 30, cy + 30, GOLD_LIGHT);
    s.text(pick(L.name, lang), M + 30, cy + 50, F.bold, 32, CARD);
    para(s, pick(L.line, lang), M + 30, cy + 96, W - 60, F.reg, 13, MUTED_DARK);
    const bw = (W - 60 - 4 * 8) / 5;
    for (let i = 1; i <= 5; i++) s.roundedRect(M + 30 + (i - 1) * (bw + 8), cy + 138, bw, 6, 3, { fill: i <= lv ? GOLD : NAVY_3 });

    if (result.totalYear > 0) {
      s.text(t.lossYear, M, cy + ch + 30, F.reg, 10.5, MUTED_DARK);
      s.text(`−${formatEuro(result.totalYear, lang)} ${t.perYear}`, M, cy + ch + 48, F.bold, 18, RED_LIGHT);
    }
  }

  // ── 2 · you are here: the staircase ───────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.ladder, M, y);
    title(s, t.youAreHere + ".", y + 22, 34);
    const base = 548, gap = 12, cw = (W - 4 * gap) / 5;
    const hs = [84, 128, 172, 216, 260];
    for (let i = 1; i <= 5; i++) {
      const x = M + (i - 1) * (cw + gap), hh = hs[i - 1], top = base - hh;
      const me = i === lv, done = i < lv;
      s.roundedRect(x, top, cw, hh, 12, { fill: me ? GOLD : done ? NAVY : STEP_IDLE });
      s.text(String(i), x + 16, top + 14, F.bold, 22, me || done ? CARD : MUTED);
      para(s, pick(LEVELS[i as Level].name, lang), x, base + 14, cw, F.semi, 9.5, me ? INK : MUTED, 1.35);
      if (me) {
        const tag = t.youAreHere;
        const tw = measure(tag, F.semi, 9) + 26;
        const px = Math.min(Math.max(x + cw / 2 - tw / 2, M), M + W - tw);
        s.roundedRect(px, top - 44, tw, 26, 13, { fill: NAVY });
        s.text(tag, px + 13, top - 37, F.semi, 9, CARD);
        page.drawSvgPath("M 0 0 L 14 0 L 7 8 Z", { x: x + cw / 2 - 7, y: PH - (top - 19), color: NAVY });
      }
    }
    y = 626;
    s.text(pick(L.name, lang), M, y, F.bold, 22, INK);
    para(s, pick(L.line, lang), M, y + 32, W, F.reg, 12.5, MUTED);
    const lw = (W - 2 * 18) / 3;
    L.looks.forEach((lk, i) => {
      const x = M + i * (lw + 18);
      s.roundedRect(x, y + 74, 8, 8, 4, { fill: GOLD });
      para(s, pick(lk, lang), x + 16, y + 70, lw - 16, F.reg, 11, INK, 1.5);
    });
  }

  // ── 3 · your level: story, typical profile, bottom line ──────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, `${t.level} ${lv} · ${pick(L.name, lang)}`, M, y);
    title(s, SU.whenYou.replace("{n}", String(lv)), y + 22, 34);
    const top = 182;
    const story = pick(St.story, lang);
    const sh = paraH(story, F.reg, 14.5, W, 1.7);
    const bh = 58 + sh + 38;
    s.rect(0, top, PW, bh, NAVY);
    s.rect(M, top + 38, 28, 3, GOLD);
    para(s, story, M, top + 58, W, F.reg, 14.5, CARD, 1.7);
    y = top + bh + 34;
    eyebrow(s, SU.typical.replace("{n}", String(lv)), M, y, MUTED);
    y += 22;
    const gw = (W - 14) / 2, gh = 70;
    PROFILE_ROWS.forEach((r, i) => {
      const x = M + (i % 2) * (gw + 14);
      const tp = y + Math.floor(i / 2) * (gh + 14);
      s.roundedRect(x, tp, gw, gh, 16, { fill: CARD, border: LINE, borderWidth: 0.8 });
      icon(page, r.icon, x + 18, tp + (gh - 32) / 2, 32, on(CARD));
      s.text(pick(r.name, lang), x + 64, tp + 18, F.reg, 9.5, MUTED);
      para(s, pick(St.profile[r.key], lang), x + 64, tp + 34, gw - 80, F.bold, 14, INK, 1.25);
    });
    y += 2 * gh + 14 + 26;
    const bl = pick(St.bottom, lang), gb = pick(St.gradBy, lang);
    const blH = paraH(bl, F.bold, 16, W - 56, 1.35), gbH = paraH(gb, F.bold, 14, W - 56, 1.35);
    const ch = 28 + 18 + blH + 18 + 18 + gbH + 22;
    s.roundedRect(M, y, W, ch, 18, { fill: GOLD_SOFT });
    let cy = y + 28;
    eyebrow(s, SU.bottom, M + 28, cy);
    cy = para(s, bl, M + 28, cy + 18, W - 56, F.bold, 16, INK, 1.35) + 18;
    eyebrow(s, SU.gradBy, M + 28, cy, GREEN);
    para(s, gb, M + 28, cy + 18, W - 56, F.bold, 14, GREEN, 1.35);
  }

  // ── 4 · your numbers ──────────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.numbers, M, y);
    y = para(s, "−" + formatEuro(result.totalYear, lang), M, y + 22, W, F.bold, 44, RED, 1.1);
    s.text(t.total, M, y + 2, F.reg, 12.5, MUTED);
    y += 48;
    const row = (ic: IconName, label: string, big: string, small: string, color: RGB) => {
      const rh = 108;
      s.roundedRect(M, y, W, rh, 18, { fill: CARD, border: LINE, borderWidth: 0.8 });
      badge(page, s, ic, M + 24, y + (rh - 60) / 2, 60, GOLD_SOFT);
      const tx = M + 108;
      s.text(label, tx, y + 24, F.reg, 11.5, MUTED);
      s.text(big, tx, y + 44, F.bold, 25, color);
      if (small) s.text(small, tx, y + 80, F.reg, 10, MUTED);
      y += rh + 16;
    };
    row("bed", t.openPosts, `−${formatEuro(result.openCostMonth, lang)} ${t.perMonth}`, `−${formatEuro(result.openCostYear, lang)} ${t.perYear}`, RED);
    row("door", t.leaving, `−${formatEuro(result.turnoverCostYear, lang)} ${t.perYear}`, "", RED);
    row("heart", t.perNurse, `+${formatEuro(result.perNurseMonth, lang)} ${t.perMonth}`, `+${formatEuro(result.perNurseMonth * 12, lang)} ${t.perYear}`, GREEN);
    y += 14;
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
    y = title(s, SU.areasTitle, y + 22, 32);
    y = para(s, SU.areasSub, M, y + 10, W, F.reg, 13, MUTED) + 20;
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
    const rh = Math.max(76, 26 + 16 + paraH(rt, F.reg, 12, W - 100, 1.5) + 20);
    s.roundedRect(M, y, W, rh, 18, { fill: GOLD_SOFT });
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
    const bh = 36 + 18 + paraH(bt, F.bold, 21, tw, 1.2) + 10 + paraH(bd, F.reg, 12.5, tw, 1.6) + 30;
    s.rect(0, top, PW, bh, NAVY);
    icon(page, "target", M, top + 38, 46, ON_DARK);
    eyebrow(s, t.plan, tx, top + 36, GOLD_LIGHT);
    let y = para(s, bt, tx, top + 54, tw, F.bold, 21, CARD, 1.2);
    para(s, bd, tx, y + 10, tw, F.reg, 12.5, MUTED_DARK, 1.6);
    y = top + bh + 34;
    const C = CLIMB[lv];
    y = para(s, pick(C.goal, lang), M, y, W, F.bold, 17, INK, 1.3) + 18;
    // the vertical line first, circles on top
    const steps = C.steps.map((st) => ({ t: pick(st.t, lang), d: pick(st.d, lang) }));
    const hs = steps.map((st) => Math.max(36, 24 + paraH(st.d, F.reg, 12, W - 58, 1.55)) + 20);
    const total = hs.reduce((p, c) => p + c, 0);
    s.rect(M + 17, y + 18, 2, total - hs[hs.length - 1], GOLD);
    steps.forEach((st, i) => {
      const n = String(i + 1);
      s.roundedRect(M, y, 36, 36, 18, { fill: NAVY });
      s.text(n, M + 18 - measure(n, F.bold, 14) / 2, y + 10, F.bold, 14, CARD);
      s.text(st.t, M + 58, y + 4, F.semi, 14, INK);
      para(s, st.d, M + 58, y + 26, W - 58, F.reg, 12, MUTED, 1.55);
      y += hs[i];
    });
    const trap = pick(L.trap, lang);
    const th = Math.max(70, 22 + paraH(trap, F.reg, 11.5, W - 96, 1.55) + 20);
    y += 6;
    s.roundedRect(M, y, W, th, 18, { fill: RED_SOFT });
    icon(page, "warning", M + 24, y + (th - 32) / 2, 32, on(RED_SOFT));
    para(s, trap, M + 74, y + 22, W - 96, F.reg, 11.5, INK, 1.55);
  }

  // ── 7 · the 90-day plan ───────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = 96;
    eyebrow(s, t.e90, M, y);
    icon(page, "calendar", M + W - 56, 92, 56, on(PAPER));
    y = title(s, t.plan90, y + 22, 32);
    y = para(s, t.plan90sub, M, y + 10, W - 80, F.reg, 13, MUTED) + 24;
    const gw = (W - 16) / 2, iw = gw - 60;
    const cardH = (b: (typeof PLAN_90)[number]) => 24 + 14 + 18 + b.items.reduce((p, it) => p + paraH(pick(it, lang), F.reg, 11.5, iw, 1.45) + 9, 0) + 12;
    for (let r = 0; r < PLAN_90.length; r += 2) {
      const pair = PLAN_90.slice(r, r + 2);
      const rh = Math.max(...pair.map(cardH));
      pair.forEach((b, j) => {
        const x = M + j * (gw + 16);
        s.roundedRect(x, y, gw, rh, 18, { fill: CARD, border: LINE, borderWidth: 0.8 });
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
    y = title(s, t.reasons, y + 22, 30);
    y = para(s, t.reasonsSub, M, y + 10, W, F.reg, 13, MUTED) + 22;
    const icons: IconName[] = ["house", "team", "speech", "money", "family", "star", "chat"];
    const check: IconColors = { base: GREEN, accent: GREEN, hole: PAPER };
    REASONS.forEach((r, i) => {
      s.hline(M, M + W, y, LINE, 0.8);
      const tp = y + 18;
      icon(page, icons[i], M, tp, 30, on(PAPER));
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
    y = title(s, SU.aroundTitle, y + 22, 30) + 18;
    const card = (lvl: Level, ahead: boolean) => {
      const D = LEVELS[lvl], S2 = STAGES[lvl];
      const bg = ahead ? GOLD_SOFT : CARD;
      const story = pick(S2.story, lang);
      const iw = W - 56;
      const tilesH = ahead ? 70 : 0;
      const h = 30 + 46 + 12 + paraH(story, F.reg, 12, iw, 1.6) + (ahead ? 14 + tilesH : 0) + 16 + 18 + 26;
      s.roundedRect(M, y, W, h, 20, ahead ? { fill: bg, border: GOLD, borderWidth: 1 } : { fill: bg, border: LINE, borderWidth: 0.8 });
      const ic: IconColors = ahead ? { base: NAVY, accent: GOLD, hole: bg } : { base: GREEN, accent: GOLD, hole: bg };
      icon(page, ahead ? "up" : "check", M + 28, y + 30, 40, ic);
      eyebrow(s, ahead ? SU.next : SU.prev, M + 82, y + 32, ahead ? GOLD : GREEN);
      s.text(`${t.level} ${lvl} · ${pick(D.name, lang)}`, M + 82, y + 48, F.bold, 18, INK);
      let cy = para(s, story, M + 28, y + 30 + 46 + 12, iw, F.reg, 12, ahead ? INK : MUTED, 1.6);
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
      eyebrow(s, SU.bottom, M + 28, cy, ahead ? GOLD : MUTED);
      s.text(pick(S2.bottom, lang), M + 28, cy + 16, F.semi, 11.5, INK);
      y += h + 18;
    };
    if (lv > 1) card((lv - 1) as Level, false);
    if (lv < 5) card((lv + 1) as Level, true);
  }

  // ── 10 · next step, framed as "see if you fit" ────────────────────────────
  {
    const { page, s } = newPage(true);
    let y = 112;
    eyebrow(s, t.eNext, M, y, GOLD_LIGHT);
    y = para(s, lv === 5 ? SU.wantStay : SU.wantNext, M, y + 22, W, F.bold, 36, CARD, 1.15);
    y = para(s, SU.stuck, M, y + 18, W, F.reg, 14, MUTED_DARK, 1.65);
    y = para(s, t.nextBody, M, y + 12, W, F.reg, 14, CARD, 1.65) + 22;
    eyebrow(s, t.callGet, M, y, GOLD_LIGHT);
    y += 24;
    for (const pt of t.callPts.split("|")) {
      icon(page, "check", M, y - 3, 22, { base: GOLD, accent: GOLD, hole: NAVY });
      s.text(pt, M + 36, y, F.reg, 13.5, CARD);
      y += 34;
    }
    y = para(s, SU.fitLine, M, y + 4, W, F.reg, 12, MUTED_DARK, 1.6) + 22;
    const btn = t.book;
    const bw = measure(btn, F.semi, 14) + 64, bh = 52;
    s.roundedRect(M, y, bw, bh, 26, { fill: GOLD });
    s.text(btn, M + 32, y + 17, F.semi, 14, NAVY);
    const link = doc.context.register(doc.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [M, PH - y - bh, M + bw, PH - y], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(BOOK_URL) },
    }));
    page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
    s.text(BOOK_URL.replace("https://", ""), M, y + bh + 18, F.reg, 10.5, MUTED_DARK);
    s.text(`${t.contact}: contact@borivon.com`, M, y + bh + 36, F.reg, 10.5, MUTED_DARK);
    para(s, t.disclaimer, M, PH - 78, W, F.reg, 8, MUTED_DARK);
  }

  return doc.save();
}
