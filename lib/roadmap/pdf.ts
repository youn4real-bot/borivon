/**
 * The personal Pflege-Fahrplan PDF (A4). Drawn with pdf-lib on the same
 * helpers as the B2 report (lib/pdflib/render.ts), so it runs on Workers.
 *
 * Structure (founder 2026-11-08, "transformation, not information"; see lib/roadmap/visual.ts):
 *   cover · 5-level staircase · [watch this first] · before → after · leaky bucket ·
 *   lose vs win (+ calculator) · [the deadline] · checklists to the next level ·
 *   90-day plan · one SOFT last page ("want help? see if it fits"). One picture per
 *   page, few words. No pitch anywhere else: the PDF is a value asset.
 *
 * Design = borivon.com since 2026-11-09 (founder: "screams premium, not AI slop"):
 * warm paper, deep night for the dark pages, one muted gold, hairlines instead of
 * coloured boxes, loss and gain in a quiet terracotta and green. EB Garamond headings
 * (drawn as outlines from the TTF, lib/roadmap/vectorFont.ts), Inter text, the italic
 * "Borivon." wordmark with a gold dot, two-tone pictograms.
 * Words a 5-year-old could follow. Links stay clickable on the website viewer
 * (lib/roadmap/hosted.ts reads them back out).
 */
import { PDFDocument, PageSizes, PDFName, PDFString, type PDFPage, type PDFRef, type RGB } from "pdf-lib";
import { embedFonts, hexColor, Surface, wrapText, measure, type DocFont } from "@/lib/pdflib/render";
import { loadPublicAsset } from "@/lib/pdflib/assets";
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
import { LEVEL_ICON, BEFORE_AFTER, V, beforeAfterFor, leaksFor } from "./visual";

// borivon.com tokens (content/pflege/bv.css :root)
const PAPER = hexColor("#f4f1ea");
const PAPER2 = hexColor("#ebe6db");
const WHITE = hexColor("#fbfaf6");
const INK = hexColor("#15130f");
const INK2 = hexColor("#3b372f");
const MUTED = hexColor("#6b6458");
const LINE = hexColor("#ddd6c8");
const LINE2 = hexColor("#cfc7b7");
const NIGHT = hexColor("#12110e");
const NIGHT2 = hexColor("#1d1b17");
const NIGHT_LINE = hexColor("#2f2c26");
const FG = hexColor("#f4efe4");
const MUTED_NIGHT = hexColor("#a59e90");
const GOLD = hexColor("#a8843a");
const GOLD_D = hexColor("#7a5c20");     // gold that stays readable on paper
const GOLD_L = hexColor("#d4b676");     // gold on night
const WATER = hexColor("#c9ad6e");
const LOSS = hexColor("#9a4a33");
const LOSS_SOFT = hexColor("#e7c9bd");
const GAIN = hexColor("#46684b");

const SERIF = "fonts/EBGaramond-Medium-pdf.ttf"; // Latin-only TTF (public/fonts/*-pdf.ttf, see lib/pdflib/render.ts)
const SERIF_ITALIC = "fonts/EBGaramond-Italic-pdf.ttf";

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
  /** the personal platform link (founder 2026-11-10): adds the gift as the very last page */
  platformUrl?: string;
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
 * [timeline] · checklists · 90 days · one soft last page. The level no longer adds pages.
 */
export function roadmapPageCount(_level: Level, timeline = false, platform = false): number {
  return 8 + (timeline ? 1 : 0) + (VIDEO_INTRO ? 1 : 0) + (platform ? 1 : 0);
}

type Fonts = { reg: DocFont; med: DocFont; semi: DocFont };
type Tone = "paper" | "night";

/** The motto, word for word (German only: it is how Borivon describes itself). */
const MOTTO = "Das Unternehmen Borivon hilft Gesundheitseinrichtungen, Pflegekräfte aus dem Ausland zu gewinnen und zu halten, weil gute Pflege kein Luxus sein darf.";

