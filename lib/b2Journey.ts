/**
 * B2 German — the sub-journey ("journey inside the journey").
 *
 * B2 isn't pass/fail; it's its own mini-roadmap WITH A LOOP: a candidate can sit
 * a partial pass and re-book the remaining modules (partial → booked again). It
 * runs in PARALLEL to the main Morocco→Germany rail (flexible timing), so it
 * gets its own mini-rail + a colour-coded badge per candidate.
 *
 * Stored as a single `b2_stage` string on candidate_profiles (one value moves
 * through the stages + can loop back), not as separate journey rows — cleaner
 * data and the loop models naturally.
 *
 * Pure / server-safe.
 */

export type B2Stage =
  // ── Main path ──────────────────────────────────────────────────────────
  | "studying"          // still studying (the starting point)
  | "expected_date"     // expected passing date confirmed
  | "exam_booked"       // actual exam date — paid & confirmed
  | "awaiting_results"  // sat the exam, expected results-release date
  | "passed"            // B2 passed ✓
  // ── Failure branch (loops back to awaiting_results) ───────────────────────
  | "failed"            // didn't pass
  | "retake_expected"   // expected new passing date
  | "retake_booked";    // new date paid & confirmed → loops back to results

export type B2StageDef = {
  key: B2Stage;
  position: number;
  /** Hex colour for the dot badge + mini-rail node. */
  color: string;
  label: { en: string; fr: string; de: string };
};

// Main path (studying → expected date → exam booked → awaiting results → passed).
// The failure branch (failed → expected → booked) loops back to awaiting results.
export const B2_STAGES: B2StageDef[] = [
  { key: "studying",         position: 0, color: "#3b82f6", label: { en: "Studying",                       fr: "En cours d'étude",            de: "Lernphase" } },
  { key: "expected_date",    position: 1, color: "#8b5cf6", label: { en: "Expected passing date confirmed", fr: "Date prévue confirmée",       de: "Voraussichtl. Termin bestätigt" } },
  { key: "exam_booked",      position: 2, color: "#f59e0b", label: { en: "Exam date paid & confirmed",      fr: "Date d'examen payée & confirmée", de: "Prüfungstermin bezahlt & bestätigt" } },
  { key: "awaiting_results", position: 3, color: "#eab308", label: { en: "Awaiting results release",        fr: "Résultats en attente",        de: "Ergebnisse ausstehend" } },
  { key: "passed",           position: 4, color: "#16a34a", label: { en: "B2 passed",                       fr: "B2 réussi",                   de: "B2 bestanden" } },
  // Failure branch (right column).
  { key: "failed",           position: 5, color: "#ef4444", label: { en: "Didn't pass",                    fr: "Échoué",                      de: "Nicht bestanden" } },
  { key: "retake_expected",  position: 6, color: "#f97316", label: { en: "Expected new date",               fr: "Nouvelle date prévue",        de: "Neuer Termin geplant" } },
  { key: "retake_booked",    position: 7, color: "#f59e0b", label: { en: "New date paid & confirmed",       fr: "Nouvelle date confirmée",     de: "Neuer Termin bestätigt" } },
];

// Left rail = the main path; right column = the failure/retake branch.
export const B2_MAIN_STAGES = B2_STAGES.filter((s) => ["studying", "expected_date", "exam_booked", "awaiting_results", "passed"].includes(s.key));
export const B2_FAIL_STAGES = B2_STAGES.filter((s) => ["failed", "retake_expected", "retake_booked"].includes(s.key));

export const B2_STAGE_BY_KEY: Record<string, B2StageDef> =
  Object.fromEntries(B2_STAGES.map((s) => [s.key, s]));

export function isB2Stage(v: unknown): v is B2Stage {
  return typeof v === "string" && v in B2_STAGE_BY_KEY;
}

/** Normalize any stored value → a valid stage (defaults to studying = the start). */
export function normalizeB2Stage(v: unknown): B2Stage {
  return isB2Stage(v) ? v : "studying";
}

export function b2StageLabel(stage: B2Stage, lang: string): string {
  const d = B2_STAGE_BY_KEY[stage];
  const l = d.label;
  return l[(lang as "en" | "fr" | "de")] ?? l.en;
}

export function b2StageColor(stage: B2Stage): string {
  return B2_STAGE_BY_KEY[stage]?.color ?? "#6b7280";
}

/** B2 is "done" only at the passed stage. */
export function isB2Passed(stage: B2Stage): boolean {
  return stage === "passed";
}

// Document file_type labels that ARE a B2 language certificate (FR/EN/DE).
const B2_CERT_RE = /b2\s*(sprachzert|language cert|.*zertifikat)|certificat de langue b2|b2[\s_-]*zertifikat/i;
export function isB2CertDoc(fileType: string | null | undefined): boolean {
  return !!fileType && B2_CERT_RE.test(fileType);
}

/**
 * Resolve the B2 stage to DISPLAY, honoring real evidence over the stored field.
 * A candidate moves on the B2 track by actually having the certificate, not by
 * someone manually setting a dropdown:
 *   • an APPROVED B2 cert → "passed"
 *   • a pending (uploaded, not-yet-approved) B2 cert → "booked" (confirmed date;
 *     they've clearly sat/are sitting the exam) — unless the stored stage is the
 *     'retaking' failure branch, which an admin set deliberately and we keep.
 *   • otherwise → the stored stage (admin's manual call: studying / planning /
 *     booked / retaking).
 */
const FAIL_BRANCH = new Set<B2Stage>(["failed", "retake_expected", "retake_booked"]);

export function effectiveB2Stage(
  stored: B2Stage,
  docs: { file_type: string | null; status: string | null }[],
): B2Stage {
  const hasApprovedCert = docs.some((d) => d.status === "approved" && isB2CertDoc(d.file_type));
  if (hasApprovedCert) return "passed";
  // The failure branch is set deliberately by an admin — it wins over a pending
  // cert (a retake candidate may have an old, unapproved cert on file).
  if (FAIL_BRANCH.has(stored)) return stored;
  const hasAnyCert = docs.some((d) => isB2CertDoc(d.file_type));
  if (hasAnyCert) {
    // Uploaded but unapproved cert → they've sat the exam → at least "awaiting
    // results", unless the stored stage is already further along the main path.
    const awaitingPos = B2_STAGE_BY_KEY["awaiting_results"].position;
    const storedPos = B2_STAGE_BY_KEY[stored]?.position ?? 0;
    return storedPos > awaitingPos ? stored : "awaiting_results";
  }
  return stored;
}
