/**
 * One live document per slot.
 *
 * A re-upload has always INSERTED a new `documents` row and left the old one
 * live. The candidate never noticed, because the dashboard de-duplicates on the
 * client (loadDocs keeps the newest row per fileKey) — but the admin review
 * queue counts rows, so every re-upload added another orange badge that could
 * never be cleared.
 *
 * Measured on the live database before this shipped: 67 slots holding more than
 * one live document, 147 redundant copies, one candidate with twelve live CVs.
 * Of 181 documents waiting for review, 126 were sitting in a duplicated slot —
 * roughly 70% of the queue was the same files over and over, and genuine
 * uploads had been waiting behind them for one to three months.
 *
 * The rule is the one the dashboard already applies, moved to where the data
 * is: a new upload retires the previous live rows for that slot. Retire, not
 * delete — `superseded_at` is the archive marker (LAW #33), every live list
 * already hides it, and the old version stays recoverable.
 */

/** Slots that legitimately hold MANY documents as peers, and must never collapse. */
export const MULTI_DOC_FILE_KEYS = new Set(["other"]);

/**
 * Should uploading into this slot retire what was already there?
 *
 * `fileKey` is the resolved key (LABEL_TO_FILE_KEY[file_type] ?? file_type), so
 * a wizard-slot UUID resolves to itself — correct, since those are single-doc
 * slots too.
 */
export function shouldSupersedePrevious(fileKey: string | null | undefined): boolean {
  const k = String(fileKey ?? "").trim();
  if (!k) return false;
  return !MULTI_DOC_FILE_KEYS.has(k);
}

/**
 * Which of a slot's existing rows to retire, given the id just inserted.
 *
 * Pure so the "never retire the row we just created" and "never touch an
 * already-archived row" guarantees are testable without a database. Returns ids
 * only — the caller does the update.
 */
export function idsToRetire(
  existing: { id: string; superseded_at?: string | null }[],
  justInsertedId: string,
): string[] {
  return existing
    .filter((d) => d.id !== justInsertedId && !d.superseded_at)
    .map((d) => d.id);
}
