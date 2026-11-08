/**
 * The personal Pflege-Fahrplan PDF (A4). Drawn with pdf-lib on the same
 * helpers as the B2 report (lib/pdflib/render.ts), so it runs on Workers.
 *
 * Structure (founder 2026-11-08, "transformation, not information"; see lib/roadmap/visual.ts):
 *   cover · 5-level staircase · [watch this first] · before → after · leaky bucket ·
 *   lose vs win (+ calculator) · [the deadline] · checklists to the next level ·
 *   90-day plan. One picture per page, few words. NO pitch, nothing sold: the PDF
 *   is a pure value asset; our offer only appears in the later emails.
 *
 * Design = borivon.com: night #0e0e10, gold #c9a240, paper #f6f4ef, Playfair
 * Display headings (drawn as outlines, lib/roadmap/vectorFont.ts), Lexend body,
 * the italic "Borivon." wordmark with a gold dot, two-tone pictograms.
 * Words a 5-year-old could follow. Links stay clickable on the website viewer
 * (lib/roadmap/hosted.ts reads them back out).
 */
import { PDFDocument, PageSizes, PDFName, PDFString, type PDFPage, type PDFRef, type RGB } from "pdf-lib";
import { embedFonts, hexColor, Surface, wrapText, measure, type DocFont } from "@/lib/pdflib/render";
import type { RoadmapResult, Level } from "./score";
import { LEVELS, CLIMB, PLAN_90, UI, pick, type Lang } from "./content";
import { STAGE_UI } from "./stages";
import { drawIcon, type IconName, type IconColors } from "./icons";
import { FACILITY, leaveModel } from "./types";
import { costPerDeparture } from "./score";
import { loadVectorFont, wrapVector, type VectorFont } from "./vectorFont";
import { VIDEO_INTRO } from "./videos";
import { PLAYBOOK } from "./playbook";
import { buildTimeline, STEP_NAME, TL } from "./timeline";
import { BEDARF_LINE, type FormV2 } from "./form";
import { LEVEL_ICON, BEFORE_AFTER, V } from "./visual";

// borivon.com tokens (content/pflege/*.html :root) + their light-paper twins
const NIGHT = hexColor("#0e0e10");
const NIGHT_CARD = hexColor("#18181c");
const NIGHT_LINE = hexColor("#2b2b30");
const FG = hexColor("#eeecea");
const MUTED_NIGHT = hexColor("#9a978f");
const GOLD = hexColor("#c9a240");
const GOLD_2 = hexColor("#dcc283");     // the lighter block under a gold one
const GOLD_TEXT = hexColor("#9c7a27");  // gold that stays readable on paper
const GOLD_SOFT = hexColor("#efe7d2");
const WARN_NIGHT = hexColor("#e07a5f");
const PAPER = hexColor("#f6f4ef");
const CARD = hexColor("#ffffff");
const LINE = hexColor("#e7e1d4");
const INK = hexColor("#1c1c1e");
const ON_GOLD = hexColor("#131312");
const MUTED = hexColor("#6d6a63");
const RED = hexColor("#b5553b");
const RED_SOFT = hexColor("#f8ebe5");
const GREEN = hexColor("#3f7a52");

const PLAYFAIR = "pflege/assets/playfair-latin.woff2";
const PLAYFAIR_ITALIC = "pflege/assets/playfair-italic-latin.woff2";

export type RoadmapPdfInput = {
  result: RoadmapResult;
  lang: Lang;
  /** who it is for, as addressed: "Frau Müller" ("" = no name on the cover) */
  name: string;
  facility: string;
  /** the personal calculator link (lib/roadmap/calc.ts); a generic one when missing */
  calcUrl?: string;
  date: Date;
  /** the v2 form answers (lib/roadmap/form.ts); adds the personal timeline page */
  form?: FormV2;
};

export function formatEuro(n: number, lang: Lang): string {
  const v = Math.round(n);
  if (lang === "en") return "€" + v.toLocaleString("en-GB");
  // fr-FR groups with U+202F (narrow no-break space): the fonts have no glyph for it
  const s = v.toLocaleString(lang === "de" ? "de-DE" : "fr-FR").replace(/[  ]/g, " ");
  return s + " €";
}

