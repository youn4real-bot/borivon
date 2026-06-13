-- Proactive-automation on/off switches, controllable from the Telegram bot
-- (listAutomations / setAutomation) so the founder can add & remove automations
-- over time without a code change.
--
-- Fail-safe: lib/automationSettings.ts returns the per-automation DEFAULTS when
-- this table is absent, so every automation already works before this migration
-- runs — the table only adds persistent on/off control. Run it when ready.
create table if not exists automation_settings (
  key        text primary key,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Service-role only (matches the other admin-owned tables): RLS on, no policy,
-- so only the server (service key) can read/write. The bot tools + crons use it.
alter table automation_settings enable row level security;
