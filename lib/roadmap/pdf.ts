/**
 * The personal Pflege-Fahrplan PDF (A4). Drawn with pdf-lib on the same
 * helpers as the B2 report (lib/pdflib/render.ts), so it runs on Workers.
 *
 * Structure = acquisition.com's $100M Scaling Roadmap, page for page (founder,
 * 2026-11-08: "model them exactly, in our design"):
 *   cover · you are here · [watch this first] · your stage · when you hit it ·
 *   area by area · your numbers (+ calculator) · what success looks like ·
 *   90-day plan · just for your kind of house · 7 reasons · the bottom line ·
 *   next step · then the stage you passed and the stage that comes next, in full.
 * Bold blocks, giant headings, a few words per line.
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
import { LEVELS, CLIMB, BOTTLENECK, PLAN_90, REASONS, UI, pick, type Lang } from "./content";
import { STAGES, AREAS, STAGE_UI } from "./stages";
import { drawIcon, REASON_ICONS, type IconName, type IconColors } from "./icons";
import { FACILITY, leaveModel } from "./types";
import { costPerDeparture } from "./score";
import { loadVectorFont, wrapVector, type VectorFont } from "./vectorFont";
import { VIDEO_INTRO, VIDEO_STAGE } from "./videos";
import { PLAYBOOK, type AreaKey } from "./playbook";
import { buildTimeline, STEP_NAME, TL } from "./timeline";
import { BEDARF_LINE, type FormV2 } from "./form";

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

const BOOK_URL = "https://borivon.com/book/clinic";
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

/** How many pages a Fahrplan has for a level: 12 + the stage behind and the stage ahead (5 each). */
export function roadmapPageCount(level: Level, timeline = false): number {
  return 12 + (timeline ? 1 : 0) + (VIDEO_INTRO ? 1 : 0) + (level > 1 ? 5 : 0) + (level < 5 ? 5 : 0);
}

