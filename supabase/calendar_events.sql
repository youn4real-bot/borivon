-- Community calendar events (the "Calendar" tab).
-- Every logged-in portal user can READ the calendar. Only the supreme admin
-- creates / deletes events (gated in the API by requireAdminRole → role==="admin").
-- VIP-only events are visible to everyone as a locked card, but their join
-- link + description are withheld server-side from non-premium candidates.
--
-- ▶ Run this once in the Supabase SQL editor BEFORE the Calendar tab works.

create table if not exists calendar_events (
  id          uuid        default gen_random_uuid() primary key,
  title       text        not null,
  description text        not null default '',
  starts_at   timestamptz not null,                 -- event start (stored UTC)
  ends_at     timestamptz,                           -- optional end (stored UTC)
  image_url   text        not null default '',       -- optional cover (https:// or data:image/…)
  link_url    text        not null default '',       -- optional join link (Zoom/Meet/…)
  location    text        not null default '',       -- optional in-person location
  vip_only    boolean     not null default false,    -- premium-locked event
  created_by  uuid,                                   -- auth.uid of the admin who created it
  created_at  timestamptz not null default now()
);

create index if not exists idx_calendar_events_starts on calendar_events (starts_at desc);

-- Service-role only: the API reads/writes with the service key, gated by
-- requireUser (read) / requireAdminRole role==="admin" (write). Deny anon/auth
-- direct access — no public policy, so RLS blocks the client SDK entirely.
alter table calendar_events enable row level security;
