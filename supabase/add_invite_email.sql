-- Optional email binding for single-use invite tokens.
--
-- A `member` / `sub-admin` invite grants org-admin (full org-dossier
-- visibility, LAW #25) + the gold "verified" tick. Until now a single-use
-- token wasn't tied to a person — whoever opened the link first got the
-- role. Binding lets the supreme admin lock a sensitive org-admin invite to
-- exactly one email; redemption by any other account is refused.
--
-- Backward compatible: NULL = unbound = behaves exactly as before. Run this
-- in the Supabase SQL editor before deploying the invite-binding change.

alter table public.invite_tokens
  add column if not exists invited_email text;

-- Normalise comparisons (we store + match lower-cased, trimmed).
comment on column public.invite_tokens.invited_email is
  'If set, only an authenticated user whose email equals this (case-insensitive) may redeem the token. NULL = unbound (legacy behaviour).';
