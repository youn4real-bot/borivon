-- Update org_requirements for nursing niche
-- Adds bundesland, facility_type columns
-- start_date and notes stay, specialty/location kept for backward compat

ALTER TABLE org_requirements
  ADD COLUMN IF NOT EXISTS bundesland    TEXT,
  ADD COLUMN IF NOT EXISTS facility_type TEXT
    CHECK (facility_type IN ('Klinik', 'Altenheim', 'Ambulante Pflegedienst'));
