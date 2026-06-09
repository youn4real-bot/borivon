-- ─────────────────────────────────────────────────────────────────────────────
-- Live classroom (LiveKit) — the "data factory". Live German classes, nothing
-- recorded; we capture behavioural metadata only and roll it into a per-person
-- engagement profile for future employer matching.
--
--  classroom_sessions — one row per class instance (a LiveKit room).
--  classroom_events   — APPEND-ONLY telemetry ledger. Every signal, per person,
--                       timestamped: joined / left / camera_on / camera_off /
--                       spoke (with seconds) / exercise_action / hand_raise / …
--                       Score is COMPUTED from this ledger, never stored — same
--                       pattern as the Academy point_events design.
--
-- Supreme-admin only for now (testing). Opens to candidates later.
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.classroom_sessions (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default 'Live class',
  room_name    text not null unique,
  host_user_id uuid,
  status       text not null default 'live',   -- live | ended
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.classroom_events (
  id          bigint generated always as identity primary key,
  session_id  uuid references public.classroom_sessions(id) on delete cascade,
  room_name   text not null,
  user_id     uuid,                 -- the participant (LiveKit identity = user_id)
  display_name text,
  kind        text not null,        -- joined | left | camera_on | camera_off | spoke | exercise_action | hand_raise | mic_on | mic_off
  value       jsonb not null default '{}'::jsonb,  -- e.g. { "seconds": 12 } for spoke
  source      text not null default 'client',      -- client | webhook (server-verified)
  at          timestamptz not null default now()
);

create index if not exists idx_classroom_events_session on public.classroom_events (session_id);
create index if not exists idx_classroom_events_user    on public.classroom_events (user_id);
create index if not exists idx_classroom_events_kind    on public.classroom_events (kind);
create index if not exists idx_classroom_sessions_room  on public.classroom_sessions (room_name);
