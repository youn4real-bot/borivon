-- "Connect Google Calendar" — instant push (Borivon → the user's Google).
--
-- Stores the per-user OAuth refresh token so the server can write Borivon events
-- straight into that user's Google calendar the moment they're created/edited/
-- deleted. One-way only; we never read the user's personal events.
--
-- Run once in the Supabase SQL editor. Service-role only (RLS on, no policy) —
-- the API reads/writes with the service key, gated by requireUser.

create table if not exists google_calendar_tokens (
  user_id       uuid        primary key references auth.users(id) on delete cascade,
  refresh_token text,                                   -- long-lived; the actual auth
  access_token  text,                                   -- short-lived cache
  expiry        timestamptz,                             -- access_token expiry
  google_email  text,                                    -- for the "Connected as …" label
  sees_all      boolean     not null default false,      -- true for the supreme admin (gets every event)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table google_calendar_tokens enable row level security;
