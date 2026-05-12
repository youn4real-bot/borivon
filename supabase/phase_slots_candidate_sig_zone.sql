-- Candidate signature zone on phase slots.
--
-- When admin draws a "candidate signs here" box during the wizard, the zone
-- (page, x, y, w, h normalized 0..1) is stored here. On the candidate dashboard
-- the zone is rendered as a clickable "Sign here" overlay; clicking opens the
-- candidate's signature upload/use-saved flow and the signature is embedded
-- into the final PDF at submit time.
--
-- Run once in Supabase SQL editor.

ALTER TABLE public.phase_slots
  ADD COLUMN IF NOT EXISTS candidate_signature_zone JSONB;
