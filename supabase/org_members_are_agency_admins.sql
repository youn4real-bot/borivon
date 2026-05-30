-- ─────────────────────────────────────────────────────────────────────────────
-- Org people become ORG-SCOPED sub-admins.
--
-- Organization members now get the full Borivon admin dashboard (/portal/admin)
-- but scoped to ONLY their organization's approved candidates. The scope is
-- enforced two ways (belt-and-suspenders):
--   1. organization_members membership itself (canActOnCandidate /
--      getVisibleCandidateIds treat ANY org member as scoped), and
--   2. the sub_admins.is_agency_admin flag.
--
-- This backfill flips every existing organization member to is_agency_admin=true
-- so the flag matches the new model. (Even without it they'd be correctly
-- scoped by membership — this just keeps the data tidy and the flag honest.)
--
-- SAFE: the supreme admin (ADMIN_EMAIL) is never scoped — requireAdminRole short-
-- circuits role='admin' before any of this runs. Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

update public.sub_admins s
set is_agency_admin = true
where exists (
  select 1 from public.organization_members m
  where lower(m.sub_admin_email) = lower(s.email)
);
