-- Persist the candidate's per-field passport confirmation checkboxes so
-- they survive close/reopen AND sync live across devices (phone <-> laptop),
-- exactly like the passport data fields themselves.
--
-- Stored as a JSONB array of field keys, e.g. ["first_name","dob","sex"].
--
-- Run once in the Supabase SQL editor. Idempotent.

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS passport_confirmed_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
