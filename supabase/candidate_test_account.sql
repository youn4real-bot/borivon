-- Test-account flag on candidate_profiles.
--
-- A test account (e.g. an internal account used to try out new features) should be
-- HIDDEN from every candidate count / list / roster / report so it never inflates
-- the founder's real numbers. The bot reads this in candidateRoster() (lib/assistantTools)
-- and excludes flagged rows; the setTestAccount tool toggles it. Until this runs, the
-- roster query falls back gracefully (nothing hidden). Additive + idempotent.
--
-- ▶ Run once in the Supabase SQL editor.
alter table public.candidate_profiles
  add column if not exists is_test_account boolean not null default false;
