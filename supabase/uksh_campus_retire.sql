-- ─────────────────────────────────────────────────────────────────────────────
-- RETIRE the legacy `candidate_profiles.uksh_campus` column.
--
-- WHY:
--   The original UKSH-only design used a two-value enum ('kiel' | 'luebeck')
--   on `candidate_profiles.uksh_campus` to decide which UKSH address printed
--   on the candidate's Motivationsschreiben. That model didn't scale beyond
--   UKSH, so we replaced it with a proper FK:
--     candidate_profiles.employer_id  ──►  employers.id
--   `employers.slug` carries the stable lookup key ("uksh_kiel",
--   "uksh_luebeck", plus any future employer slugs).
--
--   All current application code reads `employer_id` exclusively. The legacy
--   `uksh_campus` branch in the letter-generate + me/employer routes has been
--   removed in the same change as this migration. The column is now
--   dead-code; this script makes the schema match.
--
-- WHAT THIS SCRIPT DOES:
--   Step A — BACKFILL: for any candidate whose `uksh_campus` is still set
--     but whose `employer_id` is NULL, copy the campus across to the FK by
--     looking up the matching slug in `employers`. After this step every
--     previously assigned candidate has an employer_id.
--   Step B — DROP: removes the `uksh_campus` column entirely.
--
-- SAFETY:
--   • Idempotent — re-running is a no-op once the column is gone.
--   • Uses IF EXISTS on the DROP so it can be applied twice without error.
--   • Reads `employers.slug` so this also works in any environment where the
--     UUID of the employers row differs.
--   • Wrapped in a transaction — rolls back on any error.
--
-- PREREQUISITES:
--   • `employers` table exists (created by supabase/employers.sql)
--   • Rows with slug 'uksh_kiel' and 'uksh_luebeck' already inserted
--   • Application code no longer reads `uksh_campus` (shipped together with
--     this migration)
--
-- HOW TO RUN:
--   Paste this whole file into Supabase → SQL Editor and click Run. The
--   transaction either applies cleanly or rolls back; there's no halfway
--   state.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Step A — Backfill `employer_id` from the legacy `uksh_campus` enum.
-- Only touches rows that still need it (employer_id IS NULL).
UPDATE candidate_profiles
   SET employer_id = (SELECT id FROM employers WHERE slug = 'uksh_kiel')
 WHERE uksh_campus = 'kiel'
   AND employer_id IS NULL;

UPDATE candidate_profiles
   SET employer_id = (SELECT id FROM employers WHERE slug = 'uksh_luebeck')
 WHERE uksh_campus = 'luebeck'
   AND employer_id IS NULL;

-- Step B — Drop the now-unused column. IF EXISTS keeps this idempotent.
ALTER TABLE candidate_profiles
  DROP COLUMN IF EXISTS uksh_campus;

COMMIT;
