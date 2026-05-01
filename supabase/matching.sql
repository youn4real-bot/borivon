-- ── Matching system migration ────────────────────────────────────────────────
-- Run this in the Supabase SQL editor once.

-- 1. placement_ready flag on candidate_profiles
ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS placement_ready BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Org requirements — what each org is looking for
CREATE TABLE IF NOT EXISTS org_requirements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  specialty   TEXT,
  slots       INTEGER NOT NULL DEFAULT 1,
  location    TEXT,
  start_date  DATE,
  notes       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Suggested matches — system-generated candidate → org suggestions
CREATE TABLE IF NOT EXISTS suggested_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_user_id UUID NOT NULL,
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requirement_id    UUID REFERENCES org_requirements(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'skipped'
  suggested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  decided_by        TEXT,
  UNIQUE(candidate_user_id, org_id)
);
