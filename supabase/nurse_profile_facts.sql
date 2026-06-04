-- ─────────────────────────────────────────────────────────────────────────────
-- Nurse profile facts — the structured "what kind of nurse" data German
-- hospitals care about. Powers pipeline search/filter + the employer profile sheet.
--
--   nursing_specialty  stable key from lib/nurseSpecialties.ts (e.g. "intensive")
--   years_experience   whole years of nursing experience
--   current_workplace  free text (current hospital / ward, in Morocco)
--   available_from     date they can start in Germany
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_profiles
  add column if not exists nursing_specialty text,
  add column if not exists years_experience  integer,
  add column if not exists current_workplace text,
  add column if not exists available_from    date,
  -- Anerkennung (German diploma recognition) sub-journey stage. Linear, mirrors
  -- b2_stage. Keys come from lib/anerkennungJourney.ts. Default = not started.
  add column if not exists anerkennung_stage text;
