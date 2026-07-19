-- ════════════════════════════════════════════════════════════════════════════
-- EMPLOYER SHORTLISTS — admin-curated candidate shortlists an employer can VIEW.
-- ════════════════════════════════════════════════════════════════════════════
-- Why: an admin (Borivon HQ or an agency org-admin) assembles a curated,
-- ordered subset of candidates for a specific employer/intake ("here are the 8
-- nurses I'm proposing for UKSH"). The employer opens a read-only link and sees
-- summary cards (name, photo, profession, city, B2, verified, doc-completeness)
-- — NEVER passport bytes, contact details, or raw documents.
--
-- This is SEPARATE from candidate_organizations on purpose: that table's
-- 'approved' status is the LAW #25 edit-scope trigger, so overloading it would
-- silently grant edit rights. A shortlist grants ZERO edit power — it's a
-- read-only view only.
--
-- Idempotent + additive — safe to run on prod as-is. RUN THIS in the Supabase
-- SQL editor before the shortlist features go live (the code treats the tables
-- as empty until you run it).

create table if not exists employer_shortlists (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references organizations(id) on delete cascade,  -- the AGENCY (scoping dimension); null = HQ-only
  employer_id  uuid references employers(id) on delete set null,     -- optional target employer
  title        text not null,                                        -- "UKSH Kiel — April 2027"
  note         text,                                                 -- shown atop the shared view
  status       text not null default 'draft',                        -- draft | shared
  share_token  text unique,                                          -- unguessable token for the read-only link
  created_by   text,                                                 -- admin email
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The curated, ordered candidate set. NOT candidate_organizations (see header).
create table if not exists shortlist_candidates (
  shortlist_id      uuid not null references employer_shortlists(id) on delete cascade,
  candidate_user_id uuid not null,
  position          integer not null default 0,
  admin_note        text,
  added_at          timestamptz not null default now(),
  primary key (shortlist_id, candidate_user_id)
);

create index if not exists idx_employer_shortlists_org   on employer_shortlists(org_id);
create index if not exists idx_employer_shortlists_token on employer_shortlists(share_token);
create index if not exists idx_shortlist_candidates_sl   on shortlist_candidates(shortlist_id);

-- Service-role only (the app uses the service client; no anon RLS policies — same
-- as employer_batches and the other admin-managed tables). RLS on + no policy =
-- locked to the service role, which every gated API route uses.
alter table employer_shortlists  enable row level security;
alter table shortlist_candidates enable row level security;
