/**
 * Simple two-tone pictograms for the Fahrplan PDF (founder: "drawings simple
 * like the ones Hormozi uses"). Hand-drawn on a 48×48 grid as SVG paths and
 * painted with pdf-lib's drawSvgPath, so they stay sharp at any size, need no
 * image files and work on Workers.
 *
 * Every shape has a tone: "base" (main colour), "accent" (gold), or "hole"
 * (the background colour, used to cut gaps and draw white details). The caller
 * passes the three colours, so one icon works on white paper and on navy.
 */
import { LineCapStyle, type PDFPage, type RGB } from "pdf-lib";

type Tone = "base" | "accent" | "hole";
type Shape = { d: string; tone: Tone; stroke?: number; cap?: "round" | "butt" };

const rr = (x: number, y: number, w: number, h: number, r: number) => {
  const q = Math.min(r, w / 2, h / 2);
  return `M ${x + q} ${y} H ${x + w - q} A ${q} ${q} 0 0 1 ${x + w} ${y + q} V ${y + h - q} A ${q} ${q} 0 0 1 ${x + w - q} ${y + h} H ${x + q} A ${q} ${q} 0 0 1 ${x} ${y + h - q} V ${y + q} A ${q} ${q} 0 0 1 ${x + q} ${y} Z`;
};
const circle = (cx: number, cy: number, r: number) =>
  `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
const person = (cx: number, top: number, s: number) =>
  // shoulders: a soft dome from (cx-s, bottom) to (cx+s, bottom)
  `M ${cx - s} ${top + s * 1.25} C ${cx - s} ${top + s * 0.4} ${cx - s * 0.55} ${top} ${cx} ${top} C ${cx + s * 0.55} ${top} ${cx + s} ${top + s * 0.4} ${cx + s} ${top + s * 1.25} Z`;

const b = (d: string): Shape => ({ d, tone: "base" });
const a = (d: string): Shape => ({ d, tone: "accent" });
const h = (d: string): Shape => ({ d, tone: "hole" });
const line = (d: string, tone: Tone, w: number, cap: "round" | "butt" = "round"): Shape => ({ d, tone, stroke: w, cap });

export const ICONS = {
  /** an empty bed: open posts */
  bed: [b(rr(4, 12, 6, 29, 2)), b(rr(4, 31, 40, 7, 2)), b(rr(6, 37, 4, 6, 1.5)), b(rr(38, 37, 4, 6, 1.5)), b(rr(10, 25, 34, 7, 2.5)), a(rr(12, 19, 12, 8, 3.5))],
  /** a door and an arrow out: people leaving */
  door: [b(rr(5, 5, 23, 38, 3)), h(circle(22, 25, 2.3)), line("M 31 24 H 44", "accent", 4.5), line("M 38 17 L 45 24 L 38 31", "accent", 4.5)],
  /** a banknote: money / agency costs */
  money: [b(rr(3, 11, 42, 26, 4.5)), h(circle(24, 24, 8)), a(circle(24, 24, 5.5)), h(circle(9.5, 17.5, 2)), h(circle(38.5, 30.5, 2))],
  /** a nurse with a cross */
  nurse: [b(circle(24, 12, 8)), b(person(24, 24, 16)), a(rr(22, 30, 4, 11, 1)), a(rr(18.5, 33.5, 11, 4, 1))],
  /** a small team */
  team: [a(circle(10, 17, 5.5)), a(person(10, 27, 10)), a(circle(38, 17, 5.5)), a(person(38, 27, 10)), h(circle(24, 13, 9)), h(person(24, 23.5, 15)), b(circle(24, 13, 7)), b(person(24, 25.5, 13))],
  /** a page with a check: papers done */
  papers: [b(rr(7, 3, 28, 39, 3.5)), h(rr(12, 11, 18, 3, 1.5)), h(rr(12, 18, 18, 3, 1.5)), h(rr(12, 25, 11, 3, 1.5)), h(circle(36, 36, 11.5)), a(circle(36, 36, 9.5)), line("M 31.5 36 L 34.8 39.3 L 40.5 33", "hole", 3)],
  /** two speech bubbles: German, talking */
  speech: [b(rr(2, 5, 30, 21, 6.5)), b("M 8 23 L 6 32 L 16 25 Z"), h(rr(15.5, 18.5, 31, 22, 7.5)), a(rr(17, 20, 28, 19, 6.5)), a("M 39 37 L 42.5 45 L 33 38 Z"), h(circle(25, 29.5, 1.9)), h(circle(31, 29.5, 1.9)), h(circle(37, 29.5, 1.9))],
  /** a house: settling in */
  house: [a("M 3 23 L 24 5 L 45 23 Z"), b(rr(9, 21, 30, 23, 2.5)), a(rr(20, 30, 8, 14, 1.5)), h(rr(31, 26, 5, 5, 1))],
  /** a calendar with a check: the 90-day plan */
  calendar: [b(rr(5, 9, 38, 35, 5)), a("M 5 20 V 14 A 5 5 0 0 1 10 9 H 38 A 5 5 0 0 1 43 14 V 20 Z"), b(rr(12.5, 3.5, 4.5, 11, 2.25)), b(rr(31, 3.5, 4.5, 11, 2.25)), line("M 15 31 L 21 37 L 33 26", "accent", 4)],
  /** stairs with a flag: the 5 levels */
  stairs: [b("M 3 45 V 37 H 12 V 29 H 21 V 21 H 30 V 13 H 45 V 45 Z"), a(rr(37, 1, 2.6, 13, 1.2)), a("M 39.4 1.5 L 47 4.8 L 39.4 8.1 Z")],
  /** a target: the bottleneck / goal */
  target: [b(circle(22, 26, 19)), h(circle(22, 26, 13)), b(circle(22, 26, 8)), a(circle(22, 26, 4)), line("M 23 25 L 40 8", "accent", 3.5), line("M 34.5 7.5 L 40.5 7.5 L 40.5 13.5", "accent", 3.5)],
  /** a warning sign: the trap */
  warning: [a("M 24 4 L 46 42 H 2 Z"), b(rr(21.8, 16, 4.4, 14, 2.2)), b(circle(24, 35.5, 2.6))],
  /** a heart: staying */
  heart: [a("M 24 42 C 10 32 4 24.5 4 16.5 C 4 10 9 5.5 15 5.5 C 19 5.5 22 7.5 24 10.5 C 26 7.5 29 5.5 33 5.5 C 39 5.5 44 10 44 16.5 C 44 24.5 38 32 24 42 Z"), line("M 10.5 16 C 10.5 12.5 12.5 11 15 11", "hole", 2.6)],
  /** a magnet: level 5 */
  magnet: [line("M 14 8 V 24 A 10 10 0 0 0 34 24 V 8", "base", 9, "butt"), a(rr(9.5, 2, 9, 8, 1)), a(rr(29.5, 2, 9, 8, 1)), line("M 6 39 L 2.5 42.5", "accent", 2.5), line("M 42 39 L 45.5 42.5", "accent", 2.5), line("M 24 42 V 46", "accent", 2.5)],
  /** a filled check: done */
  check: [b(circle(24, 24, 22)), line("M 14 24.5 L 21 31.5 L 34 18", "hole", 5)],
  /** an arrow up: the next level */
  up: [a(circle(24, 24, 22)), line("M 24 34 V 15", "hole", 5), line("M 15 23 L 24 14 L 33 23", "hole", 5)],
  /** an adult and a child: family */
  family: [b(circle(18, 13, 7.5)), b(person(18, 25, 15)), h(circle(36, 24, 6.8)), h(person(36, 31, 10.5)), a(circle(36, 24, 5)), a(person(36, 33, 8.5))],
  /** a star: her skills */
  star: [b(circle(24, 25, 21)), a("M 24 10 L 27.78 19.8 L 38.27 20.36 L 30.11 26.99 L 32.82 37.14 L 24 31.43 L 15.18 37.14 L 17.89 26.99 L 9.73 20.36 L 20.22 19.8 Z")],
  /** a chat bubble: somebody listens */
  chat: [b(rr(4, 6, 40, 29, 8.5)), b("M 12 33 L 10 43 L 22 34 Z"), a(circle(15, 20.5, 3)), a(circle(24, 20.5, 3)), a(circle(33, 20.5, 3))],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export type IconColors = { base: RGB; accent: RGB; hole: RGB };

/** Draw icon `name` with its top-left at (x, top) in TOP-origin page space. */
export function drawIcon(page: PDFPage, pageHeight: number, name: IconName, x: number, top: number, size: number, c: IconColors): void {
  const scale = size / 48;
  for (const s of ICONS[name] as Shape[]) {
    const color = c[s.tone];
    if (s.stroke) {
      page.drawSvgPath(s.d, {
        x, y: pageHeight - top, scale,
        borderColor: color, borderWidth: s.stroke,
        borderLineCap: s.cap === "butt" ? LineCapStyle.Butt : LineCapStyle.Round,
      });
    } else {
      page.drawSvgPath(s.d, { x, y: pageHeight - top, scale, color });
    }
  }
}
