-- Calendar events: tagged attendees (replaces the Everyone/VIP dropdown).
-- An admin can tag specific people on an event — any candidate, sub-admin, or
-- org admin. Semantics:
--   • attendee_ids EMPTY  → the event is public (everyone logged-in sees it).
--   • attendee_ids set     → ONLY those people (plus admins) see / can attend it.
--
-- ▶ Run this once in the Supabase SQL editor.

alter table calendar_events
  add column if not exists attendee_ids uuid[] not null default '{}'::uuid[];
