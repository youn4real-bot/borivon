-- Fix silent notification failures across both bells (candidate + admin).
--
-- Run this once in the Supabase SQL editor.
--
-- WHAT WAS BROKEN:
--   1. notifications.action CHECK allowed only ('approved','rejected'), but the
--      code inserts 'verified' (passport verified), 'placed' (org placement /
--      suggested match), and 'sign_request' (wizard slot setup, sign requests).
--      All three silently failed → candidate bell stayed empty.
--
--   2. notifications.doc_id was NOT NULL, but several flows correctly have no
--      doc to attach (placement to org, passport verification, interview pass/
--      fail). Every one of those inserts hit the NULL constraint and died.
--
--   3. admin_notifications.type CHECK allowed only ('signup','upload'), but
--      the code inserts 'doc-signed' (sign-request completed) and
--      'doc-uploaded' (wizard slot setup). Silent failures → admin bell never
--      lit up for those events.
--
-- Each route logs the failure but doesn't surface it, so the bug looked like
-- "notifications work for some events, not others" with no error visible.

-- ── notifications.action: expand allowed values ─────────────────────────────
alter table notifications drop constraint if exists notifications_action_check;
alter table notifications add constraint notifications_action_check
  check (action in ('approved', 'rejected', 'verified', 'placed', 'sign_request'));

-- ── notifications.doc_id: allow NULL for non-doc events ─────────────────────
alter table notifications alter column doc_id drop not null;

-- ── admin_notifications.type: expand allowed values ─────────────────────────
alter table admin_notifications drop constraint if exists admin_notifications_type_check;
alter table admin_notifications add constraint admin_notifications_type_check
  check (type in ('signup', 'upload', 'doc-signed', 'doc-uploaded'));
