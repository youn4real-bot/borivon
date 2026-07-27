-- BOOKING, LEVELLED UP — self-service reschedule/cancel, booker reminders, and
-- availability the founder controls from the portal instead of from the code.
--
-- ▶ Run once in the Supabase SQL editor. Safe to re-run.
-- Requires supabase/bookings.sql to have been run first.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Self-service management + booker reminders
-- ─────────────────────────────────────────────────────────────────────────────

-- The token in the "reschedule or cancel" link we email the person who booked.
-- Unguessable (32 random bytes, base64url) and it is the ONLY credential on the
-- public manage page — so it must be unique, and a cancelled booking keeps its
-- token so the same link can explain what happened instead of 404ing.
alter table public.bookings add column if not exists manage_token text;
create unique index if not exists bookings_manage_token_key
  on public.bookings (manage_token) where manage_token is not null;

-- When we emailed the booker their day-before reminder. NULL = not yet sent.
-- The cron keys off this so a reminder can never go out twice.
alter table public.bookings add column if not exists reminded_at timestamptz;

-- Set when a booking is moved, so the admin list can show "was 14:00 Tue".
alter table public.bookings add column if not exists rescheduled_from timestamptz;

-- Partial index for the reminder sweep: only future, still-booked, not-yet-sent.
create index if not exists bookings_reminder_due_idx
  on public.bookings (starts_at)
  where reminded_at is null and status = 'booked';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Availability the founder owns
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Single row (id = true). Working hours, appointment length, buffer, how much
-- notice he needs, how far ahead people may book, and days off — all editable
-- from /portal/admin/bookings instead of hardcoded in lib/booking.ts.
--
-- `week` is weekday -> list of "HH:MM-HH:MM" windows, 0 = Sunday.
-- An absent or empty day means closed, which is how weekends work.
create table if not exists public.booking_availability (
  id                boolean     primary key default true check (id),
  week              jsonb       not null default
                      '{"1":["09:00-13:00","14:00-18:00"],
                        "2":["09:00-13:00","14:00-18:00"],
                        "3":["09:00-13:00","14:00-18:00"],
                        "4":["09:00-13:00","14:00-18:00"],
                        "5":["09:00-13:00","14:00-18:00"]}'::jsonb,
  slot_minutes      int         not null default 30  check (slot_minutes between 5 and 240),
  -- Breathing room on BOTH sides of anything already in the diary, so calls
  -- never run back-to-back with no gap to write notes.
  buffer_minutes    int         not null default 0   check (buffer_minutes between 0 and 120),
  -- Nothing bookable sooner than this. A slot 5 minutes away is a no-show.
  min_notice_hours  int         not null default 12  check (min_notice_hours between 0 and 720),
  horizon_days      int         not null default 14  check (horizon_days between 1 and 90),
  -- Days off as ["2026-08-15", …] in Casablanca time: holidays, Aïd, travel.
  blackout_dates    jsonb       not null default '[]'::jsonb,
  -- Turn the public page off entirely without deleting anything.
  accepting         boolean     not null default true,
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);

insert into public.booking_availability (id) values (true) on conflict (id) do nothing;

-- SERVICE-ROLE ONLY, same posture as `bookings`. The public page reads
-- availability through /api/book (service key), never with the anon key.
alter table public.booking_availability enable row level security;
