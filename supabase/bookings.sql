-- PUBLIC BOOKING — the Calendly-style "book a call with Borivon" page.
--
-- THREE audiences, one page — Borivon's two businesses:
--   • nurse   — a candidate who wants to work in Germany        (placement, supply)
--   • clinic  — a Gesundheitseinrichtung that needs nurses      (placement, demand)
--   • company — a business that wants German language training  (academy)
--
-- nurse and clinic are the two SIDES of the placement marketplace, so they are
-- deliberately separate kinds: a clinic booking is a high-value B2B lead and
-- must never be buried among candidate calls.
--
-- A booking creates a REAL Google Calendar event (with a Meet link, and Google
-- emails them the invite), a `leads` row so it lands in the existing funnel, and
-- follow-up reminders so nobody who books ever falls through the cracks — which
-- is the whole point: the calls are easy, the FOLLOW-UPS are where deals die.
--
-- ▶ Run once in the Supabase SQL editor.

create table if not exists public.bookings (
  id                bigserial primary key,
  -- who booked, and which conversation they want
  kind              text        not null check (kind in ('nurse','clinic','company')),
  name              text        not null,
  email             text        not null,
  phone             text,
  note              text,
  company           text,                       -- organisation name (clinic / company kinds)
  -- when (UTC instants; the picker works in Africa/Casablanca and converts)
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  -- the real Google Calendar event this created
  calendar_event_id text,
  meet_link         text,
  -- lifecycle. 'booked' → 'held' | 'no_show' | 'cancelled'
  status            text        not null default 'booked'
                      check (status in ('booked','held','no_show','cancelled')),
  outcome           text,                       -- free text after the call
  lead_id           bigint,                     -- the leads row created alongside
  -- HOW it got here. Plenty of people never touch the booking page — they agree
  -- a time over WhatsApp or on a call. Those still have to land in the system,
  -- because the follow-up chain is the whole point and it can't start from a
  -- conversation nobody recorded. 'admin' rows are created by hand in the portal.
  source            text        not null default 'public'
                      check (source in ('public','admin')),
  created_by        uuid,                       -- admin user_id when source='admin'
  created_at        timestamptz not null default now()
);

-- A slot can only be taken ONCE. This is the real double-booking guard: two
-- people hitting "book" on the same slot at the same moment can't both win,
-- because the second insert violates this index rather than relying on a
-- read-then-write check that races. Cancelled bookings free the slot again.
create unique index if not exists bookings_slot_unique
  on public.bookings (starts_at)
  where status <> 'cancelled';

-- Hot read: "what's coming up" and "what still needs following up".
create index if not exists bookings_upcoming_idx
  on public.bookings (starts_at desc);
create index if not exists bookings_status_idx
  on public.bookings (status, starts_at);
