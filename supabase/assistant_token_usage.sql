-- AI token-usage log — powers the getApiUsage tool ("how many tokens did I use
-- today / this week / this month", rough $ estimate).
--
-- One tiny row per bot chat turn: the input/output token counts the model
-- reported. Pure integers + short text — negligible storage (NOT files), and we
-- prune anything older than 120 days. Usage only accrues from when this table
-- exists onward (historical Google billing lives in the Cloud console).
--
-- ▶ Run once in the Supabase SQL editor. Until it exists, logging is a silent
--   no-op and getApiUsage replies "not set up yet".
create table if not exists assistant_token_usage (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  model         text,                       -- 'flash' | 'pro' | model id
  source        text,                       -- 'telegram' etc.
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0
);

create index if not exists idx_assistant_token_usage_created on assistant_token_usage (created_at);

-- Service-role only (the bot writes with the service key). No public policy → RLS
-- blocks the client SDK entirely.
alter table assistant_token_usage enable row level security;
