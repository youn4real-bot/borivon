-- ════════════════════════════════════════════════════════════════════════════
-- "Use my REAL Gmail signature" — read-only Gmail connection for the founder.
-- ════════════════════════════════════════════════════════════════════════════
-- Gmail's SMTP (App Password) can only SEND mail, not READ settings, so the bot
-- can't see the signature saved in Gmail settings. This stores a one-time OAuth
-- refresh token (read-only scope gmail.settings.basic) so the bot can pull the
-- EXACT signature (logo image + disclaimer) from Gmail and cache the HTML here,
-- then append it verbatim to outbound emails. No more hand-matched copy.
--
-- One row (the supreme admin). Reuses the EXISTING Google OAuth app
-- (GOOGLE_OAUTH_CLIENT_ID/SECRET — same as Calendar). Fail-safe: until this is
-- run + connected, outbound email falls back to the built-in signature, so
-- nothing breaks. RLS on, no policy → service-role only.
-- RUN THIS in the Supabase SQL editor.

create table if not exists gmail_signature_token (
  owner_user_id        uuid primary key,
  refresh_token        text,                  -- the offline grant (read-only gmail.settings.basic)
  access_token         text,
  expiry               timestamptz,
  google_email         text,                  -- which Gmail account is connected
  signature_html       text,                  -- the signature HTML pulled from Gmail, cached
  signature_fetched_at timestamptz,
  updated_at           timestamptz not null default now()
);

alter table gmail_signature_token enable row level security;
