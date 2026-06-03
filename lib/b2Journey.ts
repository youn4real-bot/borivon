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
  | "studying"          // still studying (grey) — the start
  | "expected_date"     // expected passing date confirmed (blue)
  | "exam_booked"       // exam date paid & confirmed (yellow)
  | "awaiting_results"  // sat the exam, awaiting results (amber)
  | "passed";           // B2 passed ✓ (green)

export type B2StageDef = {
  key: B2Stage;
  position: number;
  /** Ring colour for a candidate AT this stage. */
  color: string;
  label: { en: string; fr: string; de: string };
};

// ONE linear rail. "Failed" is NOT a stage — it's a persistent flag (b2_failed)
// rendered as a RED OUTER HALO around the avatar, with the stage colour as the
// inner ring. So a candidate who failed and is now re-booked shows red + the
// stage colour, and stays red forever (you always know they failed once).
export const B2_STAGES: B2StageDef[] = [
  { key: "studying",         position: 0, color: "#6b7280", label: { en: "Studying",                        fr: "En cours d'étude",                de: "Lernphase" } },
  { key: "expected_date",    position: 1, color: "#3b82f6", label: { en: "Expected passing date confirmed", fr: "Date prévue confirmée",           de: "Voraussichtl. Termin bestätigt" } },
  { key: "exam_booked",      position: 2, color: "#eab308", label: { en: "Exam date paid & confirmed",       fr: "Date d'examen payée & confirmée", de: "Prüfungstermin bezahlt & bestätigt" } },
  { key: "awaiting_results", position: 3, color: "#f59e0b", label: { en: "Awaiting results release",         fr: "Résultats en attente",            de: "Ergebnisse ausstehend" } },
  { key: "passed",           position: 4, color: "#16a34a", label: { en: "B2 passed",                        fr: "B2 réussi",                       de: "B2 bestanden" } },
];

/** The red halo colour for candidates who have failed B2 at least once. */
export const B2_FAILED_COLOR = "#ef4444";

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
 * Resolve the B2 stage to DISPLAY, honoring real evidence over the stored field:
 *   • an APPROVED B2 cert → "passed"
 *   • a pending (uploaded, not-yet-approved) B2 cert → "awaiting_results" (they've
 *     clearly sat the exam) — unless the stored stage is already further along.
 *   • otherwise → the stored stage (admin's manual call).
 * NOTE: the persistent "failed" flag is SEPARATE (see b2Failed) — it never
 * changes the stage; it only adds the red halo. A failed candidate keeps moving
 * through the same stages for their retake.
 */
export function effectiveB2Stage(
  stored: B2Stage,
  docs: { file_type: string | null; status: string | null }[],
): B2Stage {
  const hasApprovedCert = docs.some((d) => d.status === "approved" && isB2CertDoc(d.file_type));
  if (hasApprovedCert) return "passed";
  const hasAnyCert = docs.some((d) => isB2CertDoc(d.file_type));
  if (hasAnyCert) {
    const awaitingPos = B2_STAGE_BY_KEY["awaiting_results"].position;
    const storedPos = B2_STAGE_BY_KEY[stored]?.position ?? 0;
    return storedPos > awaitingPos ? stored : "awaiting_results";
  }
  return stored;
}
