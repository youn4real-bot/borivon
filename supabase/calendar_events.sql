-- Community calendar events (the "Calendar" tab) — FULL setup, idempotent.
-- Safe to run on a fresh DB OR a partial one: creates the table if missing,
-- and adds the attendee_ids column if the table already existed without it.
--
-- Every logged-in portal user can READ the calendar. Only the supreme admin
-- creates / deletes events (gated in the API by requireAdminRole → role==="admin").
--
-- attendee_ids: tagged people (any candidate / sub-admin / org admin).
--   • empty  → public event (everyone logged-in sees it).
--   • set    → only those people (+ admins) see / attend it.
--
-- ▶ Run this once in the Supabase SQL editor. (Supersedes calendar_attendees.sql.)

create table if not exists calendar_events (
  id           uuid        default gen_random_uuid() primary key,
  title        text        not null,
  description  text        not null default '',
  starts_at    timestamptz not null,                 -- event start (stored UTC)
  ends_at      timestamptz,                            -- optional end (stored UTC)
  image_url    text        not null default '',        -- optional cover (https:// or data:image/…)
  link_url     text        not null default '',        -- optional join link (Zoom/Meet/…)
  location     text        not null default '',        -- optional in-person location
  vip_only     boolean     not null default false,     -- legacy premium-lock (kept for back-compat)
  attendee_ids uuid[]      not null default '{}'::uuid[], -- tagged attendees (empty = public)
  created_by   uuid,                                    -- auth.uid of the admin who created it
  created_at   timestamptz not null default now()
);

-- If the table already existed from an earlier (pre-attendees) run, add the
-- column now. No-op when it's already there.
alter table calendar_events
  add column if not exists attendee_ids uuid[] not null default '{}'::uuid[];

create index if not exists idx_calendar_events_starts on calendar_events (starts_at desc);

-- Service-role only: the API reads/writes with the service key, gated by
-- requireUser (read) / requireAdminRole role==="admin" (write). No public
-- policy → RLS blocks the client SDK entirely.
alter table calendar_events enable row level security;
