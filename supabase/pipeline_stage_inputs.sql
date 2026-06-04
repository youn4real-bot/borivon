-- ─────────────────────────────────────────────────────────────────────────────
-- Pipeline stage inputs — fields the admin sets from the candidate PEEK on the
-- pipeline (the control center). Extends the existing candidate_pipeline table.
--
--   interview1_status / interview2_status  'pending' | 'passed' | 'failed'
--     (the existing single interview_status stays for back-compat; these split
--      the first vs second interview so each can be passed/failed independently)
--   visa_appt_date   date the embassy/visa appointment is booked for
--   housing_done     housing arranged (boolean)
--
-- flight_date, flight_info, visa_date already exist on candidate_pipeline.
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_pipeline
  add column if not exists interview1_status text,
  add column if not exists interview2_status text,
  add column if not exists visa_appt_date    date,
  add column if not exists housing_done       boolean,
  -- Last time an admin touched this candidate's pipeline (set by the PATCH route).
  -- Feeds the "no update in a week → lightning reminder" signal on the board.
  add column if not exists updated_at         timestamptz;
