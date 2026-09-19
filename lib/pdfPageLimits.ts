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
  // The tight caps below used to be 1-2 pages, which real Moroccan paperwork
  // simply does not fit: a passport scan carries the photo page plus stamped
  // pages, a diploma arrives with its apostille and certification, a
  // Berufserlaubnis runs several pages and a vaccination booklet is a booklet.
  // On 2026-09-19 the founder's own 3-page scan was refused twice with 413 and
  // the admin panel showed nothing, so it read as "uploading is broken". These
  // are guardrails against a whole dossier landing in one box, not a filing
  // rule -- so they sit well above the real documents.
  // ── Essentials ──
  id: 6,                  // Passport (Reisepass) — photo page + stamped pages
  langcert: 5,            // B2 certificate — certificate + transcript sheet
  letter: 5,              // Cover letter (Anschreiben)
  cv_de: 5,               // CV (Lebenslauf)
  // ── Qualifications — ORIGINAL and TRANSLATION (_de) are SEPARATE boxes, each
  //    independently allowed the SAME number. ──
  diploma: 8,             diploma_de: 8,            // diploma + apostille + certification
  studyprog: 10,          studyprog_de: 10,
  transcript: 10,         transcript_de: 10,
  abitur: 8,              abitur_de: 8,
  abitur_transcript: 10,  abitur_transcript_de: 10,
  praktikum: 10,          praktikum_de: 10,
  workcert: 10,           workcert_de: 10,          // Berufserlaubnis
  work_experience: 10,    work_experience_de: 10,
  impfung: 15,            impfung_de: 15,           // a vaccination booklet is a booklet
  // ── Other (Sonstiges) — original + translated copy ──
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