export async function renderRoadmapPdf(input: RoadmapPdfInput): Promise<Uint8Array> {
  const { result, lang } = input;
  const t = UI[lang];
  const SU = STAGE_UI[lang];
  const VV = V[lang];
  const doc = await PDFDocument.create();
  doc.setTitle(`${t.title} · ${input.facility || "Borivon"}`);
  doc.setAuthor("Borivon");
  doc.setCreator("borivon.com");
  const f = await embedFonts(doc, ["Inter-Regular-pdf.ttf", "Inter-Medium-pdf.ttf", "Inter-SemiBold-pdf.ttf"]);
  const F: Fonts = { reg: f["Inter-Regular-pdf.ttf"], med: f["Inter-Medium-pdf.ttf"], semi: f["Inter-SemiBold-pdf.ttf"] };
  const [H, HN, HI] = await Promise.all([loadVectorFont(SERIF), loadVectorFont(SERIF, 0.008), loadVectorFont(SERIF_ITALIC)]);

  const [PW, PH] = PageSizes.A4;
  const M = 56;
  const W = PW - 2 * M;
  const lv = result.level;
  const loc = lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "de-DE";
  const sn = (n: number) => SU.stageN.replace("{n}", String(n));
  const levelName = (n: Level) => pick(LEVELS[n].name, lang);

  // ── page frame: header + footer are drawn last, over whatever the page did ──
  const frames: { page: PDFPage; s: Surface; top: Tone; bottom: Tone; no: number }[] = [];
  const links = new Map<PDFPage, PDFRef[]>();
  const newPage = (bg: Tone = "paper") => {
    const page = doc.addPage([PW, PH]);
    const s = new Surface(page, PH);
    s.rect(0, 0, PW, PH, bg === "night" ? NIGHT : PAPER);
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
  const disp = (page: PDFPage, vf: VectorFont, text: string, x: number, y: number, width: number, size: number, color: RGB, lh = 1.08, track = -0.018): number => {
    for (const ln of wrapVector(text, vf, size, width, size * track)) { vf.draw(page, PH, ln, x, y, size, color, size * track); y += size * lh; }
    return y;
  };
  const cdisp = (page: PDFPage, vf: VectorFont, text: string, y: number, width: number, size: number, color: RGB, lh = 1.06): number => {
    for (const ln of wrapVector(text, vf, size, width, size * -0.018)) { vf.draw(page, PH, ln, (PW - vf.measure(ln, size, size * -0.018)) / 2, y, size, color, size * -0.018); y += size * lh; }
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
  const caps = (s: Surface, text: string, x: number, y: number, size: number, color: RGB, font = F.med) => s.text(text.toUpperCase(), x, y, font, size, color, size * 0.14);
  const capsW = (text: string, size: number, font = F.med) => measure(text.toUpperCase(), font, size, size * 0.14);
  /** A small label: a dot and spaced capitals (the site's ".lbl"). Returns its bottom. */
  const tag = (s: Surface, text: string, x: number, y: number, size: number, color: RGB) => {
    s.roundedRect(x, y + size * 0.28, size * 0.62, size * 0.62, size * 0.31, { fill: color });
    caps(s, text, x + size * 1.4, y, size, color);
    return y + size * 1.4;
  };
  const icon = (page: PDFPage, name: IconName, x: number, top: number, size: number, c: IconColors) => drawIcon(page, PH, name, x, top, size, c);
  const on = (bg: RGB): IconColors => ({ base: INK, accent: GOLD, hole: bg });
  const wordmark = (page: PDFPage, x: number, top: number, size: number, color: RGB) => {
    HI.draw(page, PH, "Borivon", x, top, size, color);
    H.draw(page, PH, ".", x + HI.measure("Borivon", size), top, size, GOLD);
  };
  /** A thin arrow (the site's "→"): a line and a small open head. */
  const arrow = (page: PDFPage, x: number, cy: number, len: number, color: RGB, w = 1.3) => {
    page.drawSvgPath(`M 0 0 L ${len} 0 M ${len - 4.5} -4.5 L ${len} 0 L ${len - 4.5} 4.5`, { x, y: PH - cy, borderColor: color, borderWidth: w });
  };
  const chevronDown = (page: PDFPage, cx: number, top: number, w: number, color: RGB) => {
    page.drawSvgPath(`M 0 0 L ${w / 2} ${w / 2} L ${w} 0`, { x: cx - w / 2, y: PH - top, borderColor: color, borderWidth: 1.4 });
  };
  /** The site's button: a square-ish block, label + arrow. Returns its width. */
  const button = (page: PDFPage, s: Surface, label: string, x: number, top: number, fill: RGB, ink: RGB, arrowC: RGB, url: string, size = 12.5) => {
    const lw = measure(label, F.semi, size), w = lw + 26 + 18 + 24, h = size * 3.2;
    s.roundedRect(x, top, w, h, 3, { fill });
    s.text(label, x + 24, top + (h - size) / 2 - 0.5, F.semi, size, ink);
    arrow(page, x + 24 + lw + 14, top + h / 2, 16, arrowC);
    link(page, x, top, w, h, url);
    return w;
  };
  const tagLine = `${t.title}  ·  ${sn(lv)}: ${levelName(lv)}`.toUpperCase();

  // ── 1 · cover: night, a big title, their level, the five steps ────────────
  {
    const fr = newPage("night");
    const { page, s } = fr;
    wordmark(page, M, 46, 17, FG);
    const when = input.date.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" });
    s.text(when, PW - M - measure(when, F.reg, 9.5), 52, F.reg, 9.5, MUTED_NIGHT);
    let y = 214;
    if (input.facility) y = para(s, input.facility.toUpperCase(), M, y, W, F.med, 8.5, GOLD_L, 1.5) + 18;
    else y += 18;
    y = disp(page, HN, t.title, M, y, W, 68, FG, 0.98, -0.026) + 10;
    disp(page, HI, `${sn(lv)}: ${levelName(lv)}`, M, y, W, 32, GOLD_L, 1.1, -0.01);
    // the five steps, theirs lit
    const bw = 44, gap = 10, sx = M, base = 664;
    for (let i = 1 as Level; i <= 5; i = (i + 1) as Level) {
      const h = 34 + (i - 1) * 30, x = sx + (i - 1) * (bw + gap), me = i === lv;
      if (me) s.rect(x, base - h, bw, h, GOLD_L);
      else s.roundedRect(x, base - h, bw, h, 0, { border: NIGHT_LINE, borderWidth: 1 });
      const n = String(i);
      s.text(n, x + (bw - measure(n, F.med, 10)) / 2, base + 8, F.med, 10, me ? FG : MUTED_NIGHT);
      if (me) { caps(s, VV.you, x + (bw - capsW(VV.you, 7.5)) / 2, base - h - 26, 7.5, GOLD_L); chevronDown(page, x + bw / 2, base - h - 12, 8, GOLD_L); }
      if (i === 5) break;
    }
    if (input.name) {
      const who = `${t.for} ${input.name}`;
      s.text(who, PW - M - measure(who, F.reg, 11.5), base - 6, F.reg, 11.5, FG);
    }
    s.hline(M, PW - M, PH - 92, NIGHT_LINE, 0.8);
    if (lang === "de") para(s, MOTTO, M, PH - 74, W - 40, F.reg, 8.5, MUTED_NIGHT, 1.55);
    else s.text("borivon.com", M, PH - 74, F.reg, 8.5, MUTED_NIGHT);
  }

  // ── 2 · the 5 levels as a staircase, "you are here" on theirs ─────────────
  {
    const fr = newPage("night");
    const { page, s } = fr;
    cdisp(page, HN, VV.ladderH, 74, W, 54, FG);
    const gap = 8, cw = (W - gap * 4) / 5, base = PH - 104;
    for (let i = 1 as Level; i <= 5; i = (i + 1) as Level) {
      const me = i === lv, h = 196 + (i - 1) * 50, x = M + (i - 1) * (cw + gap), top = base - h;
      if (me) s.rect(x, top, cw, h, PAPER);
      else { s.rect(x, top, cw, h, NIGHT2); s.roundedRect(x, top, cw, h, 0, { border: NIGHT_LINE, borderWidth: 0.8 }); }
      const ink = me ? INK : FG, sub = me ? INK2 : MUTED_NIGHT;
      icon(page, LEVEL_ICON[i], x + (cw - 34) / 2, top + 16, 34, me ? { base: INK, accent: GOLD, hole: PAPER } : { base: FG, accent: GOLD_L, hole: NIGHT2 });
      const num = String(i);
      HN.draw(page, PH, num, x + (cw - HN.measure(num, 34)) / 2, top + 60, 34, me ? GOLD_D : GOLD_L);
      const ty = cpara(s, levelName(i).toUpperCase(), x + cw / 2, top + 106, cw - 8, F.semi, 9.5, ink, 1.3, 1.2) + 6;
      cpara(s, pick(LEVELS[i].line, lang), x + cw / 2, ty, cw - 14, F.reg, 8.6, sub, 1.45);
      if (me) {
        const lbl = VV.you, lw = capsW(lbl, 9);
        caps(s, lbl, x + (cw - lw) / 2, top - 40, 9, GOLD_L);
        chevronDown(page, x + cw / 2, top - 20, 10, GOLD_L);
      }
      if (i === 5) break;
    }
  }

  // ── (optional) watch this first ───────────────────────────────────────────
  if (VIDEO_INTRO) {
    const fr = newPage();
    const { page, s } = fr;
    cdisp(page, HN, SU.watch, 78, W, 52, INK);
    s.roundedRect(PW / 2 - 43, 172, 86, 86, 43, { fill: INK });
    page.drawSvgPath(`M 0 0 L ${86 * 0.34} ${86 * 0.2} L 0 ${86 * 0.4} Z`, { x: PW / 2 - 86 * 0.12, y: PH - (172 + 86 * 0.3), color: GOLD_L });
    link(page, PW / 2 - 43, 172, 86, 86, VIDEO_INTRO);
    s.rect(0, 330, PW, PH - 330, NIGHT);
    fr.bottom = "night";
    cdisp(page, H, SU.watchLead, 450, W - 40, 28, FG, 1.2);
  }

  // ── 3 · before → after (their level → the next) ───────────────────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    let y = disp(page, HN, VV.baH, M, 74, W, 50, INK, 1.02) + 26;
    const cw = (W - 44) / 2, rx = M + cw + 44;
    const nxt = lv < 5 ? (lv + 1) as Level : 5;
    tag(s, `${VV.today} · ${VV.nextOf5.replace("{n}", String(lv))}`, M, y, 8.5, LOSS);
    tag(s, lv < 5 ? `${VV.withPlan} · ${VV.nextOf5.replace("{n}", String(nxt))}` : SU.successA, rx, y, 8.5, GAIN);
    y += 26;
    s.hline(M, M + W, y, LINE2, 0.8);
    const rh = 88;
    const mineBA = input.form ? beforeAfterFor(input.form, input.date) : [];
    // only their own pains (founder: always relevant); old leads without the form get the level rows
    const rows = input.form ? mineBA : BEFORE_AFTER[lv];
    for (const r of rows) {
      icon(page, r.ic, M, y + (rh - 34) / 2, 34, { base: LOSS, accent: LOSS_SOFT, hole: PAPER });
      const bt = pick(r.b, lang), bh = paraH(bt, F.med, 12, cw - 50, 1.4);
      para(s, bt, M + 50, y + (rh - bh) / 2 + 2, cw - 50, F.med, 12, INK2, 1.4);
      arrow(page, M + cw + 12, y + rh / 2, 20, LINE2);
      icon(page, r.ic, rx, y + (rh - 34) / 2, 34, { base: GAIN, accent: GOLD, hole: PAPER });
      const at = pick(r.a, lang), ah = paraH(at, F.semi, 12.5, cw - 50, 1.35);
      para(s, at, rx + 50, y + (rh - ah) / 2 + 2, cw - 50, F.semi, 12.5, INK, 1.35);
      y += rh;
      s.hline(M, M + W, y, LINE, 0.8);
    }
    // the one-line goal on a night band
    const bandTop = PH - 196;
    s.rect(0, bandTop, PW, PH - bandTop, NIGHT);
    fr.bottom = "night";
    icon(page, "up", M, bandTop + 42, 40, { base: GOLD_L, accent: GOLD_L, hole: NIGHT });
    disp(page, H, pick(CLIMB[lv].goal, lang), M + 62, bandTop + 44, W - 62, 25, FG, 1.16, -0.012);
  }

  // ── 4 · the leaky bucket (one picture, one lesson) ────────────────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    cdisp(page, HN, VV.bucketH, 74, W, 50, INK);
    const cx = PW / 2;
    cpara(s, VV.bucketIn.toUpperCase(), cx, 136, W, F.med, 8.5, GOLD_D, 1.3, 1.2);
    for (let k = -1; k <= 1; k++) icon(page, "nurse", cx + k * 54 - 19, 154, 38, on(PAPER));
    chevronDown(page, cx, 204, 14, GOLD);
    const bt = 278, bw = 250, bh = 214;
    page.drawSvgPath(`M 0 12 C 0 -80 ${bw} -80 ${bw} 12`, { x: cx - bw / 2, y: PH - bt, borderColor: INK, borderWidth: 3 });
    page.drawSvgPath(`M 0 0 L ${bw} 0 L ${bw - 36} ${bh} L 36 ${bh} Z`, { x: cx - bw / 2, y: PH - bt, color: INK });
    page.drawSvgPath(`M 16 54 L ${bw - 16} 54 L ${bw - 46} ${bh - 12} L 46 ${bh - 12} Z`, { x: cx - bw / 2, y: PH - bt, color: WATER });
    s.roundedRect(cx - bw / 2 - 10, bt - 7, bw + 20, 12, 3, { fill: INK });
    const mine = input.form ? leaksFor(input.form, input.date).map((l) => pick(l, lang)) : VV.bucketOut;
    // nothing specific ticked: waiting (posts stay empty) is true for everyone who needs nurses
    const leaks = mine.length ? mine : [VV.bucketOut[1]];
    const ks = leaks.length === 1 ? [0] : leaks.length === 2 ? [-0.6, 0.6] : [-1, 0, 1];
    ks.forEach((k, i) => {
      const hx = cx + k * 60, hy = bt + bh, lx = cx + k * 140;
      for (let d = 0; d < 2; d++) page.drawSvgPath("M 7 0 C 7 0 14 10 14 15 A 7 7 0 0 1 0 15 C 0 10 7 0 7 0 Z", { x: hx + (lx - hx) * (d + 1) / 3 - 7, y: PH - (hy + 8 + d * 22), color: LOSS });
      cpara(s, leaks[i].toUpperCase(), lx, hy + 66, 130, F.semi, 9.5, LOSS, 1.3, 1);
    });
    cpara(s, VV.bucketLine, cx, bt + bh + 106, W - 40, F.reg, 13.5, INK2, 1.5);
    const bandTop = PH - 170;
    s.rect(0, bandTop, PW, PH - bandTop, NIGHT);
    fr.bottom = "night";
    cdisp(page, HI, VV.bucketFix, bandTop + 46, W, 32, GOLD_L, 1.1);
  }

  // ── 6 · your numbers + the calculator ─────────────────────────────────────
  {
    const fr = newPage();
    const { page, s } = fr;
    let y = disp(page, HN, t.numbers, M, 74, W, 50, INK, 1.02) + 22;
    // lose vs win, side by side: the two numbers that matter
    {
      const cw = (W - 14) / 2, ch = 136;
      const card = (x: number, label: string, big: string, sub: string, color: RGB) => {
        s.roundedRect(x, y, cw, ch, 6, { fill: WHITE, border: LINE, borderWidth: 0.8 });
        tag(s, label, x + 20, y + 20, 8, color);
        let sz = 34;
        while (sz > 20 && HN.measure(big, sz) > cw - 40) sz -= 1;
        HN.draw(page, PH, big, x + 20, y + 46, sz, color);
        para(s, sub, x + 20, y + 94, cw - 40, F.reg, 10, MUTED, 1.45);
      };
      card(M, SU.loseLbl, `−${formatEuro(result.totalYear, lang)}`, result.turnoverCostYear > 0 ? SU.loseSub : SU.loseSubOpen, LOSS);
      card(M + cw + 14, SU.winLbl, `+${formatEuro(result.perNurseMonth * 12, lang)}`, SU.winSub, GAIN);
      y += ch + 26;
    }
    caps(s, SU.whereFrom, M, y, 7.5, MUTED);
    y += 16;
    const row = (ic: IconName, label: string, big: string, small: string, color: RGB) => {
      const rh = 72;
      s.hline(M, M + W, y, LINE, 0.8);
      icon(page, ic, M + 2, y + 19, 34, on(PAPER));
      s.text(label, M + 54, y + 14, F.reg, 10, MUTED);
      HN.draw(page, PH, big, M + 54, y + 30, 25, color);
      if (small) s.text(small, PW - M - measure(small, F.reg, 10), y + 40, F.reg, 10, MUTED);
      y += rh;
    };
    row("bed", t.openPosts, `−${formatEuro(result.openCostMonth, lang)} ${t.perMonth}`, `−${formatEuro(result.openCostYear, lang)} ${t.perYear}`, LOSS);
    if (result.turnoverCostYear > 0) row("door", t.leaving, `−${formatEuro(result.turnoverCostYear, lang)} ${t.perYear}`, "", LOSS);
    s.hline(M, M + W, y, LINE, 0.8);
    y += 18;
    caps(s, t.howCounted, M, y, 7.5, MUTED);
    y += 18;
    const FT = FACILITY[result.facilityType];
    const lines: [IconName, string][] = [];
    if (input.form) lines.push(["bed", BEDARF_LINE[lang](input.form)]);
    lines.push([FT.icon, pick(result.usesAgency ? FT.openModel : FT.openModelNoAgency, lang)]);
    if (result.turnoverCostYear > 0) lines.push(["door", leaveModel(result.facilityType, lang, (n) => formatEuro(n, lang), result.perNurseMonth, costPerDeparture(result.facilityType))]);
    lines.push(["target", pick(FT.source, lang)]);
    for (const [ic, txt] of lines) {
      icon(page, ic, M, y - 1, 15, on(PAPER));
      y = para(s, txt, M + 26, y, W - 26, F.reg, 9.3, MUTED, 1.5) + 7;
    }
    // the calculator band (like acquisition.com's "Got it? Let's start" bar)
    const bandTop = Math.max(y + 16, PH - 218);
    s.rect(0, bandTop, PW, PH - bandTop, NIGHT);
    fr.bottom = "night";
    const cl = calcLinkFor(input, lang, result);
    let by = disp(page, H, SU.calcH, M, bandTop + 28, W, 25, FG, 1.1, -0.012);
    by = para(s, t.ownNumbers, M, by + 6, W, F.reg, 10.5, MUTED_NIGHT, 1.5) + 14;
    button(page, s, t.calcBtn, M, by, PAPER, INK, GOLD_D, cl, 12);
  }

  // ── 6b · the personal deadline (only with the v2 form) ────────────────────
  if (input.form) {
    const T = TL[lang];
    const form = input.form;
    const tl = buildTimeline(form, input.date);
    const long = (d: Date) => d.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const short = (d: Date) => d.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: "UTC" });
    const fill = (str: string) => str.replace("{date}", tl.target ? long(tl.target) : "").replace("{start}", tl.latestStart ? long(tl.latestStart) : "")
      .replace("{weeks}", String(Math.max(0, tl.weeksLeft ?? 0))).replace("{first}", long(tl.earliestFirstDay))
      .replace("{m}", form.start === "12m" ? "12" : "6");
    const approx = form.start === "6m" || form.start === "12m";
    const { page, s } = newPage();
    icon(page, "calendar", M + W - 50, 76, 50, on(PAPER));
    let y = disp(page, HN, T.h, M, 74, W - 80, 50, INK, 1.02);
    y = para(s, T.sub, M, y + 8, W - 80, F.reg, 11.5, MUTED) + 22;
    const [lead, big, color] = tl.status === "asap" ? [T.asap, T.asapBig, GOLD_D]
      : tl.status === "late" ? [approx ? T.lateIn : T.late, T.lateBig, LOSS]
      : [approx ? T.okIn : T.ok, T.okBig, tl.status === "tight" ? LOSS : GOLD_D];
    y = para(s, fill(lead), M, y, W, F.semi, 12.5, INK, 1.5) + 8;
    y = disp(page, HN, fill(big), M, y, W, 38, color, 1.06) + 6;
    if (tl.status === "tight") y = para(s, T.tight, M, y, W, F.reg, 10.5, MUTED, 1.5) + 4;
    y += 22;
    // the steps, top to bottom, with dates
    const lx = M + 84, tx = M + 106, rowH = 46;
    const n = tl.steps.length;
    s.rect(lx - 0.6, y + 6, 1.2, rowH * n, LINE2);
    tl.steps.forEach((st, i) => {
      const yy = y + i * rowH;
      s.text(short(st.from), M, yy + 2, F.med, 10, MUTED);
      s.roundedRect(lx - 5, yy + 2, 10, 10, 5, { fill: GOLD });
      s.text(pick(STEP_NAME[st.key], lang), tx, yy, F.semi, 12, INK);
      s.text(`${st.weeks} ${st.weeks === 1 ? T.week : T.weeks}`, tx, yy + 17, F.reg, 10, MUTED);
    });
    const fy = y + n * rowH;
    const last = tl.steps[n - 1].to;
    s.text(short(last), M, fy + 4, F.semi, 10, INK);
    s.roundedRect(lx - 10, fy - 2, 20, 20, 10, { fill: NIGHT });
    icon(page, "check", lx - 6, fy + 2, 12, { base: GOLD_L, accent: GOLD_L, hole: NIGHT });
    disp(page, H, long(last), tx, fy - 4, W - 106, 22, INK, 1.1);
  }

  // ── 8 · checklists to the next level (2 × 2 cards, tick boxes) ────────────
  {
    const { page, s } = newPage();
    const head = lv < 5 ? VV.stepsH.replace("{n}", String(lv + 1)) : VV.stayH;
    let y = disp(page, HN, head, M, 74, W, 46, INK, 1.04);
    y = para(s, VV.stepsSub, M, y + 8, W, F.reg, 12.5, MUTED) + 24;
    const blocks = PLAYBOOK[lv].success, ics: IconName[] = ["target", "team", "calendar", "heart"];
    const cw = (W - 16) / 2, iw = cw - 60;
    // title can wrap ("Wissen, warum Leute gehen"): the list starts under the title, wherever it ends
    const titleH = (b: (typeof blocks)[number]) => paraH(pick(b.t, lang), F.semi, 14.5, cw - 40, 1.25);
    const cardH = (b: (typeof blocks)[number]) => 74 + titleH(b) + 16 + b.items.reduce((h, it) => h + paraH(pick(it, lang), F.reg, 12, iw, 1.42) + 12, 0) + 12;
    for (let r = 0; r < blocks.length; r += 2) {
      const pair = blocks.slice(r, r + 2), rh = Math.max(...pair.map(cardH));
      pair.forEach((b, j) => {
        const x = M + j * (cw + 16);
        s.roundedRect(x, y, cw, rh, 6, { fill: WHITE, border: LINE, borderWidth: 0.8 });
        icon(page, ics[r + j], x + 20, y + 20, 36, on(WHITE));
        const n = String(r + j + 1).padStart(2, "0");
        s.text(n, x + cw - 20 - measure(n, F.med, 9, 1), y + 24, F.med, 9, GOLD_D, 1);
        const tEnd = para(s, pick(b.t, lang), x + 20, y + 74, cw - 40, F.semi, 14.5, INK, 1.25);
        let iy = tEnd + 16;
        for (const it of b.items) {
          s.roundedRect(x + 22, iy + 1.5, 12, 12, 2, { border: GOLD_D, borderWidth: 1 });
          iy = para(s, pick(it, lang), x + 46, iy, iw, F.reg, 12, INK, 1.42) + 12;
        }
      });
      y += rh + 16;
    }
  }

  // ── 8 · the 90-day plan ───────────────────────────────────────────────────
  {
    const { page, s } = newPage();
    icon(page, "calendar", M + W - 50, 76, 50, on(PAPER));
    let y = disp(page, HN, t.plan90, M, 74, W - 80, 48, INK, 1.02);
    y = para(s, t.plan90sub, M, y + 10, W - 80, F.reg, 12, MUTED) + 24;
    const gw = (W - 16) / 2, iw = gw - 62;
    const cardH = (b: (typeof PLAN_90)[number]) => 22 + 14 + 22 + b.items.reduce((p, it) => p + paraH(pick(it, lang), F.reg, 11.3, iw, 1.45) + 9, 0) + 12;
    for (let r = 0; r < PLAN_90.length; r += 2) {
      const pair = PLAN_90.slice(r, r + 2);
      const rh = Math.max(...pair.map(cardH));
      pair.forEach((b, j) => {
        const x = M + j * (gw + 16);
        s.roundedRect(x, y, gw, rh, 6, { fill: WHITE, border: LINE, borderWidth: 0.8 });
        tag(s, pick(b.when, lang), x + 20, y + 20, 8, GOLD_D);
        s.hline(x + 20, x + gw - 20, y + 40, LINE, 0.6);
        let iy = y + 22 + 14 + 22;
        for (const it of b.items) {
          s.roundedRect(x + 22, iy + 1.5, 11, 11, 2, { border: MUTED, borderWidth: 0.9 });
          iy = para(s, pick(it, lang), x + 46, iy, iw, F.reg, 11.3, INK, 1.45) + 9;
        }
      });
      y += rh + 16;
    }
  }

  // ── last page: soft, like acquisition.com's "Do you want to scale?" (no hard selling) ──
  {
    const fr = newPage();
    const { page, s } = fr;
    cdisp(page, HN, lv < 5 ? VV.softH.replace("{n}", String(lv + 1)) : VV.softHTop, 92, W - 20, 52, INK, 1.06);
    // the three things, side by side, between hairlines
    const top = 236, colW = W / 3, ics: IconName[] = ["calendar", "nurse", "team"];
    s.hline(M, M + W, top, LINE2, 0.8);
    s.hline(M, M + W, top + 168, LINE2, 0.8);
    ics.forEach((ic, i) => {
      const x = M + i * colW;
      if (i > 0) s.rect(x - 0.4, top + 24, 0.8, 120, LINE);
      icon(page, ic, x + (colW - 54) / 2, top + 30, 54, on(PAPER));
      cpara(s, VV.softTags[i].toUpperCase(), x + colW / 2, top + 106, colW - 24, F.semi, 8.5, INK, 1.35, 1.1);
    });
    const split = 470;
    s.rect(0, split, PW, PH - split, NIGHT);
    fr.bottom = "night";
    let y = cpara(s, VV.softP, PW / 2, split + 78, W - 60, F.reg, 11.5, FG, 1.85) + 26;
    const btn = VV.softBtn, bw = measure(btn, F.semi, 13) + 26 + 18 + 24;
    button(page, s, btn, (PW - bw) / 2, y, PAPER, INK, GOLD_D, "https://borivon.com/workshop?via=pdf", 13);
    y += 13 * 3.2 + 20;
    cpara(s, `${t.contact}: contact@borivon.com`, PW / 2, y, W, F.reg, 9.5, MUTED_NIGHT);
  }

  // ── the gift: the platform, behind the personal link (founder 2026-11-10: "they have to read to the end") ──
  if (input.platformUrl) {
    const fr = newPage("night");
    const { page, s } = fr;
    let y = tag(s, VV.giftTag.toUpperCase(), M, 100, 8.5, GOLD_L) + 14;
    y = disp(page, HN, VV.giftH, M, y, W - 30, 46, FG, 1.02, -0.024) + 14;
    y = para(s, VV.giftP, M, y, W - 40, F.reg, 11.5, MUTED_NIGHT, 1.7) + 24;
    // a picture of the product (true to the portal): the facility's nurses with their progress, and one
    // nurse's documents — the thing they will see after the click
    const cy = y, ch = 214, half = (W - 24) / 2;
    s.roundedRect(M, cy, W, ch, 6, { fill: PAPER });
    const lx = M + 18, lw = half - 6;
    const stageLbl = lang === "de" ? ["Visum da", "Anerkennung", "Unterlagen"] : lang === "fr" ? ["Visa reçu", "Reconnaissance", "Documents"] : ["Visa granted", "Recognition", "Documents"];
    const prog = [0.86, 0.55, 0.24];
    // the same example people as on borivon.com/plattform (Symbolbilder, public/pflege/assets/pf, founder 2026-11-11: real faces)
    const people = [{ n: 1, name: "Amina E." }, { n: 3, name: "Youssef B." }, { n: 2, name: "Salma O." }];
    const faces = await Promise.all(people.map((p) => loadPublicAsset(`pflege/assets/pf/av-${p.n}-r.png`).then((b) => doc.embedPng(b)).catch(() => null)));
    for (let i = 0; i < 3; i++) {
      const ry = cy + 22 + i * 62;
      const face = faces[i];
      if (face) page.drawImage(face, { x: lx, y: PH - (ry + 30), width: 30, height: 30 });
      else page.drawCircle({ x: lx + 15, y: PH - (ry + 15), size: 15, color: PAPER2, borderColor: LINE2, borderWidth: 0.6 });
      s.text(people[i].name, lx + 42, ry + 2, F.med, 10, INK);
      s.text(stageLbl[i], lx + 42, ry + 17, F.med, 8, i === 0 ? GAIN : GOLD_D);
      s.rect(lx + 42, ry + 31, lw - 52, 2.2, PAPER2);
      s.rect(lx + 42, ry + 31, (lw - 52) * prog[i], 2.2, GOLD);
      if (i < 2) s.hline(lx, lx + lw - 10, ry + 46, LINE, 0.6);
    }
    // one nurse's documents
    const sx = M + half + 18, sw = W - half - 36;
    s.roundedRect(sx - 6, cy + 14, sw + 6, ch - 28, 4, { fill: WHITE });
    const docs = lang === "de" ? ["Reisepass", "Lebenslauf", "Pflegediplom", "Sprachzertifikat B2"] : lang === "fr" ? ["Passeport", "CV", "Diplôme infirmier", "Certificat de langue B2"] : ["Passport", "CV", "Nursing diploma", "Language certificate B2"];
    let dy = cy + 34;
    docs.forEach((d, i) => {
      const done = i < 2, ccx = sx + 12, ccy = dy + 6;
      if (done) {
        page.drawCircle({ x: ccx, y: PH - ccy, size: 7.5, color: INK });
        page.drawSvgPath("M -3 0.2 L -0.9 2.4 L 3.2 -2.2", { x: ccx, y: PH - ccy, borderColor: PAPER, borderWidth: 1.2 });
      } else {
        page.drawCircle({ x: ccx, y: PH - ccy, size: 7.5, color: WHITE, borderColor: LINE2, borderWidth: 0.8 });
      }
      s.text(d, sx + 28, dy + 1, F.med, 9.5, done ? MUTED : INK);
      if (i < docs.length - 1) s.hline(sx + 28, sx + sw - 12, dy + 26, LINE, 0.6);
      dy += 40;
    });
    y = cy + ch + 26;
    // three plain promises, numbered, between hairlines
    s.hline(M, M + W, y, NIGHT_LINE, 0.8);
    const cw = W / 3;
    VV.giftItems.forEach((it, i) => {
      const x = M + i * cw;
      s.text(String(i + 1).padStart(2, "0"), x, y + 16, F.med, 8.5, GOLD_L, 0.8);
      para(s, it, x, y + 32, cw - 18, F.reg, 10, FG, 1.45);
    });
    y += 74;
    s.hline(M, M + W, y, NIGHT_LINE, 0.8);
    y += 26;
    const btn = VV.giftBtn, bw = measure(btn, F.semi, 13) + 26 + 18 + 24;
    button(page, s, btn, (PW - bw) / 2, y, PAPER, INK, GOLD_D, input.platformUrl, 13);
    cpara(s, VV.giftNote, PW / 2, y + 13 * 3.2 + 14, W, F.reg, 9, MUTED_NIGHT);
  }

  // ── header + footer on every page but the cover; then the links ───────────
  for (const fr of frames) {
    const { page, s, top, bottom, no } = fr;
    if (no > 1) {
      const hc = top === "night" ? MUTED_NIGHT : MUTED;
      s.text(tagLine, M, 30, F.med, 6.5, hc, 0.9);
      const r = SU.personalShort.toUpperCase();
      s.text(r, PW - M - measure(r, F.reg, 6.5, 0.9), 30, F.reg, 6.5, hc, 0.9);
      const fc = bottom === "paper" ? INK : FG;
      s.hline(M, M + W, PH - 54, bottom === "paper" ? LINE : NIGHT_LINE, 0.8);
      wordmark(page, M, PH - 44, 12, fc);
      const pn = String(no).padStart(2, "0");
      s.text(pn, PW - M - measure(pn, F.med, 8.5, 0.6), PH - 41, F.med, 8.5, bottom === "paper" ? MUTED : MUTED_NIGHT, 0.6);
    }
    const refs = links.get(page);
    if (refs?.length) page.node.set(PDFName.of("Annots"), doc.context.obj(refs));
  }
  void PAPER2;
  return doc.save();
}

/** The calculator link: the personal one when given, else a generic one. */
function calcLinkFor(input: RoadmapPdfInput, lang: Lang, result: RoadmapResult): string {
  return input.calcUrl || `https://borivon.com/fahrplan/rechner?lang=${lang}&f=${result.facilityType}`;
}
