-- ─────────────────────────────────────────────────────────────────────────────
-- Assistant memory — how the admin likes to work. Durable preferences, terms,
-- and corrections the assistant LEARNS from conversation and then applies on
-- every chat (loaded into its system prompt), so it gets more "yours" over time
-- WITHOUT any model fine-tuning. The admin can review ("what do you know about
-- me?") and prune ("forget that") — see the remember/recall/forget tools.
--
-- The admin's OWN notes (owner_user_id), not candidate data. RLS-locked,
-- service-role only.
--
-- ▶ Run once in the Supabase SQL editor (required before the memory feature works).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.assistant_memory (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  kind          text not null default 'preference', -- preference | fact | term | correction
  text          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists assistant_memory_owner_idx
  on public.assistant_memory (owner_user_id, created_at);

alter table public.assistant_memory enable row level security;
-- No policies: service-role only (assistant reads/writes it, filtered by owner_user_id).
