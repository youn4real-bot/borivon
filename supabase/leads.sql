-- Homepage funnel leads (components/Funnel.tsx → /api/leads).
-- The old flow tried to write these into admin_notifications, whose `type`
-- CHECK constraint only allows signup/upload/doc-* — so every homepage lead
-- 500'd ("insert_failed") and was lost. This dedicated table stores every
-- funnel shape (person / org / work / general / fachkraefte) losslessly and
-- powers the admin "Leads" list.
--
-- ▶ Run this once in the Supabase SQL editor BEFORE homepage leads are saved.

create table if not exists leads (
  id          uuid        default gen_random_uuid() primary key,
  kind        text        not null default 'person',  -- person | org | work | general | fachkraefte | …
  email       text        not null,
  name        text        not null default '',
  phone       text        not null default '',
  message     text        not null default '',
  details     jsonb       not null default '{}',       -- kind-specific extras: level, company, service, format, field, sector, positions, city …
  created_at  timestamptz not null default now()
);

create index if not exists idx_leads_created_at on leads (created_at desc);
create index if not exists idx_leads_email      on leads (email);

-- Service-role only: the public endpoint writes with the service key and the
-- admin list reads with the service key (gated by requireAdminRole). No public
-- policy → RLS blocks any direct anon/auth client access.
alter table leads enable row level security;
