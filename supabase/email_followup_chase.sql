-- Outbound email FOLLOW-UP chase. When the founder sends an external email, a row
-- lands here; a few times a day the bot checks whether the recipient replied — if
-- not, it reminds the founder to follow up (up to 8 times, ~every 12h), and
-- auto-resolves the moment they reply (or after the 8th nudge). Tiny TEXT/INT rows
-- only — no files. (Fresh table name; an older empty `email_followups` table is
-- left untouched.)
--
-- ▶ Run once in the Supabase SQL editor. Until it exists, recording + chasing are
--   silent no-ops (no spam, no crash).
create table if not exists email_followup_chase (
  id            bigint generated always as identity primary key,
  owner_user_id uuid        not null,
  to_email      text        not null,
  subject       text        not null default '',
  sent_at       timestamptz not null default now(),
  last_nudge_at timestamptz not null default now(),
  nudge_count   integer     not null default 0,
  done          boolean     not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_email_followup_chase_open on email_followup_chase (owner_user_id, done, last_nudge_at);

-- Service-role only (the bot reads/writes with the service key). No public policy.
alter table email_followup_chase enable row level security;
