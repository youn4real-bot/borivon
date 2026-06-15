-- 6-hour "you haven't replied" email SLA — dedup table.
--
-- The intra-day SLA cron (/api/cron/inbox-sla) pings the founder about any inbound
-- email left unanswered for 6h+. This table remembers which emails it ALREADY
-- nudged about, so each one pings exactly ONCE (not on every run). Tiny TEXT rows
-- only — a sender + timestamp key, auto-pruned after 30 days. No files, no blobs.
--
-- ▶ Run this once in the Supabase SQL editor. Until it exists, the SLA cron stays
--   silent (fail-safe: it never spams when it can't dedupe).
create table if not exists inbox_sla_nudges (
  key        text        primary key,    -- "<sender>|<received-ISO>" — stable per message
  nudged_at  timestamptz not null default now()
);

create index if not exists idx_inbox_sla_nudges_at on inbox_sla_nudges (nudged_at);

-- Service-role only (the cron writes with the service key). No public policy → RLS
-- blocks the client SDK entirely.
alter table inbox_sla_nudges enable row level security;
