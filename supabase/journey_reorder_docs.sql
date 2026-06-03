-- ─────────────────────────────────────────────────────────────────────────────
-- Reorder the journey rail: "Documents collected" is the VISA-READINESS gate
-- (all papers gathered, ready to deposit at the embassy), NOT the first step.
-- It moves to just before the visa appointment.
--
-- New positions (must match lib/candidateJourney.ts JOURNEY_PRESETS):
--   cv_finalized 0, interview_first 1, interview_second 2, contract_signed 3,
--   recognition_submitted 4, docs_collected 5 (renamed → "ready for embassy"),
--   visa_appointment 6, visa_approved 7, flight_booked 8, housing_arranged 9,
--   arrived 10.
--
-- Idempotent: re-running just re-sets the same positions/labels. Safe.
-- ▶ Run this once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

update public.candidate_journey_items set position = 0  where preset_key = 'cv_finalized';
update public.candidate_journey_items set position = 1  where preset_key = 'interview_first';
update public.candidate_journey_items set position = 2  where preset_key = 'interview_second';
update public.candidate_journey_items set position = 3  where preset_key = 'contract_signed';
update public.candidate_journey_items set position = 4  where preset_key = 'recognition_submitted';
update public.candidate_journey_items set position = 5  where preset_key = 'docs_collected';
update public.candidate_journey_items set position = 6  where preset_key = 'visa_appointment';
update public.candidate_journey_items set position = 7  where preset_key = 'visa_approved';
update public.candidate_journey_items set position = 8  where preset_key = 'flight_booked';
update public.candidate_journey_items set position = 9  where preset_key = 'housing_arranged';
update public.candidate_journey_items set position = 10 where preset_key = 'arrived';

-- Relabel the stored canonical English text for docs_collected (UI re-labels by
-- key per language, but keep the stored fallback meaningful).
update public.candidate_journey_items
   set text = 'Documents ready for embassy'
 where preset_key = 'docs_collected' and text = 'Documents collected';
