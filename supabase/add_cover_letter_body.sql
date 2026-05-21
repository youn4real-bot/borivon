-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor.
--
-- Adds candidate_profiles.cover_letter_body — server-persisted cover-letter
-- HTML (the contentEditable body of the Motivationsschreiben page). Replaces
-- the previous localStorage-only persistence so:
--   1) candidate edits survive across devices (phone → laptop)
--   2) admins can edit a candidate's letter from /portal/motivationsschreiben
--      ?candidate=<uid> with last-write-wins parity to the candidate
--
-- TEXT (no length cap at the column level) — the route enforces the
-- ~6 KB hard cap that mirrors the editor's MAX_WORDS=320 budget.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS cover_letter_body TEXT;
