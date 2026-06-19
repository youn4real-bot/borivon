-- ─────────────────────────────────────────────────────────────────────────────
-- Telegram update de-duplication — stop DOUBLE replies.
--
-- Telegram RETRIES a webhook delivery if it doesn't get a fast 2xx. A heavy turn
-- (multi-tool model run) can take long enough that Telegram times out and re-sends
-- the SAME update — so the bot processed it twice and replied twice (the founder saw
-- duplicate answers all over the chat). Each update carries a unique update_id; we
-- claim it once here. A retry of the same update hits the primary-key conflict and
-- is dropped before any processing.
--
-- Fail-safe: if this table doesn't exist yet, the webhook's insert errors with a
-- "table not found" code (NOT a unique-violation), so it falls through and processes
-- normally — i.e. exactly today's behaviour until the migration runs.
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.telegram_updates (
  update_id   bigint primary key,
  created_at  timestamptz not null default now()
);

-- Service-role only (the webhook uses the service client). No anon/auth access.
alter table public.telegram_updates enable row level security;
