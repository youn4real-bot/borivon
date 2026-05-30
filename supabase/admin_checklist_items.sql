-- Manual admin checklists (NOT the auto document-progress one).
-- Each admin sees two lists in the UI:
--   • Shared   → shared among admins of the SAME org (org_id).
--                org_id NULL = the HQ/global list (supreme admin + org-less admins).
--   • Personal → private to one admin (owner_email).
-- Service-role only: the API authenticates + authorizes every call, so RLS is
-- ON with no public policy (the service-role key bypasses RLS).

create table if not exists public.admin_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('personal', 'shared')),
  owner_email text,                       -- personal items: owner (lowercased)
  org_id      uuid,                        -- shared items: the org (NULL = HQ/global)
  text        text not null,
  done        boolean not null default false,
  position    integer not null default 0,
  created_by  text,                        -- email of whoever added it
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_admin_checklist_personal
  on public.admin_checklist_items (owner_email) where scope = 'personal';
create index if not exists idx_admin_checklist_shared
  on public.admin_checklist_items (org_id) where scope = 'shared';

alter table public.admin_checklist_items enable row level security;
-- No policies on purpose — only the server (service-role) reads/writes this table.
