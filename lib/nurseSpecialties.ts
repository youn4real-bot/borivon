/**
 * Nursing specialties — the structured "what kind of nurse is this" facet that
 * German hospitals care about most. Stored as a stable key on
 * candidate_profiles.nursing_specialty; displayed via the trilingual label.
 *
 * Pure / server-safe. The key is what's persisted + filtered on; never store the
 * translated label.
 */

export type NurseSpecialty = {
  key: string;
  label: { en: string; fr: string; de: string };
};

// Common Pflegefachkraft fields. Keep keys ASCII + stable; labels are display-only.
export const NURSE_SPECIALTIES: NurseSpecialty[] = [
  { key: "general",     label: { en: "General ward",        fr: "Soins généraux",        de: "Allgemeine Pflege" } },
  { key: "intensive",   label: { en: "Intensive care (ICU)", fr: "Soins intensifs",      de: "Intensivpflege" } },
  { key: "geriatric",   label: { en: "Geriatric / elderly",  fr: "Gériatrie",            de: "Altenpflege" } },
  { key: "surgical",    label: { en: "Surgical / OR",        fr: "Chirurgie / bloc",     de: "OP / Chirurgie" } },
  { key: "pediatric",   label: { en: "Pediatric",            fr: "Pédiatrie",            de: "Kinderkrankenpflege" } },
  { key: "emergency",   label: { en: "Emergency",            fr: "Urgences",             de: "Notaufnahme" } },
  { key: "anesthesia",  label: { en: "Anesthesia",           fr: "Anesthésie",           de: "Anästhesie" } },
  { key: "psychiatric", label: { en: "Psychiatric",          fr: "Psychiatrie",          de: "Psychiatrie" } },
  { key: "obstetrics",  label: { en: "Obstetrics / midwife", fr: "Obstétrique",          de: "Geburtshilfe" } },
  { key: "oncology",    label: { en: "Oncology",             fr: "Oncologie",            de: "Onkologie" } },
  { key: "cardiology",  label: { en: "Cardiology",           fr: "Cardiologie",          de: "Kardiologie" } },
  { key: "dialysis",    label: { en: "Dialysis / nephro",    fr: "Dialyse / néphro",     de: "Dialyse / Nephrologie" } },
];

export const SPECIALTY_BY_KEY: Record<string, NurseSpecialty> =
  Object.fromEntries(NURSE_SPECIALTIES.map((s) => [s.key, s]));

export function isNurseSpecialty(v: unknown): v is string {
  return typeof v === "string" && v in SPECIALTY_BY_KEY;
}

export function specialtyLabel(key: string | null | undefined, lang: string): string {
  if (!key) return "";
  const s = SPECIALTY_BY_KEY[key];
  if (!s) return key;
  return s.label[(lang as "en" | "fr" | "de")] ?? s.label.en;
}
