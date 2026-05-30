-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor.
--
-- Adds candidate_profiles.cover_letter_visa_body — the SEPARATE body of the
-- "Anschreiben Visum" letter (the visa cover letter to the German Embassy in
-- Rabat). It is NOT synced with the Essentials cover letter (cover_letter_body):
-- the visa letter has its own content, fixed recipient (Embassy Rabat) and a
-- fixed Betreff. Same editor / word budget / autosave as the Essentials letter.
--
-- TEXT (no column-level cap) — the /api/portal/letter-body route enforces the
-- ~6 KB hard cap, exactly like cover_letter_body.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS cover_letter_visa_body TEXT;
