-- Run once in Supabase → SQL Editor
-- Adds phone number to candidate_profiles

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT NULL;
