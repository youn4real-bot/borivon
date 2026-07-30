-- Calendly-style booking: shareable per-audience links + pooled multi-host.
--
-- Two things at once, both additive:
--
--   1) EVENT TYPES — one shareable link per audience (/book/nurse, /book/clinic,
--      /book/company). Today the visitor has to pick "nurse / clinic / company"
--      themselves on step 1, so there is no link you can hand to a specific
--      company that just opens their flow. Each type can override the meeting
--      length and notice; every override is NULLABLE and NULL means "inherit the
--      global booking_availability row", so a type nobody has touched behaves
--      EXACTLY as the site does today.
--
--   2) HOSTS — whose calendar an appointment lands on. Only the founder's
--      calendar is used right now, and this changes nothing about that until a
--      second row is inserted. It exists now so adding a colleague later is a
--      row, not a rewrite. Availability is POOLED: a time is offered when ANY
--      active host is free, and the booking is assigned to one who is.
--
-- Safe to run more than once.

-- ─────────────────────────────── 1. hosts ──────────────────────────────────
create table if not exists public.booking_hosts (
  id           bigserial primary key,
  -- The Google Workspace account whose calendar is read for busy times and
  -- written to when a booking is made.
  email        text        not null,
  display_name text        not null,
  -- Google calendarId. 'primary' = that account's own calendar.
  calendar_id  text        not null default 'primary',
  -- The portal user, when the host is also an admin here. Nullable: a host can
  -- be a calendar that nobody logs in as.
  user_id      uuid,
  -- Inactive hosts are skipped by the pool but keep their historical bookings.
  active       boolean     not null default true,
  sort         int         not null default 0,
  created_at   timestamptz not null default now()
);

create unique index if not exists booking_hosts_email_uniq
  on public.booking_hosts (lower(email));

-- ──────────────────────────── 2. event types ───────────────────────────────
create table if not exists public.booking_event_types (
  -- The URL segment: /book/<slug>. This IS the link you hand out.
  slug             text primary key,
  -- Which question set + which lead classification. Constrained to the three
  -- the app knows how to ask questions for (lib/booking.ts QUESTIONS).
  kind             text        not null check (kind in ('nurse','clinic','company')),
  active           boolean     not null default true,
  sort             int         not null default 0,

  -- PER-TYPE OVERRIDES. NULL = inherit booking_availability. This is what makes
  -- "company calls are 45 minutes, candidate intros are 30" possible without
  -- touching the global config every audience shares.
  slot_minutes     int         check (slot_minutes     is null or slot_minutes     between 5 and 240),
  buffer_minutes   int         check (buffer_minutes   is null or buffer_minutes   between 0 and 120),
  min_notice_hours int         check (min_notice_hours is null or min_notice_hours between 0 and 720),
  horizon_days     int         check (horizon_days     is null or horizon_days     between 1 and 90),

  -- Display copy. NULL falls back to the built-in strings, so the three seeded
  -- types are fully usable with nothing filled in.
  title_en text, title_de text, title_fr text,
  blurb_en text, blurb_de text, blurb_fr text,

  created_at       timestamptz not null default now()
);

-- The three links that exist the moment this runs.
insert into public.booking_event_types (slug, kind, sort) values
  ('nurse',   'nurse',   1),
  ('clinic',  'clinic',  2),
  ('company', 'company', 3)
on conflict (slug) do nothing;

-- ─────────────────────── 3. bookings: host + type ──────────────────────────
alter table public.bookings add column if not exists host_id    bigint;
alter table public.bookings add column if not exists event_type text;

-- Double-booking protection, made host-aware.
--
-- The existing index is unique on starts_at alone, which is right for one
-- calendar and WRONG the moment there are two: it would stop a second host
-- being booked at a time the first is busy, which is the entire point of
-- pooling. Keying on (starts_at, host_id) fixes that.
--
-- coalesce(host_id, 0) matters: every existing row has host_id NULL, and in
-- Postgres NULLs are distinct in a unique index — so a plain (starts_at,
-- host_id) index would let TWO bookings be created at the same instant while no
-- hosts are configured, silently removing today's protection. Folding NULL to 0
-- keeps the current single-calendar behaviour byte-for-byte until a real host
-- row is assigned.
create unique index if not exists bookings_slot_host_unique
  on public.bookings (starts_at, coalesce(host_id, 0))
  where status <> 'cancelled';

drop index if exists bookings_slot_unique;
