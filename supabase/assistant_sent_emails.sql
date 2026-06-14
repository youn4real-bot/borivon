-- ════════════════════════════════════════════════════════════════════════════
-- Sent-email memory for the bot — so "resend yesterday's email" actually works.
-- ════════════════════════════════════════════════════════════════════════════
-- Every email the bot sends on the admin's behalf (sendExternalEmail) is logged
-- here. The bot can then recall recent sends (listRecentSentEmails) and resend
-- one exactly (resendEmail) — recipient, subject, body, and the SAME CV
-- attachments. Without this the bot forgets what it sent the moment the chat
-- history window rolls (it was asking the founder to retype the whole email).
--
-- Idempotent + additive. Code is fail-safe (logging is best-effort; the tools
-- return empty / not_found until this is run), so sends keep working before it.
-- RUN THIS in the Supabase SQL editor.

create table if not exists assistant_sent_emails (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,                 -- the admin who sent it
  to_email      text not null,
  cc            text,                           -- comma-separated CC recipients
  subject       text not null,
  body          text not null,
  candidate_ids text,                           -- comma-separated candidate user_ids whose CV was attached
  doc_ids       text,                           -- comma-separated explicit document ids attached
  channel       text,                           -- gmail | resend
  sent_at       timestamptz not null default now()
);

create index if not exists idx_assistant_sent_emails_owner
  on assistant_sent_emails(owner_user_id, sent_at desc);

-- Service-role only (the app uses the service client; no anon RLS policy — same
-- posture as the other assistant_* tables). RLS on, no policy = locked down.
alter table assistant_sent_emails enable row level security;
