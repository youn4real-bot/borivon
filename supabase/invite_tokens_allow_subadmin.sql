-- Allow sub-admin invite tokens.
--
-- The original invite_tokens.type CHECK only permitted ('candidate','member'),
-- so /api/portal/admin/invite-sub-admin (type = 'sub-admin') failed at insert
-- — the "Generate" button for the Sub-admin Invitation Link did nothing.
-- Candidate + org-admin invites worked because their types were allowed.
--
-- Run once in the Supabase SQL editor. Idempotent.

alter table invite_tokens drop constraint if exists invite_tokens_type_check;

alter table invite_tokens add constraint invite_tokens_type_check
  check (type in ('candidate', 'member', 'sub-admin'));
