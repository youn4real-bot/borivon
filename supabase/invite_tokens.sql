-- Single-use invite tokens
-- org_id is nullable for standalone candidate invites (no org association)
create table if not exists invite_tokens (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references organizations(id) on delete cascade,  -- nullable: standalone candidate invites have no org
  type       text not null check (type in ('candidate', 'member')),
  code       text not null unique,
  used_by    uuid references auth.users(id) on delete set null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Index for fast code lookups
create index if not exists invite_tokens_code_idx on invite_tokens(code);

-- RLS: service role only (all operations go through API routes)
alter table invite_tokens enable row level security;
