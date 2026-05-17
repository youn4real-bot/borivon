-- Expand admin_notifications.type CHECK constraint to allow types added since
-- the original schema. Without this, code in /api/portal/admin/phase-slots/notify
-- and /api/portal/me/sign-requests/[id]/sign that tries to insert
-- 'doc-signed' or 'doc-uploaded' silently fails (the route swallows the error
-- and continues), so the admin bell never lights up for those events.
--
-- Run this once in the Supabase SQL editor.

alter table admin_notifications drop constraint if exists admin_notifications_type_check;

alter table admin_notifications add constraint admin_notifications_type_check
  check (type in ('signup', 'upload', 'doc-signed', 'doc-uploaded'));
