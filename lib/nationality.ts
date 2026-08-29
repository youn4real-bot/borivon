/**
 * Nationality → canonical country, displayed as the country NAME in the UI
 * language (the founder's call: it doesn't matter whether it was entered as
 * "marokkanisch", "Marokko" or "Maroc" — show it as Morocco / Maroc / Marokko).
 *
 * Merges the many free-text spellings of a nationality into one country code, and
 * localizes the label. Unknown values pass through unchanged (so nothing is lost).
 * Pure / server-safe.
 */

const GROUPS: Record<string, string[]> = {
  MA: ["maroc", "marokko", "morocco", "moroccan", "marocain", "marocaine", "marokkanisch", "marokkanische", "marokkaner", "marokkanerin", "mar"],
  TN: ["tunisie", "tunisia", "tunisien", "tunisienne", "tunisian", "tunesien", "tunesisch", "tunesische"],
  DZ: ["algerie", "algeria", "algerien", "algerian", "algerienne", "algerisch", "algerische"],
  EG: ["egypte", "egypt", "egyptien", "egyptian", "agypten", "aegypten", "agyptisch"],
  FR: ["france", "french", "francais", "francaise", "frankreich", "franzosisch", "franzosische"],
  DE: ["allemagne", "germany", "german", "allemand", "allemande", "deutschland", "deutsch", "deutsche"],
};

const LABELS: Record<string, { en: string; fr: string; de: string }> = {
  MA: { en: "Morocco", fr: "Maroc", de: "Marokko" },
  TN: { en: "Tunisia", fr: "Tunisie", de: "Tunesien" },
  DZ: { en: "Algeria", fr: "Algérie", de: "Algerien" },
  EG: { en: "Egypt", fr: "Égypte", de: "Ägypten" },
  FR: { en: "France", fr: "France", de: "Frankreich" },
  DE: { en: "Germany", fr: "Allemagne", de: "Deutschland" },
};

const WORD_TO_CODE: Record<string, string> = {};
for (const [code, words] of Object.entries(GROUPS)) for (const w of words) WORD_TO_CODE[w] = code;

function normv(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Map a free-text nationality/country to a country code, or null if unrecognized. */
export function canonicalCountry(raw: string | null | undefined): string | null {
  const v = normv(raw);
  if (!v) return null;
  if (WORD_TO_CODE[v]) return WORD_TO_CODE[v];
  // substring fallback: "marokkanische staatsangehörigkeit" → MA
  for (const [w, code] of Object.entries(WORD_TO_CODE)) {
    if (w.length >= 4 && v.includes(w)) return code;
  }
  return null;
}

/** Localized country name for a code; passes through an unrecognized raw value. */
export function countryLabel(codeOrRaw: string, lang: string): string {
  const l = LABELS[codeOrRaw];
  if (!l) return codeOrRaw;
  return lang === "fr" ? l.fr : lang === "de" ? l.de : l.en;
}

/** The facet/display key for a nationality: its country code if known, else the
 *  trimmed raw value (so unknown nationalities still appear, un-merged). */
export function nationalityKey(raw: string | null | undefined): string | null {
  const code = canonicalCountry(raw);
  if (code) return code;
  const t = (raw ?? "").trim();
  return t || null;
}
