-- Rolling conversation memory for the Telegram assistant.
-- Each webhook call is stateless; this lets follow-ups ("give me THEIR B2 status")
-- resolve against the previous turns. Service-role only (RLS on, no policies).
-- The app is fail-safe: until this runs, the bot just behaves statelessly.

create table if not exists assistant_chat_turns (
  id            bigint generated always as identity primary key,
  owner_user_id uuid not null,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null,
  created_at    timestamptz not null default now()
);

-- Hot path: "recent turns for this admin, newest first".
create index if not exists assistant_chat_turns_owner_created_idx
  on assistant_chat_turns (owner_user_id, created_at desc);

alter table assistant_chat_turns enable row level security;
-- No policies → only the service-role key (server) can read/write. Candidates
-- never touch this table.

-- Optional housekeeping: prune turns older than 30 days. Safe to run anytime,
-- or schedule via pg_cron if available. The 6-hour session window in app code
-- already bounds what's ever loaded.
-- delete from assistant_chat_turns where created_at < now() - interval '30 days';
