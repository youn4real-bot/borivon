/**
 * "Ready to sell" definition — the single tunable gate behind the admin
 * dashboard's hero number ("X candidates are Germany-ready to sell").
 *
 * Pure / server-safe. The whole business rule lives HERE so it can evolve
 * without touching the API or UI. Today's rule (user, 2026-06):
 *   sellable = German CV finalized  AND  an approved nursing diploma on file.
 * "maybe later we will change it" → just edit isSellable() / the constants.
 */

// Document file_type labels that count as the nursing diploma. The same doc has
// shipped under several labels over time (FR/EN/DE) — match them all.
export const DIPLOMA_FILE_TYPES = ["Diplom", "Diplom (DE)", "Nursing Diploma", "Pflegediplom", "Pflegediplom (DE)"];

// Journey preset key that means the German CV is finalized.
export const CV_PRESET_KEY = "cv_finalized";

export type SellableInput = {
  /** This candidate's document rows (only file_type + status needed). */
  documents: { file_type: string | null; status: string | null }[];
  /** This candidate's journey rows (only preset_key + done needed). */
  journey: { preset_key: string | null; done: boolean }[];
};

/** True once the candidate has an APPROVED diploma document on file. */
export function hasApprovedDiploma(docs: SellableInput["documents"]): boolean {
  return docs.some(
    (d) => d.status === "approved" && !!d.file_type && DIPLOMA_FILE_TYPES.includes(d.file_type),
  );
}

/** True once the German CV milestone is ticked done. */
export function hasFinalizedCv(journey: SellableInput["journey"]): boolean {
  return journey.some((j) => j.preset_key === CV_PRESET_KEY && j.done === true);
}

/**
 * THE rule. Change this one function to redefine "sellable".
 * Returns the verdict plus the two component checks, so the UI can show a
 * candidate exactly what's still missing ("CV done, diploma pending").
 */
export function evaluateSellable(input: SellableInput): {
  sellable: boolean;
  cvDone: boolean;
  diplomaApproved: boolean;
} {
  const cvDone = hasFinalizedCv(input.journey);
  const diplomaApproved = hasApprovedDiploma(input.documents);
  return { sellable: cvDone && diplomaApproved, cvDone, diplomaApproved };
}
