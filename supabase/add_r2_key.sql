-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor. Idempotent.
--
-- Adds the Cloudflare R2 object key to `documents`. This is the file's new
-- "address" in R2 storage — exactly the role drive_file_id played for Google
-- Drive. During migration a row may have BOTH (old Drive id + new R2 key);
-- the serving code prefers r2_key and falls back to Drive when it's null, so
-- nothing disconnects while files are being copied over.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS r2_key TEXT;

CREATE INDEX IF NOT EXISTS documents_r2_key_idx
  ON public.documents (r2_key) WHERE r2_key IS NOT NULL;
