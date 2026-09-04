-- One-time, login-less upload links. An admin mints a link for a candidate +
-- specific missing docs; the candidate opens borivon.com/u/<token> and uploads
-- only those. The raw token is NEVER stored — only its sha256 hash. RLS-on /
-- no-policy locks the table to the service role (the anon key can never read it).
create table if not exists upload_links (
  id                uuid primary key default gen_random_uuid(),
  token_hash        text unique not null,          -- sha256(token); token itself never stored
  candidate_user_id uuid not null,                 -- the ONLY candidate this link can write to
  doc_keys          text[] not null,               -- the specific fileKeys allowed (consume rejects anything else)
  uploaded_keys     text[] not null default '{}',  -- which of doc_keys have been uploaded (retries + multi-doc)
  created_by        text,                           -- admin email
  expires_at        timestamptz not null default (now() + interval '7 days'),
  used_at           timestamptz,                    -- set once every requested doc is in → link dies
  revoked_at        timestamptz,                    -- admin kill-switch (consume treats non-null as 404)
  created_at        timestamptz not null default now()
);
create index if not exists idx_upload_links_hash on upload_links(token_hash);
create index if not exists idx_upload_links_candidate on upload_links(candidate_user_id);
alter table upload_links enable row level security;
