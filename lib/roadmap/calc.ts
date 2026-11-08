/**
 * The Fahrplan calculator (content/pflege/rechner.html, behind the button on
 * PDF page 4): its personal link and the numbers it may save.
 */
import type { FacilityType } from "./score";
import type { Lang } from "./content";
import { signLeadToken } from "./token";

export const CALC_PATH = "https://borivon.com/fahrplan/rechner";

/** Pflegemindestlohn Fachkraft 21,03 €/h (07/2026) × 40 h × 52/12 × 1,21 employer share. Same start as the page. */
export const MIN_SALARY_MONTH = 4411;

/** The link printed on PDF page 4: their numbers prefilled; id+t only when the lead exists. */
export async function calcUrl(o: { lang: Lang; facilityType: FacilityType; openPosts: number; leftLastYear: number; leadId?: string }): Promise<string> {
  const p = new URLSearchParams({ lang: o.lang, f: o.facilityType, o: String(o.openPosts), l: String(o.leftLastYear) });
  if (o.leadId) { p.set("id", o.leadId); p.set("t", await signLeadToken("calc", o.leadId)); }
  return `${CALC_PATH}?${p.toString()}`;
}

const LIMITS = { open: [0, 60], left: [0, 60], salary: [0, 20000], agency: [0, 50000], units: [0, 20], perUnit: [0, 50000], growth: [0, 100] } as const;
export type CalcValues = { -readonly [K in keyof typeof LIMITS]?: number };

/** Only known keys, only finite numbers, clamped. Anything else is dropped. */
export function cleanCalc(v: unknown): CalcValues {
  const src = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out: CalcValues = {};
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const n = Number(src[k]);
    if (typeof src[k] === "number" && Number.isFinite(n)) out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Math.round(n * 10) / 10));
  }
  return out;
}
