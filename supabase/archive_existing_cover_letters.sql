-- DEPRECATED 2026-05: ran against the now-retired uksh_campus column (see uksh_campus_retire.sql). Kept for history.
-- ─────────────────────────────────────────────────────────────────────────────
-- ONE-TIME archive of every existing candidate-uploaded cover letter PDF.
--
-- WHY:  We are switching the "Cover letter" dashboard slot from upload-based
--       to builder-based (/portal/motivationsschreiben). Existing uploads must
--       stay in the database AND on Google Drive — nothing is deleted — but
--       the slot needs to read EMPTY for the candidate so the new builder
--       takes over cleanly.
--
-- HOW:  Append " (Archiv)" to the file_type of every doc whose file_type is
--       one of the three letter labels (Anschreiben / Cover letter / Lettre
--       de motivation). The new label matches NO fileKey, so:
--         - candidate dashboard "Cover letter" row → reads empty → builder UI
--         - admin "Cover letter" row              → reads empty
--       Original info is preserved (the language is still visible in the new
--       label, e.g. "Anschreiben (Archiv)") and every other column is
--       untouched (drive_file_id, status, feedback, user_id, uploaded_at,
--       rotation, signed_storage_path, …).
--
-- SAFETY:
--   • Wrapped in a transaction — rolls back on any error.
--   • Idempotent — re-running matches 0 rows (the archived rows already have
--     the " (Archiv)" suffix, not the original label).
--   • Reversible — to undo:
--       UPDATE public.documents
--         SET file_type = regexp_replace(file_type, ' \(Archiv\)$', '')
--         WHERE file_type LIKE '% (Archiv)';
--
-- RUN ORDER (relative to other migrations):
--   Run AFTER uksh_campus.sql + employers.sql.
--   Run BEFORE deploying the new builder code — that way no candidate has a
--   freshly built letter yet, so this only catches the legacy uploads.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Dry-run preview — how many rows will be archived, per label.
SELECT file_type, COUNT(*) AS rows_to_archive
FROM public.documents
WHERE file_type IN ('Anschreiben', 'Cover letter', 'Lettre de motivation')
GROUP BY file_type
ORDER BY file_type;

-- 2) Archive: append " (Archiv)" to the file_type.
UPDATE public.documents
   SET file_type = file_type || ' (Archiv)'
 WHERE file_type IN ('Anschreiben', 'Cover letter', 'Lettre de motivation');

-- 3) Post-check — number of archived rows and number of unarchived letters
--    left (should be 0).
SELECT
  (SELECT COUNT(*) FROM public.documents
     WHERE file_type LIKE '% (Archiv)') AS archived_total,
  (SELECT COUNT(*) FROM public.documents
     WHERE file_type IN ('Anschreiben', 'Cover letter', 'Lettre de motivation')
  ) AS unarchived_letter_rows_remaining;

COMMIT;
