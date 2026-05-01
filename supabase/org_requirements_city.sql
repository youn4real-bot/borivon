-- Add city column to org_requirements
-- Run this after org_requirements_v2.sql

ALTER TABLE org_requirements
  ADD COLUMN IF NOT EXISTS city TEXT;
