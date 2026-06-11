-- ─────────────────────────────────────────────────────────────────────────────
-- Confirm-first staging for AI writes. When the assistant is asked to CHANGE a
-- candidate's status ("X didn't pass the interview"), it does NOT write directly
-- — it stages the proposed write here and asks the admin to confirm. Only on an
-- explicit "yes" (a separate message) does it execute. This is required because
-- Telegram is stateless across webhook calls, so the pending write must live
-- server-side between the proposal and the confirmation.
--
-- owner_user_id = the admin who must confirm (the supreme admin / founder).
-- Rows auto-expire after 10 min (stale proposals can't be confirmed later).
-- RLS-locked, service-role only.
--
-- ▶ Run once in the Supabase SQL editor (required before AI status-writes work).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.assistant_pending_actions (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null,
  tool_name         text not null,          -- e.g. 'setInterviewResult'
  args              jsonb not null,          -- validated, already scope-checked payload
  candidate_user_id uuid,                    -- for a serve-time canActOnCandidate re-check
  summary           text not null,           -- human line shown for confirmation
  status            text not null default 'pending'
                      check (status in ('pending','confirmed','cancelled','expired')),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '10 minutes')
);

create index if not exists assistant_pending_actions_owner_idx
  on public.assistant_pending_actions (owner_user_id, status, created_at desc);

alter table public.assistant_pending_actions enable row level security;
-- No policies: service-role only (the assistant stages/executes, filtered by owner).
