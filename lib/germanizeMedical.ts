/**
 * germanizeMedical — rule-based (NO AI) FR→DE translation of the COMMON
 * institution / medical "type" words that appear in free-typed employer and
 * school names on a candidate's CV.
 *
 * Why: hospital/clinic/school names can't be a dropdown (there are thousands),
 * so candidates type them — usually in French ("Hôpital Sidi Said", "Clinique
 * El Menzeh", "Centre de santé …"). The TYPE word (Hôpital, Clinique, Centre…)
 * is a small known set, so we replace just those with the German equivalent and
 * leave the proper name + city untouched — which is exactly how a German CV
 * should read.
 *
 * This is deliberately a dictionary, not a translator: a word it doesn't know
 * passes through unchanged (only an AI/ML translator handles truly arbitrary
 * text). It is idempotent — running it on already-German text is a no-op — so
 * it's safe to apply on every render.
 *
 * Order matters: longest / most specific phrases first so e.g. "centre
 * hospitalier universitaire" wins over "centre".
 */

const RULES: [RegExp, string][] = [
  // ── Hospital / clinic acronyms + multi-word types (most specific first) ──
  [/\bcentre\s+hospitalier\s+universitaire\b/gi, "Universitätsklinikum"],
  [/\bcentre\s+hospitalier\s+provincial\b/gi, "Provinzkrankenhaus"],
  [/\bcentre\s+hospitalier\s+r[ée]gional\b/gi, "Regionalkrankenhaus"],
  [/\bcentre\s+hospitalier\b/gi, "Krankenhaus"],
  [/\bcentre\s+d['’]oncologie\b/gi, "Onkologiezentrum"],
  [/\bcentre\s+m[ée]dical\b/gi, "Medizinisches Zentrum"],
  [/\bcentre\s+de\s+formation\b/gi, "Ausbildungszentrum"],
  [/\b(?:les\s+)?centres\s+de\s+sant[ée]\b/gi, "Gesundheitszentren"],
  [/\b(?:le\s+|la\s+|l['’])?centre\s+de\s+sant[ée]\b/gi, "Gesundheitszentrum"],
  [/\bh[oô]pital\s+militaire\b/gi, "Militärkrankenhaus"],
  [/\bcabinet\s+m[ée]dical\b/gi, "Arztpraxis"],
  [/\bmaison\s+de\s+retraite\b/gi, "Altenheim"],
  [/\bfacult[ée]\s+de\s+m[ée]decine\b/gi, "Medizinische Fakultät"],
  [/\b[ée]cole\s+sup[ée]rieure\b/gi, "Hochschule"],
  [/\binstitut\s+sup[ée]rieur\b/gi, "Höheres Institut"],
  [/\binstitut\s+de\s+formation\b/gi, "Bildungsinstitut"],
  // ── Single-word types ──
  [/\bCHU\b/g, "Universitätsklinikum"],
  [/\bCHP\b/g, "Provinzkrankenhaus"],
  [/\bCHR\b/g, "Regionalkrankenhaus"],
  [/\bpolyclinique\b/gi, "Poliklinik"],
  [/\bclinique\b/gi, "Klinik"],
  [/\bh[oô]pital\b/gi, "Krankenhaus"],
  [/\bdispensaire\b/gi, "Ambulatorium"],
  [/\bmaternit[ée]\b/gi, "Geburtsklinik"],
  [/\bpharmacie\b/gi, "Apotheke"],
  [/\bcabinet\b/gi, "Praxis"],
  [/\buniversit[ée]\b/gi, "Universität"],
  [/\bfacult[ée]\b/gi, "Fakultät"],
  [/\blyc[ée]e\b/gi, "Gymnasium"],
  [/\b[ée]cole\b/gi, "Schule"],
];

/** Translate the common FR institution/medical type-words in a free-typed name
 *  to German; leave proper names, cities and unknown words unchanged. */
export function germanizeMedical(input: string | null | undefined): string {
  let s = (input ?? "").trim();
  if (!s) return "";
  for (const [re, de] of RULES) s = s.replace(re, de);
  // Collapse any double spaces left by dropped French articles ("Les …").
  return s.replace(/\s{2,}/g, " ").trim();
}
