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
  id: 5,                // Reisepass (passport — usually 1-2, allow multi-page scans)
  langcert: 8,          // B2 Sprachzertifikat
  letter: 5,            // Anschreiben (cover letter)
  cv_de: 8,             // Lebenslauf (CV)
  // ── Qualifications ──
  diploma: 8,
  studyprog: 25,        // Ausbildungsprogramm — can be long
  transcript: 20,       // Notenübersicht
  abitur: 12,
  abitur_transcript: 20,
  praktikum: 20,
  workcert: 12,         // Berufserlaubnis
  work_experience: 20,
  impfung: 20,          // Impfnachweis (vaccination records can be multi-page)
  // ── Other ──
  other: 40,            // Sonstiges catch-all
};

/** Cap for any box not explicitly listed (e.g. admin wizard slots / UUID keys). */
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
