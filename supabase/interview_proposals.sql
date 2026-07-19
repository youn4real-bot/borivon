-- ════════════════════════════════════════════════════════════════════════════
-- INTERVIEW SELF-SCHEDULER — admin proposes times, candidate picks one.
-- ════════════════════════════════════════════════════════════════════════════
-- Flow: an admin offers 1–6 candidate interview time slots for round 1 or 2. The
-- candidate gets a bell notification, opens a picker on their dashboard, and taps
-- one. The pick writes the CONFIRMED date straight into candidate_pipeline
-- (interviewN_date + interviewN_date_confirmed=true) — so it flows into the Batch
-- Tracker and the critical-dates radar / daily briefing with no extra wiring.
--
-- Slots are stored as LOCAL wall-clock strings ("YYYY-MM-DDTHH:mm"), not
-- timestamptz — everyone means the same local time, no timezone drift.
--
-- No hard gate is added anywhere (LAW #32): this only RECORDS a chosen date; it
-- never blocks stage progression. Idempotent + additive — RUN in the Supabase SQL
-- editor before the feature goes live (the code treats the table as empty until
-- you run it).

create table if not exists interview_proposals (
  id                uuid primary key default gen_random_uuid(),
  candidate_user_id uuid not null,
  round             integer not null default 1,        -- 1 = first interview, 2 = second
  proposed_slots    text[]  not null default '{}',     -- ["2027-04-15T14:30", …] local wall-clock
  picked_slot       text,                              -- the chosen slot (null until picked)
  status            text    not null default 'proposed', -- proposed | picked | cancelled
  note              text,                              -- optional note shown to the candidate
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_interview_proposals_cand on interview_proposals(candidate_user_id, status);

-- Service-role only (no anon RLS policies — same as the other admin-managed
-- tables). The candidate-facing routes read/write via gated API routes that
-- self-scope to the caller's own user id.
alter table interview_proposals enable row level security;
