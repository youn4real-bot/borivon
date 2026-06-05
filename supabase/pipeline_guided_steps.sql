-- ─────────────────────────────────────────────────────────────────────────────
-- Guided pipeline peek — the admin opens a candidate and answers ONE question at
-- a time ("Passed the first interview? → when was it? → next milestone"). Every
-- milestone now advances through a single candidate_pipeline PATCH, so these
-- columns back the steps that previously had no pipeline field of their own.
--
--   interview1_date / interview2_date   when the interview was / is scheduled
--   contract_done       employment contract sealed            (→ contract_signed)
--   recognition_done    Anerkennung approved by the authority (→ recognition_submitted)
--   vorab_done          Vorabzustimmung issued                (→ vorabzustimmung)
--   docs_ready          all papers gathered for the embassy   (→ docs_collected)
--   arrived_done        landed in Germany                     (→ arrived)
--
-- The board's autoDone derivation (app/api/portal/journey/pipeline) maps each of
-- these to its journey preset, so ticking it here moves the candidate on the map.
-- interview1/2_status, visa_appt_date, flight_date/info, housing_done, visa_granted
-- already exist (see pipeline_stage_inputs.sql + the base table).
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_pipeline
  add column if not exists interview1_date  date,
  add column if not exists interview2_date  date,
  add column if not exists contract_done    boolean,
  add column if not exists recognition_done boolean,
  add column if not exists vorab_done       boolean,
  add column if not exists docs_ready       boolean,
  add column if not exists arrived_done     boolean;
