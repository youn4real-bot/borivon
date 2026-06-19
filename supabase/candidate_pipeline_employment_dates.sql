-- ─────────────────────────────────────────────────────────────────────────────
-- Two post-placement date milestones on candidate_pipeline.
--
--   • employment_start            — the candidate's first day at work (Arbeitsbeginn).
--   • residence_permit_appt_date  — their Aufenthaltstitel (residence-permit) appointment
--                                   (distinct from the entry-visa appointment, visa_appt_date).
--
-- The bot's setCandidateMilestone writes these (MILESTONE_DATE) — "set Khalid's first day
-- to Sept 1", "log the residence-permit appointment for Oct 10". Until this runs, those two
-- fields error as bad columns; the rest of setCandidateMilestone is unaffected.
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_pipeline
  add column if not exists employment_start           date,
  add column if not exists residence_permit_appt_date date;
