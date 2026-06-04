-- ─────────────────────────────────────────────────────────────────────────────
-- Candidate self-reports — candidates log their own milestones (passed/didn't
-- pass B2, passed/scheduled an interview, or a free note) so admins don't have
-- to chase and enter everything by hand. Surfaced in the admin pipeline peek;
-- a "didn't pass B2" also flips candidate_profiles.b2_failed = true.
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.candidate_self_reports (
  id                uuid primary key default gen_random_uuid(),
  candidate_user_id uuid not null,
  kind              text not null,   -- 'b2' | 'interview' | 'other'
  outcome           text not null,   -- 'passed' | 'failed' | 'scheduled' | 'note'
  note              text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_self_reports_candidate
  on public.candidate_self_reports (candidate_user_id, created_at desc);
