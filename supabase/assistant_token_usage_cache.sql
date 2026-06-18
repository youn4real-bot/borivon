-- Cache-aware token accounting (prompt caching, 2026-06-18).
--
-- The bot now runs on Claude with PROMPT CACHING on: the big static system+tools
-- prefix is sent once, then served from cache at ~0.1× on reuse. To price that
-- correctly (instead of charging the whole prefix at full rate, which would wildly
-- over-state cost), we record the cached-token split per turn.
--
-- Fully back-compatible: both columns are NOT NULL DEFAULT 0, so existing rows and
-- any code path that doesn't set them keep working. Until this runs, logUsage falls
-- back to writing just the base columns and cost reverts to a safe full-rate upper
-- bound (see lib/usage.ts).
--
-- ▶ Run once in the Supabase SQL editor (after assistant_token_usage.sql).
alter table assistant_token_usage add column if not exists cache_read_tokens  integer not null default 0;
alter table assistant_token_usage add column if not exists cache_write_tokens integer not null default 0;
