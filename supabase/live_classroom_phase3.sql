-- Live classroom — Phase 3: open to candidates + GDPR consent + employer view.
-- Run AFTER supabase/live_classroom.sql. Safe to re-run (idempotent).

-- 1) Admin explicitly opens a class to candidates (default closed = admin-only).
alter table classroom_sessions
  add column if not exists open_to_candidates boolean not null default false;

-- 2) GDPR consent ledger — a candidate must actively agree before their
--    engagement data is captured/joined-in, and before it's shown to employers.
--    One row per user; revoked_at set = withdrawn (must re-consent to rejoin).
create table if not exists classroom_consent (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  version      text not null default 'v1-2026-06',
  consented_at timestamptz not null default now(),
  revoked_at   timestamptz,
  user_agent   text,
  unique (user_id)
);

create index if not exists idx_classroom_consent_user on classroom_consent(user_id);

-- Helps the candidate "is there a class for me right now?" lookup.
create index if not exists idx_classroom_sessions_open_live
  on classroom_sessions(status, open_to_candidates);
