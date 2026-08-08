-- PARTNER API — let an outside agency (Calmaroi) pull a candidate's documents
-- straight into their own system, instead of the same files being uploaded by
-- hand into two portals.
--
-- THE SHAPE, and why:
--   * NOTHING is visible to a partner until the founder presses "Send to
--     <agency>" on that specific candidate. The button is the gate; the API is
--     only the pipe. There is no endpoint that lists "all candidates".
--   * A key is stored as a SHA-256 HASH, never in plain text. It is shown once,
--     at creation, and cannot be recovered — only replaced. A leaked database
--     backup therefore cannot be used to call the API.
--   * Every key belongs to exactly ONE organisation, so a key can only ever
--     reach candidates shared with THAT agency (LAW #25).
--   * Revoking is instant and keeps the row, so the audit trail survives.
--
-- Run this once in the Supabase SQL editor. Safe to re-run.

-- ── Keys issued to partner agencies ─────────────────────────────────────────
create table if not exists partner_api_keys (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  -- SHA-256 of the key. The key itself is never stored.
  key_hash      text not null unique,
  -- First 8 chars of the key, shown in the admin list so a key can be told
  -- apart from another without revealing it ("bv_live_a1b2c3d4...").
  key_prefix    text not null,
  label         text not null default '',
  created_at    timestamptz not null default now(),
  created_by    text,
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

create index if not exists partner_api_keys_hash_idx on partner_api_keys (key_hash) where revoked_at is null;
create index if not exists partner_api_keys_org_idx  on partner_api_keys (org_id);

-- ── Which candidates have been deliberately shared, and with whom ───────────
-- One row per (candidate, agency). Un-sharing sets revoked_at rather than
-- deleting, so "who did we send this person to, and when" stays answerable.
create table if not exists partner_shares (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  candidate_user_id  uuid not null,
  shared_at          timestamptz not null default now(),
  shared_by          text,
  revoked_at         timestamptz
);

create unique index if not exists partner_shares_unique
  on partner_shares (org_id, candidate_user_id);
create index if not exists partner_shares_live_idx
  on partner_shares (org_id) where revoked_at is null;

-- ── Access log — what the partner actually fetched ──────────────────────────
-- Without this, "did Calmaroi ever download her passport?" is unanswerable.
-- Deliberately small: no request bodies, no bytes, just who/what/when.
create table if not exists partner_api_log (
  id                 bigserial primary key,
  key_id             uuid references partner_api_keys(id) on delete set null,
  org_id             uuid,
  at                 timestamptz not null default now(),
  path               text not null,
  candidate_user_id  uuid,
  document_id        uuid,
  status             int not null
);

create index if not exists partner_api_log_at_idx  on partner_api_log (at desc);
create index if not exists partner_api_log_org_idx on partner_api_log (org_id, at desc);

-- These tables are reached ONLY through the service-role key from server
-- routes, never from the browser, so RLS is enabled with no policy: that denies
-- every anon/authenticated request outright while the service role bypasses it.
alter table partner_api_keys enable row level security;
alter table partner_shares   enable row level security;
alter table partner_api_log  enable row level security;
