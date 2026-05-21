-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor.
--
-- Adds documents.file_sha256 — populated on upload, verified on every passport
-- serve. The 4th defense layer behind LAW #39 (passport PDFs are NEVER
-- server-side mutated).
--
-- If a future regression mutates passport bytes anywhere in the pipeline,
-- /api/portal/file will detect the divergence (served bytes hash ≠ stored
-- hash), log a critical alert, and transparently fall back to the
-- Supabase Storage backup (doc-cache/<driveFileId>) which holds the
-- original upload bytes. Worst case: user sees their pristine passport;
-- we get a server log entry naming the corrupting code path.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS file_sha256 TEXT;

-- Index isn't strictly needed (the hash is read alongside the row in a single
-- query, never queried-by) but it's cheap and makes future audit queries
-- (e.g. "find docs where Drive bytes differ from stored hash") fast.
CREATE INDEX IF NOT EXISTS documents_sha256_idx
  ON public.documents (file_sha256)
  WHERE file_sha256 IS NOT NULL;
