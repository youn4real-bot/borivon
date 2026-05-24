/**
 * Per-box PDF page caps — upload guardrail.
 *
 * Candidate documents are small; these caps block accidental or abusive huge
 * uploads while leaving generous headroom for legit multi-page docs
 * (transcripts, study programs). Enforced READ-ONLY in the upload route (count
 * pages, never re-save) so passport bytes are never mutated (LAW #39).
 *
 * Translated variants ("diploma_de", "other_trans", …) share the base cap.
 * fileKeys not listed — e.g. admin Bearbeitung/Visum wizard slots, whose
 * fileKey is a UUID — fall back to DEFAULT_PDF_PAGE_LIMIT. Tune any number
 * freely; this map is the single source of truth.
 */
export const PDF_PAGE_LIMITS: Record<string, number> = {
  // ── Essentials ──
  id: 2,                  // Passport (Reisepass)
  langcert: 2,            // B2 certificate
  letter: 1,              // Cover letter (Anschreiben)
  cv_de: 2,               // CV (Lebenslauf)
  // ── Qualifications — ORIGINAL and TRANSLATION (_de) are SEPARATE boxes, each
  //    independently allowed the SAME number (study program = 10 for the
  //    original PDF AND 10 for the translated copy). ──
  diploma: 2,             diploma_de: 2,
  studyprog: 10,          studyprog_de: 10,
  transcript: 10,         transcript_de: 10,
  abitur: 2,              abitur_de: 2,
  abitur_transcript: 2,   abitur_transcript_de: 2,
  praktikum: 10,          praktikum_de: 10,
  workcert: 2,            workcert_de: 2,           // Berufserlaubnis
  work_experience: 10,    work_experience_de: 10,
  impfung: 2,             impfung_de: 2,            // Vaccination (Impfnachweis)
  // ── Other (Sonstiges) — original + translated copy, 10 each ──
  other: 10,              other_trans: 10,
};

/** Cap for any box not explicitly listed — e.g. admin Bearbeitung/Visum wizard
 *  slots (UUID fileKeys), which can be longer signed forms/contracts. */
export const DEFAULT_PDF_PAGE_LIMIT = 40;

/**
 * Max allowed PDF pages for an upload box. Resolution order:
 *   1. exact fileKey ("diploma", "cv_de", …)
 *   2. base fileKey with a translated suffix stripped ("diploma_de" → "diploma")
 *   3. DEFAULT_PDF_PAGE_LIMIT
 */
export function pdfPageLimit(fileKey: string | null | undefined): number {
  if (!fileKey) return DEFAULT_PDF_PAGE_LIMIT;
  if (PDF_PAGE_LIMITS[fileKey] != null) return PDF_PAGE_LIMITS[fileKey];
  const base = fileKey.replace(/_(de|trans|uebersetzt|original)$/, "");
  return PDF_PAGE_LIMITS[base] ?? DEFAULT_PDF_PAGE_LIMIT;
}
