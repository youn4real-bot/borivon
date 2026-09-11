-- ─────────────────────────────────────────────────────────────────────────────
-- Fixes three database rules the 2026-09-11 Supabase bug hunt proved were
-- silently refusing real features. Additive + safe to re-run: every value
-- already stored stays allowed; nothing is deleted.
--
-- 1. notifications.action — the app writes 'follow_up' (admin "Send reminder"
--    + the bot's follow-up) and 'live_class' (live-class invite bell), but the
--    live CHECK only allowed approved/rejected/verified/placed/sign_request/
--    event_invite → every such insert failed (23514). Live: 0 rows of either.
-- 2. admin_notifications.type — 'org-join' / 'org-request' (a candidate joins
--    or asks to join an organisation) were refused the same way, so no admin
--    was ever told about a pending org request.
-- 3. assistant_commitments — the upsert names ON CONFLICT (owner_user_id,
--    source_message_id, what) but the only unique index is on
--    COALESCE(source_message_id, ''), which Postgres cannot match → every save
--    failed; the table has 0 rows. Make the column NOT NULL DEFAULT '' and add
--    the plain unique index the upsert expects (the code now writes '').
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.notifications drop constraint if exists notifications_action_check;
alter table public.notifications add constraint notifications_action_check
  check (action in ('approved', 'rejected', 'verified', 'placed', 'sign_request', 'event_invite', 'follow_up', 'live_class'));

alter table public.admin_notifications drop constraint if exists admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in ('signup', 'upload', 'doc-signed', 'doc-uploaded', 'org-join', 'org-request'));

update public.assistant_commitments set source_message_id = '' where source_message_id is null;
alter table public.assistant_commitments alter column source_message_id set default '';
alter table public.assistant_commitments alter column source_message_id set not null;
create unique index if not exists assistant_commitments_owner_src_what
  on public.assistant_commitments (owner_user_id, source_message_id, what);
