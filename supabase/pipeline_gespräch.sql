-- Add Gespräch (interview) fields + new journey stage flags to candidate_pipeline
ALTER TABLE candidate_pipeline
  ADD COLUMN IF NOT EXISTS interview_type    text,          -- 'video' | 'phone' | 'in-person'
  ADD COLUMN IF NOT EXISTS interview_notes   text,          -- internal, never exposed to candidate
  ADD COLUMN IF NOT EXISTS integration_unlocked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS start_unlocked       boolean DEFAULT false;
