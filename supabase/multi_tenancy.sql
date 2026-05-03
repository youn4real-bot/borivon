-- Multi-tenancy: agency isolation
-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sub_admins ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id);
ALTER TABLE sub_admins ADD COLUMN IF NOT EXISTS is_agency_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id);
ALTER TABLE invite_tokens ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id);
