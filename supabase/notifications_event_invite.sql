-- Calendar event-invite notifications.
--
-- When the supreme admin creates (or edits) a calendar event and TAGS people,
-- each tagged person gets a per-candidate notification (the bell). These rows
-- use action='event_invite', so the existing CHECK has to allow it.
--
-- The candidate NEVER sees who individually created the event — the bell shows
-- the masked sender "Borivon" (the organisation), never an admin's name. The
-- masking lives in the UI (components/NotificationBell.tsx); this migration only
-- widens the allowed action set.
--
-- Idempotent: drops the old constraint (whatever its current set) and re-adds it
-- with 'event_invite' included. Safe to run multiple times.
--
-- ▶ Run this once in the Supabase SQL editor.

alter table notifications drop constraint if exists notifications_action_check;

alter table notifications add constraint notifications_action_check
  check (action in ('approved', 'rejected', 'verified', 'placed', 'sign_request', 'event_invite'));