type Fonts = { reg: DocFont; semi: DocFont };
type Tone = "paper" | "night" | "gold";

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
  const dispH = (vf: VectorFont, text: string, size: number, width: number, lh = 1.1) => wrapVector(text, vf, size, width, size * -0.02).length * size * lh;
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

  // ── reusable stage pages (the person's stage, and the one before/after) ─────

  /** "Your stage": two tag blocks, a play button, then the four facts on night. */
  const stagePage = (n: Level, heading: string) => {
    const fr = newPage();
    const { page, s } = fr;
    const St = STAGES[n];
    cdisp(page, H, heading, 74, W, 46, INK);
    const b1 = block(s, sn(n).toUpperCase(), M, 158, 24, GOLD, ON_GOLD, 16, 10);
    block(s, levelName(n).toUpperCase(), M, b1 + 12, 17, GOLD_2, ON_GOLD, 16, 9);
    if (VIDEO_STAGE[n]) playButton(page, s, PW / 2 + 70, 196, 76, VIDEO_STAGE[n]);
    const top = 330;
    s.rect(0, top, PW, PH - top, NIGHT);
    fr.bottom = "night";
    const lead = VIDEO_STAGE[n] ? SU.videoLead.replace("{n}", String(n)) : pick(LEVELS[n].line, lang);
    cdisp(page, H, lead, top + 110, W - 40, 28, FG, 1.2);
    const cols: [string, string][] = [
      [SU.role, pick(St.profile.role, lang)],
      [SU.openLbl, pick(St.profile.open, lang)],
      [SU.bottom, pick(St.bottom, lang)],
      [SU.gradBy, pick(St.gradBy, lang)],
    ];
    const cw = W / 4;
    cols.forEach(([k, v], i) => {
      const cx = M + cw * i + cw / 2;
      cpara(s, k.toUpperCase(), cx, top + 330, cw - 10, F.semi, 10.5, FG, 1.35, 1);
      cpara(s, v, cx, top + 366, cw - 14, F.reg, 10.5, MUTED_NIGHT, 1.5);
    });
  };

  /** "When you hit stage n": big gold heading block, the story, the hurdle, the areas. */
  const whenPage = (n: Level, current: boolean) => {
    const { page, s } = newPage();
    const St = STAGES[n];
    const l1 = SU.whenHit.replace("{n}", String(n)), l2 = `„${levelName(n)}“`;
    const hw = PW * 0.84 - M;
    const bh = 34 + dispH(H, l1, 34, hw) + dispH(H, l2, 34, hw) + 22;
    s.rect(0, 72, PW * 0.84, bh, GOLD);
    let y = disp(page, H, l1, M, 72 + 30, hw, 34, ON_GOLD);
    disp(page, H, l2, M, y, hw, 34, ON_GOLD);
    y = 72 + bh + 30;
    y = para(s, pick(St.story, lang), M, y, W, F.reg, 12, INK, 1.95) + 14;
    const B = BOTTLENECK[result.bottleneck];
    const hurdle = current ? pick(B.t, lang).replace(/^[^:]*:\s*/, "") : pick(St.bottom, lang);
    y = para(s, `${SU.hurdle}: ${hurdle}`.toUpperCase(), M, y, W, F.semi, 14, INK, 1.4) + 10;
    y = para(s, current ? pick(B.d, lang) : pick(CLIMB[n].goal, lang), M, y, W, F.reg, 12, INK, 1.95) + 12;
    y = para(s, SU.areasLead, M, y, W, F.reg, 12, MUTED, 1.6) + 18;
    const barTop = y, gap = 30, chipsH = AREAS.length * gap;
    s.rect(M, barTop, 12, chipsH + 44, NIGHT);
    AREAS.forEach((a, i) => {
      const mix = i / (AREAS.length - 1);
      const fill = hexColor(mixHex("#c9a240", "#e3cf98", mix));
      block(s, pick(a.name, lang), M + 34, barTop + 22 + i * gap, 11, fill, ON_GOLD, 10, 6);
    });
  };

  /**
   * Area by area on ONE page, like acquisition.com page 7: icon, gold tag, then
   * 3 short lines: the problem, then 2 things to do (green checks).
   */
  const areasPages = (n: Level) => {
    const P = PLAYBOOK[n];
    const { page, s } = newPage();
    const tx = M + 80, tw = W - 80, fs = 11.5, lh = 1.45;
    const lineH = (txt: string, f: typeof F.reg, w: number) => paraH(txt, f, fs, w, lh) + 4;
    const hs = AREAS.map((a) => {
      const r = P.areas[a.key as AreaKey];
      return Math.max(56, 30 + lineH(pick(r[0], lang), F.reg, tw - 16) + r.slice(1).reduce((h, l) => h + lineH(pick(l, lang), F.semi, tw - 20), 0));
    });
    const top = 70, bottom = PH - 74;
    const gap = Math.max(10, Math.min(34, (bottom - top - hs.reduce((a, b) => a + b, 0)) / (AREAS.length - 1)));
    let y = top;
    AREAS.forEach((a, i) => {
      const r = P.areas[a.key as AreaKey];
      icon(page, a.icon, M, y + 2, 52, on(PAPER));
      let yy = block(s, pick(a.name, lang), tx, y, 12.5, GOLD, ON_GOLD, 11, 6) + 10;
      s.text("•", tx + 2, yy, F.reg, fs, MUTED);
      yy = para(s, pick(r[0], lang), tx + 16, yy, tw - 16, F.reg, fs, MUTED, lh) + 4;
      for (const act of r.slice(1)) {
        icon(page, "check", tx, yy + 2, 12, { base: GREEN, accent: GREEN, hole: PAPER });
        yy = para(s, pick(act, lang), tx + 20, yy, tw - 20, F.semi, fs, INK, lh) + 4;
      }
      y += hs[i] + gap;
    });
  };

  /** What success looks like: a vertical line, check circles, 4 night tags with 4 steps each. */
  const successPage = (n: Level) => {
    const { page, s } = newPage();
    let y = disp(page, HN, SU.successA, M, 66, W, 40, INK, 1.05);
    y = disp(page, HN, SU.successB.replace("{n}", String(n)), M, y, W, 40, GOLD_TEXT, 1.05) + 10;
    y = para(s, pick(CLIMB[n].goal, lang) + " " + SU.successLead, M, y, W, F.reg, 11.5, INK, 1.8) + 22;
    const blocks = PLAYBOOK[n].success;
    const lx = M + 20, tx = M + 86, tw = W - 86;
    const hs = blocks.map((b) => 34 + b.items.reduce((h, it) => h + paraH(pick(it, lang), F.reg, 12, tw - 16, 1.45) + 3, 0) + 24);
    const total = hs.reduce((a, b) => a + b, 0);
    s.rect(lx - 2, y + 10, 4, total - hs[hs.length - 1], GOLD);
    blocks.forEach((b, i) => {
      s.roundedRect(lx - 19, y, 38, 38, 19, { fill: NIGHT });
      icon(page, "check", lx - 10, y + 9, 20, { base: GOLD, accent: GOLD, hole: NIGHT });
      for (let dx = lx + 24; dx < tx - 6; dx += 5) s.roundedRect(dx, y + 18, 2, 2, 1, { fill: GOLD });
      block(s, pick(b.t, lang), tx, y + 6, 12.5, NIGHT, FG, 12, 7);
      let yy = y + 42;
      for (const it of b.items) {
        s.text("•", tx + 2, yy, F.reg, 12, INK);
        yy = para(s, pick(it, lang), tx + 16, yy, tw - 16, F.reg, 12, INK, 1.45) + 3;
      }
      y += hs[i];
    });
  };

  /** Night divider before the stage behind / the stage ahead. */
  const dividerPage = (n: Level, text: string) => {
    const fr = newPage("night");
    const { page, s } = fr;
    const y = cdisp(page, H, text, 190, W - 40, 40, FG, 1.15);
    cdisp(page, HN, String(n), y + 40, W, 220, GOLD, 1);
    cpara(s, `${sn(n)}: ${levelName(n)}`.toUpperCase(), PW / 2, y + 330, W, F.semi, 18, FG, 1.4, 2);
  };

  // ── 1 · cover ─────────────────────────────────────────────────────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    fr.top = "night";
    s.rect(0, 0, PW, 262, NIGHT);
    wordmark(page, M, 30, 17, FG);
    cdisp(page, H, t.title, 92, W, 58, FG, 1.0);
    s.rect(0, 262, PW, 48, GOLD);
    const stg = `${sn(lv)}: ${levelName(lv)}`.toUpperCase();
    const sw = capsW(stg, 21);
    caps(s, stg, (PW - sw) / 2, 352, 21, INK);
    triangle(page, (PW - sw) / 2 - 24, 355, 14, 18, GOLD, "right");
    triangle(page, (PW + sw) / 2 + 24, 355, 14, 18, GOLD, "left");
    let y = 432;
    const dateStr = input.date.toLocaleDateString(lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "de-DE");
    if (input.form) {
      // v2: the person is the headline ("Frau Müller"), then "Pflegeheim · Bayern · date"
      if (input.name) y = cpara(s, t.for.toUpperCase(), PW / 2, y, W, F.semi, 9, GOLD_TEXT, 1.6, 1.5) + 6;
      if (input.name) y = cdisp(page, HI, input.name, y, W, 28, INK, 1.2) + 4;
      cpara(s, [input.facility, dateStr].filter(Boolean).join("  ·  "), PW / 2, y + 6, W, F.reg, 10.5, MUTED);
    } else {
      if (input.name) y = cpara(s, `${t.for} ${input.name}`.toUpperCase(), PW / 2, y, W, F.semi, 9, GOLD_TEXT, 1.6, 1.5) + 6;
      if (input.facility) y = cdisp(page, HI, input.facility, y, W, 26, INK, 1.2) + 4;
      cpara(s, `${pick(FACILITY[result.facilityType].name, lang)}  ·  ${dateStr}`, PW / 2, y + 6, W, F.reg, 10.5, MUTED);
    }
    if (result.totalYear > 0) {
      cpara(s, result.turnoverCostYear > 0 ? t.lossYear : t.lossYearOpen, PW / 2, 560, W, F.reg, 11, MUTED);
      cdisp(page, HN, `−${formatEuro(result.totalYear, lang)} ${t.perYear}`, 580, W, 30, RED, 1.1);
    }
    const p = SU.personal.toUpperCase();
    s.text(p, (PW - measure(p, F.reg, 12, 3)) / 2, PH - 150, F.reg, 12, INK, 3);
    const wm = HI.measure("Borivon", 34) + H.measure(".", 34);
    wordmark(page, (PW - wm) / 2, PH - 122, 34, INK);
  }

  // ── 2 · you are here ──────────────────────────────────────────────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    cdisp(page, HN, t.youAreHere + ".", 74, W, 54, INK);
    cpara(s, `${sn(lv)}: ${levelName(lv)}`.toUpperCase(), PW / 2, 150, W, F.semi, 20, GOLD_TEXT, 1.3, 1);
    triangle(page, PW / 2, 190, 38, 30, GOLD);
    const top = 300;
    s.rect(0, top, PW, PH - top, NIGHT);
    fr.bottom = "night";
    let y = top + 70;
    for (let i = 1 as Level; i <= 5; i = (i + 1) as Level) {
      const label = `${i}. ${levelName(i)}`.toUpperCase();
      const me = i === lv;
      if (me) s.rect(M + 60, y - 9, capsW(label, 16) + 24, 36, GOLD);
      caps(s, label, M + 72, y, 16, me ? ON_GOLD : FG);
      s.text(pick(LEVELS[i].line, lang), M + 72, y + 34, F.reg, 10.5, me ? GOLD : MUTED_NIGHT);
      y += 82;
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

  // ── 3–5 · your stage, when you hit it, area by area ───────────────────────
  stagePage(lv, SU.yourStage);
  whenPage(lv, true);
  areasPages(lv);

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
    if (input.form.deutsch === "b2") y = para(s, T.b2, M, y, W, F.reg, 11, MUTED, 1.5) + 4;
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
    // the faster way + where the numbers come from
    const boxH = paraH(T.fast, F.reg, 11, W - 40, 1.5) + 32;
    s.roundedRect(M, y, W, boxH, 16, { fill: CARD, border: LINE, borderWidth: 0.8 });
    para(s, T.fast, M + 20, y + 16, W - 40, F.reg, 11, INK, 1.5);
  }

  // ── 7 · what success looks like ───────────────────────────────────────────
  successPage(lv);

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

  // ── 9 · just for this kind of Einrichtung ─────────────────────────────────
  {
    const { page, s } = newPage();
    const FT = FACILITY[result.facilityType];
    icon(page, FT.icon, M + W - 56, 72, 56, on(PAPER));
    let y = disp(page, HN, pick(FT.forTitle, lang), M, 70, W - 80, 42, INK, 1.05) + 30;
    FT.tips.forEach((tip, i) => {
      const n = String(i + 1);
      s.roundedRect(M, y, 36, 36, 18, { fill: NIGHT });
      s.text(n, M + 18 - measure(n, F.semi, 13) / 2, y + 11, F.semi, 13, GOLD);
      block(s, pick(tip.t, lang), M + 58, y + 2, 12, GOLD, ON_GOLD, 10, 6);
      const after = para(s, pick(tip.d, lang), M + 58, y + 36, W - 58, F.reg, 12, INK, 1.6);
      y = Math.max(y + 36, after) + 26;
    });
  }

  // ── 10 · 7 reasons nurses leave ───────────────────────────────────────────
  {
    const { page, s } = newPage();
    let y = disp(page, HN, t.reasons, M, 70, W, 40, INK, 1.05);
    y = para(s, t.reasonsSub, M, y + 6, W, F.reg, 12.5, MUTED) + 18;
    const check: IconColors = { base: GREEN, accent: GREEN, hole: PAPER };
    REASONS.forEach((r, i) => {
      s.hline(M, M + W, y, LINE, 0.8);
      const tp = y + 16;
      icon(page, REASON_ICONS[i], M, tp, 30, on(PAPER));
      const a = para(s, pick(r.why, lang), M + 50, tp + 1, W - 50, F.semi, 12.5, INK, 1.35);
      icon(page, "check", M + 50, a + 3, 12, check);
      const b = para(s, pick(r.fix, lang), M + 68, a + 2, W - 68, F.reg, 11.5, GREEN, 1.45);
      y = Math.max(tp + 32, b) + 14;
    });
    s.hline(M, M + W, y, LINE, 0.8);
  }

  // ── 11 · the bottom line ──────────────────────────────────────────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    let y = disp(page, HN, SU.bottom, M, 66, W, 64, GOLD_TEXT, 1.0, -0.03) + 6;
    const lw = W * 0.6;
    y = para(s, pick(STAGES[lv].bottom, lang).toUpperCase(), M, y, lw, F.semi, 16, INK, 1.35) + 22;
    y = para(s, SU.blP1, M, y, lw, F.reg, 12, INK, 1.95) + 16;
    y = para(s, SU.blP2, M, y, lw * 0.85, F.reg, 12, INK, 1.95) + 22;
    para(s, SU.canToo.toUpperCase(), M, y, lw, F.semi, 17, INK, 1.3);
    // the big arrow
    const ax = M + W * 0.66, aw = W * 0.34, at = 230, ah = 330;
    page.drawSvgPath(`M ${aw * 0.32} 0 H ${aw * 0.68} V ${ah * 0.62} H ${aw} L ${aw / 2} ${ah} L 0 ${ah * 0.62} H ${aw * 0.32} Z`, { x: ax, y: PH - at, color: GOLD });
    const bandTop = PH - 200;
    s.rect(0, bandTop, PW, PH - bandTop, GOLD);
    fr.bottom = "gold";
    caps(s, SU.remember, M, bandTop + 36, 16, ON_GOLD);
    para(s, SU.rememberTxt, M, bandTop + 66, W, F.reg, 12.5, ON_GOLD, 1.7);
  }

  // ── 12 · next step, framed as "see if you fit" ────────────────────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    cdisp(page, HN, lv === 5 ? SU.wantStay : SU.wantNext, 70, W - 20, 44, INK, 1.1);
    const split = 470;
    s.rect(0, split, PW, PH - split, NIGHT);
    fr.bottom = "night";
    const bw = (W - 24) / 3;
    const ics: IconName[] = ["nurse", "house", "heart"];
    ics.forEach((ic, i) => {
      const x = M + i * (bw + 12), top = i === 1 ? 268 : 288, h = i === 1 ? 250 : 210;
      s.rect(x, top, bw, h, GOLD);
      icon(page, ic, x + (bw - 78) / 2, top + (h - 78) / 2, 78, { base: ON_GOLD, accent: FG, hole: GOLD });
    });
    let y = cpara(s, `${SU.stuck} ${SU.fitLine}`, PW / 2, 556, W - 40, F.reg, 12, FG, 1.85) + 22;
    const btn = t.book, bw2 = measure(btn, F.semi, 14) + 64, bh = 50;
    s.roundedRect((PW - bw2) / 2, y, bw2, bh, 25, { fill: GOLD });
    s.text(btn, (PW - bw2) / 2 + 32, y + 16, F.semi, 14, ON_GOLD);
    link(page, (PW - bw2) / 2, y, bw2, bh, BOOK_URL);
    y += bh + 16;
    cpara(s, `${t.contact}: contact@borivon.com`, PW / 2, y, W, F.reg, 10, MUTED_NIGHT);
    cpara(s, t.disclaimer, PW / 2, PH - 96, W, F.reg, 7.5, MUTED_NIGHT, 1.5);
  }

  // ── the stage you passed, and the stage that comes next, in full ──────────
  if (lv > 1) {
    const p = (lv - 1) as Level;
    dividerPage(p, SU.gradFrom);
    stagePage(p, sn(p));
    whenPage(p, false);
    areasPages(p);
    successPage(p);
  }
  if (lv < 5) {
    const n = (lv + 1) as Level;
    dividerPage(n, SU.comingNext);
    stagePage(n, sn(n));
    whenPage(n, false);
    areasPages(n);
    successPage(n);
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

/** Linear mix of two hex colours (for the fading tag stack). */
function mixHex(a: string, b: string, k: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * k).toString(16).padStart(2, "0")).join("");
}
