/**
 * "Ready to sell" definition — the single tunable gate behind the admin
 * dashboard's hero number ("X candidates are Germany-ready to sell").
 *
 * Pure / server-safe. The whole business rule lives HERE so it can evolve
 * without touching the API or UI. Today's rule (user, 2026-06):
 *   sellable = German CV finalized  AND  an approved nursing diploma on file.
 * "maybe later we will change it" → just edit isSellable() / the constants.
 */

import { resolveFileKey } from "./fileKeys";

// Legacy exact labels that have meant "nursing diploma" over time (FR/EN/DE).
// Kept as a belt-and-suspenders fallback ALONGSIDE the fileKey resolution below
// so a stored value matches whether it's a label, a legacy alias, or the key.
export const DIPLOMA_FILE_TYPES = ["Diplom", "Diplom (DE)", "Nursing Diploma", "Pflegediplom", "Pflegediplom (DE)"];
// Canonical fileKeys that count as the nursing diploma (original + German copy).
const DIPLOMA_FILE_KEYS = new Set(["diploma", "diploma_de"]);

// Journey preset key that means the German CV is finalized.
export const CV_PRESET_KEY = "cv_finalized";

export type SellableInput = {
  /** This candidate's document rows (only file_type + status needed). */
  documents: { file_type: string | null; status: string | null }[];
  /** This candidate's journey rows (only preset_key + done needed). */
  journey: { preset_key: string | null; done: boolean }[];
};

/** True once the candidate has an APPROVED diploma document on file. Matches by
 *  canonical fileKey (any upload language / key-stored) with a legacy-label fallback. */
export function hasApprovedDiploma(docs: SellableInput["documents"]): boolean {
  return docs.some(
    (d) => d.status === "approved" && !!d.file_type &&
      (DIPLOMA_FILE_KEYS.has(resolveFileKey(d.file_type)) || DIPLOMA_FILE_TYPES.includes(d.file_type)),
  );
}

/** True once the candidate has an APPROVED German CV (Lebenslauf) document. This
 *  is the SAME evidence the map uses to advance the cv_finalized station, so the
 *  "ready to sell" badge can never disagree with the avatar's position. */
export function hasApprovedCv(docs: SellableInput["documents"]): boolean {
  return docs.some(
    (d) => d.status === "approved" && !!d.file_type &&
      (resolveFileKey(d.file_type) === "cv_de" || /lebenslauf/i.test(d.file_type)),
  );
}

/** True once the German CV milestone is ticked done in the journey checklist. */
export function hasFinalizedCv(journey: SellableInput["journey"]): boolean {
  return journey.some((j) => j.preset_key === CV_PRESET_KEY && j.done === true);
}

/**
 * THE rule. Change this one function to redefine "sellable".
 * Returns the verdict plus the two component checks, so the UI can show a
 * candidate exactly what's still missing ("CV done, diploma pending").
 *
 * CV "done" honors EITHER the ticked journey milestone OR an approved CV
 * document — the latter is what auto-advances the map, so the badge and the
 * avatar's station always agree.
 */
export function evaluateSellable(input: SellableInput): {
  sellable: boolean;
  cvDone: boolean;
  diplomaApproved: boolean;
} {
  const cvDone = hasFinalizedCv(input.journey) || hasApprovedCv(input.documents);
  const diplomaApproved = hasApprovedDiploma(input.documents);
  return { sellable: cvDone && diplomaApproved, cvDone, diplomaApproved };
}
