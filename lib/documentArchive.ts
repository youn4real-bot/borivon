/**
 * LAW #33 in the R2 era — "replaced files stay archived indefinitely".
 *
 * The law was written when Google Drive was the store of record, so it talks
 * about moving a file into `<candidate-folder>/archive/`. Drive is now only the
 * mirror we share with the partner agency; the bytes live in R2 and the
 * `documents` row is what makes them reachable. So in practice the law means:
 *
 *   a document row is NEVER hard-deleted, and a row's `r2_key` is never
 *   overwritten without first preserving the old key on an archived row.
 *
 * `superseded_at` is the archive marker the rest of the codebase already reads
 * (lib/driveMirror, lib/shortlist, lib/chaseList, lib/adminCandidateActions,
 * the dashboard's loadDocs and the admin panel all hide non-null rows), so
 * archiving is exactly "set superseded_at" — nothing else has to change for the
 * document to disappear from every live list while staying recoverable.
 *
 * Both helpers below are pure so the invariant can be tested without a database.
 */

/** Columns that identify WHERE a document's bytes actually are. */
export type DocBytesRef = {
  user_id: string;
  file_name: string | null;
  file_type: string | null;
  status?: string | null;
  feedback?: string | null;
  r2_key?: string | null;
  drive_file_id?: string | null;
  file_sha256?: string | null;
  rotation?: number | null;
  uploaded_at?: string | null;
};

/**
 * The patch that retires a row in place. Used when the document is being
 * removed outright (the candidate pressing "Remove", or the old row left behind
 * after a "Replace" upload inserted its successor).
 */
export function archivePatch(now = new Date()): { superseded_at: string } {
  return { superseded_at: now.toISOString() };
}

/**
 * The row to INSERT before overwriting a document's `r2_key` in place.
 *
 * `replace-passport-pdf` swaps new bytes onto the SAME row — it has to, because
 * the passport row carries approved status, feedback and the OCR-derived data
 * that must survive the swap (LAW #37). But overwriting `r2_key` used to drop
 * the only pointer to the previous scan: the object stayed in the bucket and
 * became unreachable from the portal, which is "deleted" in every sense the law
 * cares about. So we clone the pointer onto an archived sibling first.
 *
 * Returns null when there is nothing to preserve (no previous bytes anywhere),
 * so the caller can skip the insert instead of writing an empty archived row.
 */
export function archivedCopyOf(row: DocBytesRef, now = new Date()): (DocBytesRef & { superseded_at: string }) | null {
  if (!row.r2_key && !row.drive_file_id) return null;
  return {
    user_id: row.user_id,
    file_name: row.file_name ?? null,
    file_type: row.file_type ?? null,
    // The archived copy keeps the review verdict the bytes earned. Status is
    // what tells the admin, months later, whether the scan they are looking at
    // is the one that was approved.
    status: row.status ?? null,
    feedback: row.feedback ?? null,
    r2_key: row.r2_key ?? null,
    drive_file_id: row.drive_file_id ?? null,
    file_sha256: row.file_sha256 ?? null,
    rotation: row.rotation ?? 0,
    uploaded_at: row.uploaded_at ?? now.toISOString(),
    superseded_at: now.toISOString(),
  };
}