/**
 * How many pages a Fahrplan has: cover · staircase · before/after · bucket · numbers ·
 * [timeline] · checklists · 90 days. The level no longer adds pages.
 */
export function roadmapPageCount(_level: Level, timeline = false): number {
  return 7 + (timeline ? 1 : 0) + (VIDEO_INTRO ? 1 : 0);
}

type Fonts = { reg: DocFont; semi: DocFont };
type Tone = "paper" | "night" | "gold";

export async function renderRoadmapPdf(input: RoadmapPdfInput): Promise<Uint8Array> {
  const { result, lang } = input;
  const t = UI[lang];
  const SU = STAGE_UI[lang];
  const VV = V[lang];
  const doc = await PDFDocument.create();
  doc.setTitle(`${t.title} · ${input.facility || "Borivon"}`);
  doc.setAuthor("Borivon");
  doc.setCreator("borivon.com");
  const f = await embedFonts(doc, ["Lexend-Regular.ttf", "Lexend-SemiBold.ttf"]);
  const F: Fonts = { reg: f["Lexend-Regular.ttf"], semi: f["Lexend-SemiBold.ttf"] };
  const [H, HN, HI] = await Promise.all([loadVectorFont(PLAYFAIR, 0.012), loadVectorFont(PLAYFAIR, 0.024), loadVectorFont(PLAYFAIR_ITALIC)]);

  const [PW, PH] = PageSizes.A4;
  const M = 56;
  const W = PW - 2 * M;
  const lv = result.level;
  const sn = (n: number) => SU.stageN.replace("{n}", String(n));
  const levelName = (n: Level) => pick(LEVELS[n].name, lang);

  // ── page frame: header + footer are drawn last, over whatever the page did ──
  const frames: { page: PDFPage; s: Surface; top: Tone; bottom: Tone; no: number }[] = [];
  const links = new Map<PDFPage, PDFRef[]>();
  const newPage = (bg: Tone = "paper") => {
    const page = doc.addPage([PW, PH]);
    const s = new Surface(page, PH);
    s.rect(0, 0, PW, PH, bg === "night" ? NIGHT : bg === "gold" ? GOLD : PAPER);
    const fr = { page, s, top: bg, bottom: bg, no: frames.length + 1 };
    frames.push(fr);
    return fr;
  };
  const link = (page: PDFPage, x: number, top: number, w: number, h: number, url: string) => {
    const ref = doc.context.register(doc.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [x, PH - top - h, x + w, PH - top], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    }));
    links.set(page, [...(links.get(page) ?? []), ref]);
  };

  // ── text helpers (all top-origin) ───────────────────────────────────────────
  const disp = (page: PDFPage, vf: VectorFont, text: string, x: number, y: number, width: number, size: number, color: RGB, lh = 1.1, track = -0.02): number => {
    for (const ln of wrapVector(text, vf, size, width, size * track)) { vf.draw(page, PH, ln, x, y, size, color, size * track); y += size * lh; }
    return y;
  };
  const cdisp = (page: PDFPage, vf: VectorFont, text: string, y: number, width: number, size: number, color: RGB, lh = 1.08): number => {
    for (const ln of wrapVector(text, vf, size, width, size * -0.02)) { vf.draw(page, PH, ln, (PW - vf.measure(ln, size, size * -0.02)) / 2, y, size, color, size * -0.02); y += size * lh; }
    return y;
  };
  function para(s: Surface, text: string, x: number, y: number, width: number, font: DocFont, size: number, color: RGB, lh = 1.6): number {
    for (const ln of wrapText(text, font, size, width)) { s.text(ln, x, y, font, size, color); y += size * lh; }
    return y;
  }
  const cpara = (s: Surface, text: string, cx: number, y: number, width: number, font: DocFont, size: number, color: RGB, lh = 1.6, track = 0): number => {
    for (const ln of wrapText(text, font, size, width, track)) { s.text(ln, cx - measure(ln, font, size, track) / 2, y, font, size, color, track); y += size * lh; }
    return y;
  };
  const paraH = (text: string, font: DocFont, size: number, width: number, lh = 1.6) => wrapText(text, font, size, width).length * size * lh;
  const caps = (s: Surface, text: string, x: number, y: number, size: number, color: RGB, font = F.semi) => s.text(text.toUpperCase(), x, y, font, size, color, size * 0.12);
  const capsW = (text: string, size: number, font = F.semi) => measure(text.toUpperCase(), font, size, size * 0.12);
  /** A filled label block like acquisition.com's purple tags. Returns its bottom. */
  const block = (s: Surface, text: string, x: number, y: number, size: number, fill: RGB, color: RGB, padX = 14, padY = 8) => {
    const w = measure(text, F.semi, size) + 2 * padX, h = size + 2 * padY;
    s.rect(x, y, w, h, fill);
    s.text(text, x + padX, y + padY, F.semi, size, color);
    return y + h;
  };
  const icon = (page: PDFPage, name: IconName, x: number, top: number, size: number, c: IconColors) => drawIcon(page, PH, name, x, top, size, c);
  const on = (bg: RGB): IconColors => ({ base: INK, accent: GOLD, hole: bg });
  const wordmark = (page: PDFPage, x: number, top: number, size: number, color: RGB) => {
    HI.draw(page, PH, "Borivon", x, top, size, color);
    H.draw(page, PH, ".", x + HI.measure("Borivon", size), top, size, GOLD);
  };
  const triangle = (page: PDFPage, cx: number, top: number, w: number, h: number, color: RGB, dir: "down" | "right" | "left" = "down") => {
    const d = dir === "down" ? `M 0 0 L ${w} 0 L ${w / 2} ${h} Z` : dir === "right" ? `M 0 0 L ${w} ${h / 2} L 0 ${h} Z` : `M ${w} 0 L 0 ${h / 2} L ${w} ${h} Z`;
    page.drawSvgPath(d, { x: cx - w / 2, y: PH - top, color });
  };
  const playButton = (page: PDFPage, s: Surface, cx: number, top: number, d: number, url: string) => {
    s.roundedRect(cx - d / 2, top, d, d, d / 2, { fill: GOLD });
    page.drawSvgPath(`M 0 0 L ${d * 0.34} ${d * 0.2} L 0 ${d * 0.4} Z`, { x: cx - d * 0.12, y: PH - (top + d * 0.3), color: ON_GOLD });
    link(page, cx - d / 2, top, d, d, url);
  };
  const tagLine = `${t.title}  •  ${sn(lv)}: ${levelName(lv)}`.toUpperCase();

  // ── 1 · cover: calm, big title, the staircase as the picture ──────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    fr.top = "night";
    s.rect(0, 0, PW, 300, NIGHT);
    wordmark(page, M, 30, 15, FG);
    cdisp(page, HN, t.title, 104, W, 64, FG, 1.0);
    s.rect(0, 300, PW, 44, GOLD);
    const stg = `${sn(lv)}: ${levelName(lv)}`.toUpperCase();
    const sw = capsW(stg, 24);
    caps(s, stg, (PW - sw) / 2, 392, 24, INK);
    triangle(page, (PW - sw) / 2 - 26, 395, 15, 20, GOLD, "right");
    triangle(page, (PW + sw) / 2 + 26, 395, 15, 20, GOLD, "left");
    // the 5 steps, theirs in gold
    const bw = 46, gap = 12, sx = (PW - (5 * bw + 4 * gap)) / 2, base = 650;
    for (let i = 1 as Level; i <= 5; i = (i + 1) as Level) {
      const h = 40 + (i - 1) * 34, x = sx + (i - 1) * (bw + gap), me = i === lv;
      s.rect(x, base - h, bw, h, me ? GOLD : LINE);
      const n = String(i);
      s.text(n, x + (bw - measure(n, F.semi, 11)) / 2, base - h + 10, F.semi, 11, me ? ON_GOLD : MUTED);
      if (me) triangle(page, x + bw / 2, base - h - 22, 14, 11, GOLD);
      if (i === 5) break;
    }
    if (input.name) cpara(s, `${t.for} ${input.name}`, PW / 2, 690, W, F.reg, 12, INK, 1.4);
    const wm = HI.measure("Borivon", 30) + H.measure(".", 30);
    wordmark(page, (PW - wm) / 2, PH - 110, 30, INK);
  }

  // ── 2 · the 5 levels as a staircase, "you are here" on theirs ─────────────
  {
    const fr = newPage("night");
    const { page, s } = fr;
    cdisp(page, HN, VV.ladderH, 70, W, 48, FG);
    const x0 = M - 20, gap = 8, cw = (W + 40 - gap * 4) / 5, base = PH - 96;
    for (let i = 1 as Level; i <= 5; i = (i + 1) as Level) {
      const me = i === lv, h = 180 + (i - 1) * 46, x = x0 + (i - 1) * (cw + gap), top = base - h;
      s.rect(x, top, cw, h, me ? GOLD : NIGHT_CARD);
      const ink = me ? ON_GOLD : FG, sub = me ? ON_GOLD : MUTED_NIGHT;
      icon(page, LEVEL_ICON[i], x + (cw - 36) / 2, top + 14, 36, me ? { base: ON_GOLD, accent: FG, hole: GOLD } : { base: FG, accent: GOLD, hole: NIGHT_CARD });
      const num = String(i);
      HN.draw(page, PH, num, x + (cw - HN.measure(num, 30)) / 2, top + 58, 30, me ? ON_GOLD : GOLD);
      const ty = cpara(s, levelName(i).toUpperCase(), x + cw / 2, top + 98, cw - 8, F.semi, 10.5, ink, 1.3, 0.8) + 6;
      cpara(s, pick(LEVELS[i].line, lang), x + cw / 2, ty, cw - 14, F.reg, 9, sub, 1.4);
      if (me) {
        const lbl = VV.you, lw = measure(lbl, F.semi, 11, 1.5);
        s.text(lbl, x + (cw - lw) / 2, top - 44, F.semi, 11, GOLD, 1.5);
        triangle(page, x + cw / 2, top - 24, 18, 14, GOLD);
      }
      if (i === 5) break;
    }
  }

  // ── (optional) watch this first ───────────────────────────────────────────
  if (VIDEO_INTRO) {
    const fr = newPage();
    const { page, s } = fr;
    cdisp(page, HN, SU.watch, 74, W, 50, INK);
    playButton(page, s, PW / 2, 170, 86, VIDEO_INTRO);
    s.rect(0, 330, PW, PH - 330, NIGHT);
    fr.bottom = "night";
    cdisp(page, H, SU.watchLead, 450, W - 40, 28, FG, 1.2);
  }

  // ── 3 · before → after (their level → the next) ───────────────────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    let y = disp(page, HN, VV.baH, M, 70, W, 46, INK, 1.05) + 18;
    const cw = (W - 44) / 2, rx = M + cw + 44;
    const nxt = lv < 5 ? (lv + 1) as Level : 5;
    block(s, `${VV.today} · ${VV.nextOf5.replace("{n}", String(lv))}`.toUpperCase(), M, y, 9, RED, CARD, 10, 6);
    block(s, (lv < 5 ? `${VV.withPlan} · ${VV.nextOf5.replace("{n}", String(nxt))}` : SU.successA).toUpperCase(), rx, y, 9, GREEN, CARD, 10, 6);
    y += 40;
    const rh = 96, ch = rh - 14;
    for (const r of BEFORE_AFTER[lv]) {
      s.roundedRect(M, y, cw, ch, 16, { fill: RED_SOFT });
      icon(page, r.ic, M + 16, y + (ch - 40) / 2, 40, { base: RED, accent: RED, hole: RED_SOFT });
      const bt = pick(r.b, lang), bh = paraH(bt, F.semi, 12.5, cw - 80, 1.35);
      para(s, bt, M + 68, y + (ch - bh) / 2 + 2, cw - 80, F.semi, 12.5, INK, 1.35);
      triangle(page, M + cw + 22, y + ch / 2 - 9, 14, 18, GOLD, "right");
      s.roundedRect(rx, y, cw, ch, 16, { fill: CARD, border: GREEN, borderWidth: 1.2 });
      icon(page, r.ic, rx + 16, y + (ch - 40) / 2, 40, { base: GREEN, accent: GOLD, hole: CARD });
      const at = pick(r.a, lang), ah = paraH(at, F.semi, 12.5, cw - 80, 1.35);
      para(s, at, rx + 68, y + (ch - ah) / 2 + 2, cw - 80, F.semi, 12.5, INK, 1.35);
      y += rh;
    }
    // the one-line goal on a gold band
    const bandTop = PH - 190;
    s.rect(0, bandTop, PW, PH - bandTop, GOLD);
    fr.bottom = "gold";
    icon(page, "up", M, bandTop + 36, 46, { base: ON_GOLD, accent: ON_GOLD, hole: GOLD });
    disp(page, H, pick(CLIMB[lv].goal, lang), M + 66, bandTop + 40, W - 66, 24, ON_GOLD, 1.15);
  }

  // ── 4 · the leaky bucket (one picture, one lesson) ────────────────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    cdisp(page, HN, VV.bucketH, 70, W, 46, INK);
    const cx = PW / 2;
    cpara(s, VV.bucketIn.toUpperCase(), cx, 128, W, F.semi, 9, GOLD_TEXT, 1.3, 1.2);
    for (let k = -1; k <= 1; k++) icon(page, "nurse", cx + k * 54 - 20, 146, 40, on(PAPER));
    triangle(page, cx, 194, 26, 18, GOLD);
    const bt = 276, bw = 250, bh = 214;
    page.drawSvgPath(`M 0 12 C 0 -80 ${bw} -80 ${bw} 12`, { x: cx - bw / 2, y: PH - bt, borderColor: NIGHT, borderWidth: 5 });
    page.drawSvgPath(`M 0 0 L ${bw} 0 L ${bw - 36} ${bh} L 36 ${bh} Z`, { x: cx - bw / 2, y: PH - bt, color: NIGHT });
    page.drawSvgPath(`M 16 54 L ${bw - 16} 54 L ${bw - 46} ${bh - 12} L 46 ${bh - 12} Z`, { x: cx - bw / 2, y: PH - bt, color: GOLD });
    s.roundedRect(cx - bw / 2 - 10, bt - 8, bw + 20, 14, 7, { fill: NIGHT });
    [-1, 0, 1].forEach((k, i) => {
      const hx = cx + k * 60, hy = bt + bh, lx = cx + k * 140;
      for (let d = 0; d < 2; d++) page.drawSvgPath("M 7 0 C 7 0 14 10 14 15 A 7 7 0 0 1 0 15 C 0 10 7 0 7 0 Z", { x: hx + (lx - hx) * (d + 1) / 3 - 7, y: PH - (hy + 8 + d * 22), color: RED });
      cpara(s, VV.bucketOut[i].toUpperCase(), lx, hy + 66, 130, F.semi, 10, RED, 1.3, 0.8);
    });
    cpara(s, VV.bucketLine, cx, bt + bh + 104, W - 40, F.reg, 14, INK, 1.5);
    const bandTop = PH - 170;
    s.rect(0, bandTop, PW, PH - bandTop, NIGHT);
    fr.bottom = "night";
    cdisp(page, H, VV.bucketFix, bandTop + 44, W, 30, GOLD, 1.1);
  }

  // ── 6 · your numbers + the calculator ─────────────────────────────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    let y = disp(page, HN, t.numbers, M, 70, W, 44, INK, 1.05) + 16;
    // lose vs win, side by side: the two numbers that matter
    {
      const cw = (W - 14) / 2, ch = 132;
      const card = (x: number, label: string, big: string, sub: string, color: RGB) => {
        s.roundedRect(x, y, cw, ch, 16, { fill: CARD, border: LINE, borderWidth: 0.8 });
        s.rect(x + 18, y + 18, 28, 3, color);
        caps(s, label, x + 18, y + 30, 9, color);
        let sz = 30;
        while (sz > 18 && HN.measure(big, sz) > cw - 36) sz -= 1;
        HN.draw(page, PH, big, x + 18, y + 50, sz, color);
        para(s, sub, x + 18, y + 92, cw - 36, F.reg, 10.5, MUTED, 1.45);
      };
      card(M, SU.loseLbl, `−${formatEuro(result.totalYear, lang)}`, result.turnoverCostYear > 0 ? SU.loseSub : SU.loseSubOpen, RED);
      card(M + cw + 14, SU.winLbl, `+${formatEuro(result.perNurseMonth * 12, lang)}`, SU.winSub, GREEN);
      y += ch + 22;
    }
    caps(s, SU.whereFrom, M, y, 8, MUTED);
    y += 16;
    const row = (ic: IconName, label: string, big: string, small: string, color: RGB) => {
      const rh = 74;
      s.roundedRect(M, y, W, rh, 16, { fill: CARD, border: LINE, borderWidth: 0.8 });
      icon(page, ic, M + 20, y + 19, 36, on(CARD));
      s.text(label, M + 76, y + 14, F.reg, 10.5, MUTED);
      HN.draw(page, PH, big, M + 76, y + 30, 24, color);
      if (small) s.text(small, M + W - 20 - measure(small, F.reg, 10, 0), y + 40, F.reg, 10, MUTED);
      y += rh + 10;
    };
    row("bed", t.openPosts, `−${formatEuro(result.openCostMonth, lang)} ${t.perMonth}`, `−${formatEuro(result.openCostYear, lang)} ${t.perYear}`, RED);
    if (result.turnoverCostYear > 0) row("door", t.leaving, `−${formatEuro(result.turnoverCostYear, lang)} ${t.perYear}`, "", RED);
    y += 8;
    caps(s, t.howCounted, M, y, 8, MUTED);
    y += 18;
    const FT = FACILITY[result.facilityType];
    const lines: [IconName, string][] = [];
    if (input.form) lines.push(["bed", BEDARF_LINE[lang](input.form)]);
    lines.push([FT.icon, pick(FT.openModel, lang)]);
    if (result.turnoverCostYear > 0) lines.push(["door", leaveModel(result.facilityType, lang, (n) => formatEuro(n, lang), result.perNurseMonth, costPerDeparture(result.facilityType))]);
    lines.push(["target", pick(FT.source, lang)]);
    for (const [ic, txt] of lines) {
      icon(page, ic, M, y - 1, 16, on(PAPER));
      y = para(s, txt, M + 26, y, W - 26, F.reg, 9.5, MUTED, 1.5) + 7;
    }
    // the calculator band (like acquisition.com's "Got it? Let's start" bar)
    const bandTop = Math.max(y + 14, PH - 214);
    s.rect(0, bandTop, PW, PH - bandTop, GOLD);
    fr.bottom = "gold";
    const cl = calcLinkFor(input, lang, result);
    let by = disp(page, H, SU.calcH, M, bandTop + 24, W, 24, ON_GOLD, 1.1);
    by = para(s, t.ownNumbers, M, by + 4, W, F.reg, 11, ON_GOLD, 1.5) + 12;
    const cb = t.calcBtn, cbw = measure(cb, F.semi, 12.5) + 44 + 34, cbh = 38;
    s.roundedRect(M, by, cbw, cbh, 19, { fill: NIGHT });
    s.text(cb, M + 22, by + 12, F.semi, 12.5, FG);
    for (let k = 0; k < 3; k++) triangle(page, M + 22 + measure(cb, F.semi, 12.5) + 14 + k * 10, by + 14, 7, 10, GOLD, "right");
    link(page, M, by, cbw, cbh, cl);
  }

  // ── 6b · the personal deadline (only with the v2 form) ────────────────────
  if (input.form) {
    const T = TL[lang];
    const tl = buildTimeline(input.form, input.date);
    const loc = lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "de-DE";
    const long = (d: Date) => d.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const short = (d: Date) => d.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: "UTC" });
    const fill = (str: string) => str.replace("{date}", tl.target ? long(tl.target) : "").replace("{start}", tl.latestStart ? long(tl.latestStart) : "")
      .replace("{weeks}", String(Math.max(0, tl.weeksLeft ?? 0))).replace("{first}", long(tl.earliestFirstDay));
    const { page, s } = newPage();
    icon(page, "calendar", M + W - 56, 72, 56, on(PAPER));
    let y = disp(page, HN, T.h, M, 70, W - 80, 44, INK, 1.05);
    y = para(s, T.sub, M, y + 6, W - 80, F.reg, 12, MUTED) + 20;
    const [lead, big, color] = tl.status === "asap" ? [T.asap, T.asapBig, GOLD_TEXT] : tl.status === "late" ? [T.late, T.lateBig, RED] : [T.ok, T.okBig, tl.status === "tight" ? RED : GOLD_TEXT];
    y = para(s, fill(lead), M, y, W, F.semi, 13, INK, 1.5) + 8;
    y = disp(page, HN, fill(big), M, y, W, 34, color, 1.1) + 6;
    if (tl.status === "tight") y = para(s, T.tight, M, y, W, F.reg, 11, MUTED, 1.5) + 4;
    y += 18;
    // the steps, top to bottom, with dates
    const lx = M + 84, tx = M + 104, rowH = 44;
    const n = tl.steps.length;
    s.rect(lx - 1.5, y + 6, 3, rowH * n, GOLD_2);
    tl.steps.forEach((st, i) => {
      const yy = y + i * rowH;
      s.text(short(st.from), M, yy + 2, F.semi, 10.5, MUTED);
      s.roundedRect(lx - 6, yy + 1, 12, 12, 6, { fill: GOLD });
      s.text(pick(STEP_NAME[st.key], lang), tx, yy, F.semi, 12, INK);
      s.text(`${st.weeks} ${st.weeks === 1 ? T.week : T.weeks}`, tx, yy + 17, F.reg, 10.5, MUTED);
    });
    const fy = y + n * rowH;
    const last = tl.steps[n - 1].to;
    s.text(short(last), M, fy + 4, F.semi, 10.5, INK);
    s.roundedRect(lx - 10, fy - 2, 20, 20, 10, { fill: NIGHT });
    icon(page, "check", lx - 6, fy + 2, 12, { base: GOLD, accent: GOLD, hole: NIGHT });
    disp(page, H, long(last), tx, fy - 4, W - 104, 20, INK, 1.1);
    y = fy + 46;
  }

  // ── 8 · checklists to the next level (2 × 2 cards, tick boxes) ────────────
  {
    const { page, s } = newPage();
    const head = lv < 5 ? VV.stepsH.replace("{n}", String(lv + 1)) : VV.stayH;
    let y = disp(page, HN, head, M, 70, W, 40, INK, 1.05);
    y = para(s, VV.stepsSub, M, y + 6, W, F.reg, 13, MUTED) + 22;
    const blocks = PLAYBOOK[lv].success, ics: IconName[] = ["target", "team", "calendar", "heart"];
    const cw = (W - 16) / 2, iw = cw - 56;
    const cardH = (b: (typeof blocks)[number]) => 104 + b.items.reduce((h, it) => h + paraH(pick(it, lang), F.reg, 12.5, iw, 1.4) + 12, 0) + 10;
    for (let r = 0; r < blocks.length; r += 2) {
      const pair = blocks.slice(r, r + 2), rh = Math.max(...pair.map(cardH));
      pair.forEach((b, j) => {
        const x = M + j * (cw + 16);
        s.roundedRect(x, y, cw, rh, 18, { fill: CARD, border: LINE, borderWidth: 0.8 });
        icon(page, ics[r + j], x + 18, y + 18, 40, on(CARD));
        s.roundedRect(x + 68, y + 25, 24, 24, 12, { fill: NIGHT });
        const n = String(r + j + 1);
        s.text(n, x + 80 - measure(n, F.semi, 11) / 2, y + 31, F.semi, 11, GOLD);
        para(s, pick(b.t, lang), x + 18, y + 70, cw - 36, F.semi, 15, INK, 1.2);
        let iy = y + 104;
        for (const it of b.items) {
          s.roundedRect(x + 20, iy + 1, 14, 14, 3, { border: GOLD_TEXT, borderWidth: 1.3 });
          iy = para(s, pick(it, lang), x + 44, iy, iw, F.reg, 12.5, INK, 1.4) + 12;
        }
      });
      y += rh + 16;
    }
  }

  // ── 8 · the 90-day plan ───────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    icon(page, "calendar", M + W - 56, 72, 56, on(PAPER));
    let y = disp(page, HN, t.plan90, M, 70, W - 80, 42, INK, 1.05);
    y = para(s, t.plan90sub, M, y + 8, W - 80, F.reg, 12.5, MUTED) + 22;
    const gw = (W - 16) / 2, iw = gw - 60;
    const cardH = (b: (typeof PLAN_90)[number]) => 24 + 14 + 18 + b.items.reduce((p, it) => p + paraH(pick(it, lang), F.reg, 11.5, iw, 1.45) + 9, 0) + 12;
    for (let r = 0; r < PLAN_90.length; r += 2) {
      const pair = PLAN_90.slice(r, r + 2);
      const rh = Math.max(...pair.map(cardH));
      pair.forEach((b, j) => {
        const x = M + j * (gw + 16);
        s.roundedRect(x, y, gw, rh, 16, { fill: CARD, border: LINE, borderWidth: 0.8 });
        block(s, pick(b.when, lang).toUpperCase(), x + 18, y + 18, 8.5, GOLD, ON_GOLD, 8, 5);
        let iy = y + 24 + 14 + 18;
        for (const it of b.items) {
          s.roundedRect(x + 22, iy + 1, 12, 12, 3, { border: MUTED, borderWidth: 1 });
          iy = para(s, pick(it, lang), x + 44, iy, iw, F.reg, 11.5, INK, 1.45) + 9;
        }
      });
      y += rh + 16;
    }
  }

  // ── header + footer on every page but the cover; then the links ───────────
  for (const fr of frames) {
    const { page, s, top, bottom, no } = fr;
    if (no > 1) {
      const hc = top === "night" ? FG : INK, hm = top === "night" ? MUTED_NIGHT : MUTED;
      s.text(tagLine, M, 30, F.semi, 6.5, hc, 0.8);
      const r = SU.personalShort.toUpperCase();
      s.text(r, PW - M - measure(r, F.reg, 6.5, 0.8), 30, F.reg, 6.5, hm, 0.8);
      const fc = bottom === "paper" ? INK : bottom === "gold" ? ON_GOLD : FG;
      const fl = bottom === "paper" ? LINE : bottom === "gold" ? hexColor("#b18c33") : NIGHT_LINE;
      s.hline(M, M + W, PH - 54, fl, 0.8);
      wordmark(page, M, PH - 44, 11, fc);
      const pn = String(no);
      s.text(pn, PW - M - measure(pn, F.reg, 9), PH - 41, F.reg, 9, fc);
    }
    const refs = links.get(page);
    if (refs?.length) page.node.set(PDFName.of("Annots"), doc.context.obj(refs));
  }
  void NIGHT_CARD; void WARN_NIGHT; void GOLD_SOFT;
  return doc.save();
}

/** The calculator link: the personal one when given, else a generic one. */
function calcLinkFor(input: RoadmapPdfInput, lang: Lang, result: RoadmapResult): string {
  return input.calcUrl || `https://borivon.com/fahrplan/rechner?lang=${lang}&f=${result.facilityType}`;
}

