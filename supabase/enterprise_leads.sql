-- Enterprise (B2B) leads from the /v2 marketing site "Book a needs audit" form.
--
-- DELIBERATELY SEPARATE from everything candidate-related: this is its OWN table,
-- with NO link to candidates, candidate_profiles, the homepage `leads` funnel, or
-- any portal user. These are companies asking for German training for their teams.
-- The public endpoint (/api/v2/contact) writes here with the service-role key;
-- RLS has no public policy so anon/auth clients can never read it.
--
-- ▶ Run this ONCE in the Supabase SQL editor (before relying on stored leads).
--   Until it's run, the form still works: the founder still gets the Telegram
--   ping + email; only the DB row is skipped (logged, never 500s the form).

create table if not exists enterprise_leads (
  id          uuid        default gen_random_uuid() primary key,
  name        text        not null,
  email       text        not null,
  company     text        not null default '',
  role        text        not null default '',
  phone       text        not null default '',
  headcount   text        not null default '',   -- free text e.g. "15", "20-50"
  situations  text        not null default '',   -- where German is used (meetings, calls, clients…)
  message     text        not null default '',
  lang        text        not null default '',   -- fr | en | de | —
  source      text        not null default 'v2-contact',
  status      text        not null default 'new', -- new | contacted | won | lost (admin can update later)
  created_at  timestamptz not null default now()
);

create index if not exists idx_enterprise_leads_created_at on enterprise_leads (created_at desc);
create index if not exists idx_enterprise_leads_email      on enterprise_leads (email);

-- Service-role only. No public policy → RLS blocks any direct anon/auth access.
alter table enterprise_leads enable row level security;
