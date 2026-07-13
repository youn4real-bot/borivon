-- ─────────────────────────────────────────────────────────────────────────────
-- Whether the candidate signed the Borivon⇄candidate AGREEMENT — mandatory right
-- after Interview 1 and before Interview 2 (the commitment filter). A simple
-- yes/no on the pipeline, surfaced as the middle step in the Batch Tracker:
--   Interview 1  →  Agreement signed  →  Interview 2
--
-- ▶ Run once in the Supabase SQL editor. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_pipeline
  add column if not exists agreement_signed boolean;
