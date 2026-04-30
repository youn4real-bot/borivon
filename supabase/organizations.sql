-- ──────────────────────────────────────────────────────────────────────────────
-- Organizations system
--
-- Adds the concept of "Organizations" (recruitment agencies, employers, etc.)
-- on top of the existing sub_admins infrastructure.
--
-- Three new tables:
--   organizations           — the orgs themselves, with a unique invite code
--   organization_members    — which sub_admins belong to which orgs (with a role)
--   candidate_organizations — which candidates are linked to which orgs (with status)
--
-- Backward-compatible: existing sub_admin_assignments rows continue to work.
-- A sub-admin can see a candidate via EITHER:
--   (a) a row in sub_admin_assignments (direct legacy assignment), OR
--   (b) being a member of an organization the candidate is approved-linked to.
-- ──────────────────────────────────────────────────────────────────────────────

-- ─── 1. organizations ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_invite_code ON public.organizations (invite_code);

-- ─── 2. organization_members ─────────────────────────────────────────────────
-- Links a sub_admin (by email) to an organization.
-- Role is 'member' (operational) or 'owner' (read-only board view, future).
CREATE TABLE IF NOT EXISTS public.organization_members (
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sub_admin_email TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'owner')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, sub_admin_email)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_email ON public.organization_members (sub_admin_email);

-- ─── 3. candidate_organizations ──────────────────────────────────────────────
-- Links a candidate (auth.users.id) to an organization.
-- Status is 'pending' (waiting for admin approval) or 'approved' (active).
-- 'rejected' is reserved for future use.
CREATE TABLE IF NOT EXISTS public.candidate_organizations (
  candidate_user_id UUID NOT NULL,
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'approved'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  added_by          TEXT NOT NULL DEFAULT 'admin'
                    CHECK (added_by IN ('admin', 'candidate', 'self_signup')),
  added_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at       TIMESTAMPTZ,
  approved_by       TEXT,
  PRIMARY KEY (candidate_user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_organizations_org    ON public.candidate_organizations (org_id);
CREATE INDEX IF NOT EXISTS idx_candidate_organizations_user   ON public.candidate_organizations (candidate_user_id);
CREATE INDEX IF NOT EXISTS idx_candidate_organizations_status ON public.candidate_organizations (status);
