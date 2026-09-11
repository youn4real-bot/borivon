-- ─────────────────────────────────────────────────────────────────────────────
-- Automatic document reminders — the log of who was emailed, when, and about what.
--
-- The daily job (/api/cron/doc-reminders) reads this to keep its promises:
-- at most one reminder a week and three in two months per candidate. Without
-- this table the job sends NOTHING (it cannot know who it already wrote to).
--
-- Service-role only (RLS on, no policies). Additive, safe to re-run.
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.candidate_reminders (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null,
  kind     text not null default 'documents',
  items    jsonb not null default '[]'::jsonb,
  sent_at  timestamptz not null default now()
);

create index if not exists candidate_reminders_user_idx
  on public.candidate_reminders (user_id, sent_at desc);

alter table public.candidate_reminders enable row level security;
