/**
 * Two small records per nurse that the way (lib/facility/way.ts) needs beyond documents and checklists
 * (founder 2026-11-11: "the language card detailed like the CV builder"; "Vertrag … Kenntnisprüfung →
 * Berufsurkunde").
 *   fx_lang  – her German: certified level (A1…B2), the four B2 modules (passed / redo / waiting for the
 *              result), the exam date, the provider (Goethe, telc Pflege, ÖSD, ECL), her school, and the
 *              path "arrives with B1, finishes B2 in Germany". Goal is B2; there is no C1.
 *   fx_marks – contract signed (date), Kenntnisprüfung date + result, Berufsurkunde received (date).
 * Results and milestones are set by her facility or Borivon; she may set her own exam date, provider and
 * school (app/api/portal/lang, app/api/portal/marks).
 */
import { clean, cleanDate } from "./db";

export const LEVELS = ["A1", "A2", "B1", "B2"] as const;
export type Level = (typeof LEVELS)[number] | "";
export const MODULES = ["lesen", "hoeren", "schreiben", "sprechen"] as const;
export type Module = (typeof MODULES)[number];
/** passed ✓ (green) · redo ✗ (red) · waiting for the result (orange) · "" = not sat yet (LAW #4) */
export type ModState = "passed" | "failed" | "pending" | "";
export const PROVIDERS = ["goethe", "telc", "oesd", "ecl"] as const;
export type Provider = (typeof PROVIDERS)[number] | "";

export type LangInfo = {
  level: Level;
  modules: Record<Module, ModState>;
  exam_date: string;
  provider: Provider;
  school: string;
  /** "b1_de" = arrives with B1, finishes B2 in Germany */
  path: "" | "b1_de";
};
export type Marks = { contract: string; kp_date: string; kp_result: "" | "passed" | "failed"; urkunde: string };

export const EMPTY_LANG: LangInfo = { level: "", modules: { lesen: "", hoeren: "", schreiben: "", sprechen: "" }, exam_date: "", provider: "", school: "", path: "" };
export const EMPTY_MARKS: Marks = { contract: "", kp_date: "", kp_result: "", urkunde: "" };

const MOD_STATES: ModState[] = ["passed", "failed", "pending", ""];
const oneOf = <T extends string>(v: unknown, all: readonly T[], dflt: T): T => (typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : dflt);

export function rowLang(r: Record<string, unknown> | undefined): LangInfo {
  if (!r) return { ...EMPTY_LANG, modules: { ...EMPTY_LANG.modules } };
  let m: Record<string, unknown> = {};
  try { const p = JSON.parse(String(r.modules || "{}")); if (p && typeof p === "object" && !Array.isArray(p)) m = p; } catch { m = {}; }
  return {
    level: oneOf(r.level, LEVELS, "" as Level) as Level,
    modules: Object.fromEntries(MODULES.map((k) => [k, oneOf(m[k], MOD_STATES, "")])) as Record<Module, ModState>,
    exam_date: cleanDate(r.exam_date),
    provider: oneOf(r.provider, PROVIDERS, "" as Provider) as Provider,
    school: clean(r.school, 80),
    path: r.path === "b1_de" ? "b1_de" : "",
  };
}
export function rowMarks(r: Record<string, unknown> | undefined): Marks {
  if (!r) return { ...EMPTY_MARKS };
  return { contract: cleanDate(r.contract), kp_date: cleanDate(r.kp_date), kp_result: r.kp_result === "passed" || r.kp_result === "failed" ? r.kp_result : "", urkunde: cleanDate(r.urkunde) };
}

/**
 * Merge a client patch into the stored record. `full` = facility/Borivon (may set results); a nurse
 * may only set her exam date, provider and school. Unknown keys are ignored; bad values are cleared.
 */
export function patchLang(cur: LangInfo, b: Record<string, unknown>, full: boolean): LangInfo {
  const n: LangInfo = { ...cur, modules: { ...cur.modules } };
  if ("exam_date" in b) n.exam_date = cleanDate(b.exam_date);
  if ("provider" in b) n.provider = oneOf(b.provider, PROVIDERS, "" as Provider) as Provider;
  if ("school" in b) n.school = clean(b.school, 80);
  if (full) {
    if ("level" in b) n.level = oneOf(b.level, LEVELS, "" as Level) as Level;
    if ("path" in b) n.path = b.path === "b1_de" ? "b1_de" : "";
    if (b.modules && typeof b.modules === "object" && !Array.isArray(b.modules)) {
      const m = b.modules as Record<string, unknown>;
      for (const k of MODULES) if (k in m) n.modules[k] = oneOf(m[k], MOD_STATES, "");
    }
  }
  return n;
}
export function patchMarks(cur: Marks, b: Record<string, unknown>): Marks {
  const n: Marks = { ...cur };
  if ("contract" in b) n.contract = cleanDate(b.contract);
  if ("kp_date" in b) n.kp_date = cleanDate(b.kp_date);
  if ("kp_result" in b) n.kp_result = b.kp_result === "passed" || b.kp_result === "failed" ? b.kp_result : "";
  if ("urkunde" in b) n.urkunde = cleanDate(b.urkunde);
  return n;
}

/** all four modules passed = B2 done, even before the certificate is uploaded */
export const allModulesPassed = (l: LangInfo | null | undefined) => !!l && MODULES.every((k) => l.modules[k] === "passed");
