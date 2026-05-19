-- ─────────────────────────────────────────────────────────────────────────────
-- Admin-only candidate STATUS reminders (starting with B2).
--
-- Strictly internal: ONLY supreme admin / sub-admins (via the server API,
-- which uses the service role) can read or write this. RLS is ENABLED with
-- NO policies → the candidate's own anon/JWT client can never select it.
-- The candidate gets nothing from this, ever.
--
-- Extensible: add more "status of X" columns here later (visa_*, medical_*,
-- …) — the same admin-only API/table covers them.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR BEFORE THE FEATURE GOES LIVE.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.candidate_status (
  user_id                 uuid primary key references auth.users(id) on delete cascade,

  -- B2 language status
  b2_complete             boolean,            -- true = has B2 certificate, false = not yet, null = unset
  b2_cert_date            date,               -- date of the B2 certificate (when b2_complete = true)
  b2_next_exam_date       date,               -- date of the next/planned B2 exam (when b2_complete = false)
  b2_next_exam_confirmed  boolean,            -- true = exam date confirmed, false = not yet confirmed, null = unset

  updated_at              timestamptz not null default now()
);

-- Lock it down: RLS on, ZERO policies → no anon/authenticated access at all.
-- Only the service-role key (used exclusively by the admin API routes) can
-- touch this table. Candidates / org members can never see it.
alter table public.candidate_status enable row level security;

-- (Intentionally no CREATE POLICY statements.)

comment on table public.candidate_status is
  'Admin-only internal reminders per candidate (B2 etc). RLS-locked: service role only. Candidate side never reads this.';
