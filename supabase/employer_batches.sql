-- ════════════════════════════════════════════════════════════════════════════
-- THE BATCH BOARD — employer intake batches + per-candidate funnel stage.
-- ════════════════════════════════════════════════════════════════════════════
-- Why: employers (e.g. UKSH) take candidates in MONTHLY-ish BATCHES (~10 every
-- ~3 months). Until now there was no way to track which candidate is assigned to
-- which intake, where they are in the sales funnel, or who's gone cold while
-- WAITING between interviews (the #1 cause of drop-out after assignment).
--
-- This adds:
--   • employer_batches — one row per intake (UKSH — Q2 2026, 10 seats, window).
--   • candidate_pipeline.batch_id    — which batch this candidate is assigned to.
--   • candidate_pipeline.funnel_stage — where they are on the funnel ladder.
--   • candidate_pipeline.last_touch_at — when we last warmed them (retention).
--
-- Idempotent + additive — safe to run on prod as-is. RUN THIS in the Supabase
-- SQL editor before the Batch Board features go live (the code is fail-safe and
-- treats the columns/table as empty until you run it).

create table if not exists employer_batches (
  id          uuid primary key default gen_random_uuid(),
  employer_id uuid references employers(id) on delete set null,
  name        text not null,                  -- "UKSH — Q2 2026"
  seats       integer not null default 10,    -- target headcount for this intake
  target_start date,                          -- expected intake-window start (nullable = TBD)
  target_end   date,
  status      text not null default 'open',   -- open | closed
  notes       text,
  created_at  timestamptz not null default now()
);

-- Per-candidate batch + funnel position (lives on the existing pipeline row).
alter table candidate_pipeline add column if not exists batch_id uuid references employer_batches(id) on delete set null;
alter table candidate_pipeline add column if not exists funnel_stage text;       -- funneling|screening|interview1|waiting_2nd|interview2|passed|departed
alter table candidate_pipeline add column if not exists last_touch_at timestamptz; -- last time we warmed this candidate (retention signal)

create index if not exists idx_candidate_pipeline_batch  on candidate_pipeline(batch_id);
create index if not exists idx_candidate_pipeline_funnel on candidate_pipeline(funnel_stage);
create index if not exists idx_employer_batches_status   on employer_batches(status);

-- Service-role only (the app uses the service client; no anon RLS policies — same
-- as the other admin-managed tables). RLS on, no policy = locked to service role.
alter table employer_batches enable row level security;
