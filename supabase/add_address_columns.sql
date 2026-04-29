-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor
-- Adds address + residence columns to candidate_profiles
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS address_street      TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS address_number      TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS address_postal      TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS city_of_residence   TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS country_of_residence TEXT DEFAULT NULL;
