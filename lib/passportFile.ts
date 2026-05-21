/**
 * LAW #39 — Passport PDFs are NEVER server-side mutated.
 *
 * Single source of truth for "is this document a passport scan?". Every
 * code path that serves or processes passport bytes MUST gate on this
 * helper, never on an inline `/pass/i.test(file_type)` ad-hoc check —
 * those copies drift, get missed, and the bug returns.
 *
 * The helper is intentionally tiny + pure so it can be imported into
 * any server route (file proxy, merge-pdf, sign-request, replace-passport-pdf)
 * AND any client component without pulling in deps.
 *
 * Matches both:
 *   • The DB column `documents.file_type` — language-dependent label
 *     like "Reisepass" / "Passport" / "Passeport" (every variant
 *     contains "pass" case-insensitively).
 *   • The fileKey "id" used during upload (lib/fileKeys.ts maps to the
 *     "reisepass" filename slug). Pass the resolved file_type here, NOT
 *     the raw fileKey — file_type is what the file proxy reads from the
 *     row.
 *
 * If you ever need to extend what counts as a passport (e.g. add a new
 * doctype that holds a passport scan), change THIS function — do not
 * inline a second check anywhere else. CI / future audits grep for
 * `/pass/i.test(` and flag every site that's not this helper.
 */
export function isPassportFileType(fileType: string | null | undefined): boolean {
  if (!fileType) return false;
  return /pass/i.test(fileType);
}
