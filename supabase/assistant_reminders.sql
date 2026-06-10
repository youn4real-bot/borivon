-- ─────────────────────────────────────────────────────────────────────────────
-- Admin AI assistant — personal reminders / task memory.
--
-- Lets the assistant "remember" things the admin types ("chase Youssef's
-- passport", "call the embassy Monday") and list/complete them later. These are
-- the ADMIN'S OWN notes (owner_user_id), NOT candidate data — the assistant
-- stays read-only on everything else. A reminder may optionally reference a
-- candidate (candidate_user_id) and carry a due_date.
--
-- RLS is ENABLED with no policies → only the service role (the assistant route)
-- can read/write, and every query filters by owner_user_id. No anon/authenticated
-- access path exists.
--
-- ▶ Run once in the Supabase SQL editor (required before the reminder feature works).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.assistant_reminders (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null,
  text              text not null,
  candidate_user_id uuid,
  due_date          date,
  done              boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists assistant_reminders_owner_idx
  on public.assistant_reminders (owner_user_id, done, due_date);

alter table public.assistant_reminders enable row level security;
-- No policies on purpose: service-role only (assistant route uses the service
-- client and filters by owner_user_id). Bypassed by service role, blocked for all else.
