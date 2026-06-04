/**
 * Anerkennung — German diploma-recognition sub-journey (the hardest, most
 * opaque step for a Moroccan nurse). Linear, mirrors b2Journey: one stored
 * `anerkennung_stage` string on candidate_profiles moves through the stages.
 *
 * Pure / server-safe.
 */

export type AnerkennungStage =
  | "not_started"     // recognition not filed yet (grey)
  | "submitted"       // Antrag sent to the recognition authority (blue)
  | "in_review"       // authority examining the file (amber)
  | "deficit"         // Defizitbescheid received — needs exam OR course (orange)
  | "exam_or_course"  // Kenntnisprüfung or Anpassungslehrgang in progress (purple)
  | "recognized";     // full Approbation / Berufserlaubnis ✓ (green)

export type AnerkennungStageDef = {
  key: AnerkennungStage;
  position: number;
  color: string;
  label: { en: string; fr: string; de: string };
};

export const ANERKENNUNG_STAGES: AnerkennungStageDef[] = [
  { key: "not_started",    position: 0, color: "#6b7280", label: { en: "Not started",               fr: "Pas commencé",              de: "Nicht begonnen" } },
  { key: "submitted",      position: 1, color: "#3b82f6", label: { en: "Application submitted",      fr: "Demande déposée",           de: "Antrag gestellt" } },
  { key: "in_review",      position: 2, color: "#f59e0b", label: { en: "Under review",               fr: "En cours d'examen",         de: "In Prüfung" } },
  { key: "deficit",        position: 3, color: "#f97316", label: { en: "Deficit notice received",    fr: "Avis de déficit reçu",      de: "Defizitbescheid erhalten" } },
  { key: "exam_or_course", position: 4, color: "#8b5cf6", label: { en: "Exam / course in progress",  fr: "Examen / cours en cours",   de: "Prüfung / Lehrgang läuft" } },
  { key: "recognized",     position: 5, color: "#16a34a", label: { en: "Fully recognized",           fr: "Pleinement reconnu",        de: "Voll anerkannt" } },
];

export const ANERKENNUNG_STAGE_BY_KEY: Record<string, AnerkennungStageDef> =
  Object.fromEntries(ANERKENNUNG_STAGES.map((s) => [s.key, s]));

export function isAnerkennungStage(v: unknown): v is AnerkennungStage {
  return typeof v === "string" && v in ANERKENNUNG_STAGE_BY_KEY;
}

export function normalizeAnerkennungStage(v: unknown): AnerkennungStage {
  return isAnerkennungStage(v) ? v : "not_started";
}

export function anerkennungStageLabel(stage: AnerkennungStage, lang: string): string {
  const d = ANERKENNUNG_STAGE_BY_KEY[stage];
  return d.label[(lang as "en" | "fr" | "de")] ?? d.label.en;
}

export function anerkennungStageColor(stage: AnerkennungStage): string {
  return ANERKENNUNG_STAGE_BY_KEY[stage]?.color ?? "#6b7280";
}

export function isAnerkennungRecognized(stage: AnerkennungStage): boolean {
  return stage === "recognized";
}
