-- DEPRECATED 2026-05: column retired by uksh_campus_retire.sql. Keep this file for history; never re-apply.
-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor
-- UKSH campus assignment on candidate_profiles.
-- Admin-controlled: decides which UKSH address appears as the recipient on the
-- candidate's hospital Motivationsschreiben.
--   'kiel'   → Universitätsklinikum Schleswig-Holstein, Campus Kiel
--   'luebeck'→ Universitätsklinikum Schleswig-Holstein, Campus Lübeck
--   NULL     → not yet assigned
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS uksh_campus TEXT DEFAULT NULL
  CHECK (uksh_campus IN ('kiel', 'luebeck') OR uksh_campus IS NULL);
