-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor
-- Adds passport_status tracking to candidate_profiles
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS passport_status TEXT DEFAULT NULL
  CHECK (passport_status IN ('pending', 'approved', 'rejected'));
