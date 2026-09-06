-- ─────────────────────────────────────────────────────────────────────────────
-- Affiliate / referral program.  RUN ONCE IN THE SUPABASE SQL EDITOR.
--
-- Model (founder's choices):
--   • Affiliates are ADMIN-APPROVED (created in /portal/admin/affiliates).
--   • Each affiliate has a PUBLIC share code (link: borivon.com/r/<code>) and a
--     PRIVATE dashboard token (only its sha256 hash is stored) for their
--     no-login stats page at affiliates.borivon.com/<token>.
--   • A referred nurse earns the affiliate a FIXED € amount when she ARRIVES in
--     Germany (candidate_pipeline.arrived_done = true).
--   • The system only TRACKS what is owed; the admin pays out manually and marks
--     each earning paid. No money ever moves through the app.
--
-- Service-role only: RLS is ON with no policy, so the anon/authenticated keys can
-- never read these tables — every access goes through the server (service key).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.affiliates (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,           -- public ref code in /r/<code>
  dash_token_hash text unique not null,           -- sha256(private dashboard token)
  name            text not null,                  -- affiliate display name
  email           text,                           -- contact (payout coordination)
  phone           text,                           -- contact (WhatsApp)
  user_id         uuid,                           -- optional link to an auth user (self-referral guard)
  commission_eur  numeric not null default 0,     -- fixed € paid per successful placement
  currency        text not null default 'EUR',
  active          boolean not null default true,
  clicks          integer not null default 0,     -- vanity counter (approximate)
  notes           text,
  created_by      text,                           -- admin email
  created_at      timestamptz not null default now()
);
create index if not exists affiliates_code_idx on public.affiliates(code);
create index if not exists affiliates_dash_idx on public.affiliates(dash_token_hash);

-- One earning per (affiliate, placed nurse). Amount is SNAPSHOT at first
-- recognition; the unique constraint makes reconciliation idempotent so a
-- placement can never be double-credited.
create table if not exists public.affiliate_earnings (
  id                uuid primary key default gen_random_uuid(),
  affiliate_id      uuid not null references public.affiliates(id) on delete cascade,
  candidate_user_id uuid not null,
  amount_eur        numeric not null default 0,
  status            text not null default 'owed',   -- 'owed' | 'paid' | 'void'
  placed_at         timestamptz not null default now(),
  paid_at           timestamptz,
  note              text,
  unique (affiliate_id, candidate_user_id)
);
create index if not exists affiliate_earnings_aff_idx on public.affiliate_earnings(affiliate_id);

-- Attribution: which affiliate referred this candidate (first-touch wins).
alter table public.candidate_profiles
  add column if not exists referred_by_affiliate uuid;

-- Attribution captured earlier, at the homepage lead stage.
alter table public.leads
  add column if not exists ref_code text;

alter table public.affiliates        enable row level security;
alter table public.affiliate_earnings enable row level security;
