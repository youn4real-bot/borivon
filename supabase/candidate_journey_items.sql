-- ─────────────────────────────────────────────────────────────────────────────
-- Per-candidate JOURNEY checklist (cross-party milestone board).
--
-- One list pinned to each candidate, shared across three parties:
--   • borivon       → the supreme org (you + your sub-admins / global staff)
--   • organization  → the partner org linked to the candidate (agency / employer
--                     / school). Org members see their own candidates only.
--   • candidate     → the nurse (sees only candidate-owned items).
--
-- `owner` tags who is responsible for an item. `preset_key` is set for the
-- auto-seeded milestone template (lib/candidateJourney.ts) and NULL for custom
-- items typed by Borivon / an org. The unique index makes preset seeding
-- idempotent (re-running the seed upsert is a no-op); NULLs are distinct so any
-- number of custom items per candidate is fine.
--
-- Service-role only: RLS is ON with NO policy. The /api/portal/journey route
-- authenticates + authorizes every call (party + scope per LAW #25) and uses
-- the service-role key, which bypasses RLS. The candidate's own anon client can
-- never read another candidate's list.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR BEFORE THE FEATURE GOES LIVE.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.candidate_journey_items (
  id                uuid primary key default gen_random_uuid(),
  candidate_user_id uuid not null references auth.users(id) on delete cascade,
  text              text not null,
  owner             text not null check (owner in ('borivon', 'organization', 'candidate')),
  done              boolean not null default false,
  done_by           text,                       -- email of whoever ticked it
  done_at           timestamptz,
  preset_key        text,                        -- non-null = seeded milestone; NULL = custom
  position          integer not null default 0,
  created_by        text,                        -- email (or 'system' for presets)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_journey_candidate
  on public.candidate_journey_items (candidate_user_id);

-- One row per preset per candidate → idempotent seeding. NULL preset_key
-- (custom items) are treated as distinct, so customs are unconstrained.
create unique index if not exists uq_journey_preset
  on public.candidate_journey_items (candidate_user_id, preset_key);

alter table public.candidate_journey_items enable row level security;
-- (No policies on purpose — only the server / service-role touches this.)
