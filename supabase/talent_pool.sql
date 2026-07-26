-- THE POOL — the pipeline BEFORE the pipeline.
--
-- A nurse messages on WhatsApp. You do an onboarding call, show proof of visas,
-- and make her a CV and medical FOR FREE — whether she stays with you or not.
-- Months later a hospital calls with slots, and she remembers who treated her
-- well. That whole stretch had nowhere to live in the product: the funnel ladder
-- (screening -> interview1 -> interview2 -> passed) only starts AT the interview,
-- and the Batch Tracker only shows people already placed in a batch.
--
-- A live count when this was written: 76 candidates, 17 in a batch — so 59
-- people, the MAJORITY of the database, were invisible on the board.
--
-- These four flags are the pre-batch journey. All four green = ready to offer a
-- hospital the day they call. Plain booleans the founder taps, deliberately NOT
-- derived from documents: "we made her a CV" is a decision he makes, not
-- something to infer from a row existing.
--
-- Additive + idempotent. The tracker is schema-tolerant: until this is run the
-- Pool still lists everyone, the steps just don't persist.
--
-- ▶ Run once in the Supabase SQL editor.

alter table public.candidate_pipeline
  add column if not exists pool_contacted     boolean not null default false,
  add column if not exists pool_call_done     boolean not null default false,
  add column if not exists pool_cv_done       boolean not null default false,
  add column if not exists pool_medical_done  boolean not null default false;

-- Hot path: "who in the pool is ready?" — batch_id is null for pool members.
create index if not exists candidate_pipeline_pool_idx
  on public.candidate_pipeline (batch_id)
  where batch_id is null;
