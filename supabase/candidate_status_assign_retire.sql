-- ─────────────────────────────────────────────────────────────────────────────
-- candidate_status_assign_retire.sql        (RUN IN SUPABASE SQL EDITOR)
-- ─────────────────────────────────────────────────────────────────────────────
-- Retires the four assignment-echo columns from `candidate_status`:
--
--   assign_type      ('agency' | 'employer' | null)
--   assign_agency    (agency key — type='agency')
--   assign_site      (site under the agency — type='agency')
--   assign_employer  (direct-employer key — type='employer')
--
-- Why retire them?
--   These were UI-state echoes written from the admin Status modal on every
--   pill click. They duplicated information that already lives in the
--   CANONICAL truth sources:
--
--     • candidate_profiles.employer_id   (the picked employer, direct or
--       via-agency; reverse-lookup the agency through employers.agency_id)
--     • candidate_organizations          (the approved agency link(s),
--       used everywhere else — brand resolution, CV branding, scope checks)
--
--   Keeping both copies meant every status save could drift from the real
--   assignment (e.g. assign_employer pointing at one row, employer_id at
--   another). With this migration the modal derives its highlighted pill
--   purely from the canonical sources — no echo, no drift.
--
-- Safe to re-run (DROP COLUMN IF EXISTS).
-- No data is read; if you need a historical dump first, snapshot
-- candidate_status BEFORE running this. The columns are gone for good
-- after a successful run.
--
-- Companion app changes (already shipped in code):
--   • app/api/portal/admin/candidate-status/route.ts — columns removed
--     from SELECT and from the UPSERT row.
--   • app/portal/admin/page.tsx — CandStatus type + EMPTY_STATUS no
--     longer carry assign_*. Assign tab derives the highlighted pill from
--     candidateOrgs[uid] + employerByUser[uid] + allEmployers[].
--   • supabase/candidate_status_assign.sql — kept as history; header
--     comment now marks it DEPRECATED.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_status
  drop column if exists assign_type,
  drop column if exists assign_agency,
  drop column if exists assign_site,
  drop column if exists assign_employer;
