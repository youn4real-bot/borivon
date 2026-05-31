-- Shared display order for the documents in a phase (currently the Visum
-- phase). Stores ONE ordered list of doc identifiers that BOTH the admin panel
-- and the candidate dashboard sort by — so when an admin drags the Visum docs
-- into a new order (fixed boxes AND added slots, interleaved freely), every
-- candidate sees that exact order too.
--
-- order_keys is a JSON array of identifiers:
--   • permanent doc boxes  → their stable key  (e.g. "versicherung", "langcert")
--   • dynamic phase slots  → their slot uuid
-- Any doc not present in the array falls back to its default position (appended
-- in code order), so new docs/slots appear without needing a write here.
--
-- ▶ Run this once in the Supabase SQL editor.

create table if not exists phase_doc_order (
  phase       text        primary key,                 -- 'visum' | 'bearbeitung'
  order_keys  jsonb       not null default '[]'::jsonb, -- ordered identifiers
  updated_at  timestamptz not null default now()
);

-- Service-role only: the candidate read + admin write both go through the API
-- (requireUser to read, requireAdminRole role='admin' to write). No public
-- policy → RLS blocks direct client access.
alter table phase_doc_order enable row level security;
