-- Saved candidate signature — stored as a base64 PNG data URI.
-- Run once in Supabase SQL editor.
ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS saved_signature TEXT;
