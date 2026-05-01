-- CV builder draft persistence
-- Stores the candidate's CV builder state server-side so data is never
-- lost when localStorage is cleared, the browser crashes, or they switch devices.
ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS cv_draft JSONB;
