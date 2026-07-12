-- ─────────────────────────────────────────────────────────────────────────────
-- app_settings — a tiny service-role key/value store for singleton app config
-- that isn't per-user and isn't worth an env var (env changes need a redeploy;
-- this is editable at runtime).
--
-- First use: `candidates_sheet_id` — the Google Spreadsheet the candidate mirror
-- writes into. The bot creates the sheet on first sync and stores its id here so
-- every later sync reuses the same sheet instead of spawning a new one.
--
-- RLS ENABLED, no policies → service-role only (the API/bot routes). No
-- anon/authenticated access path exists.
--
-- ▶ Run once in the Supabase SQL editor (required before the Google-Sheet sync works).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
-- No policies on purpose: service-role only. Bypassed by service role, blocked for all else.
