-- ─────────────────────────────────────────────────────────────────────────────
-- Extends candidate_status (admin-only B2 reminders) with the richer
-- "B2 not complete" sub-flow:
--
--   B2 complete? → No
--     ├─ Wrote the exam?
--     │    ├─ YES → exam written date  +  expected results date
--     │    └─ NO  → expected exam date +  (registered & fees paid | waiting
--     │                                    for the website to open)
--
-- Old columns (b2_next_exam_date / b2_next_exam_confirmed) are kept for
-- back-compat; the UI no longer writes them. Still admin-only / RLS-locked.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR (additive — safe to re-run).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_status
  add column if not exists b2_exam_written          boolean,   -- true = wrote it, false = not yet, null = unset
  add column if not exists b2_exam_written_date      date,      -- when they sat the exam (b2_exam_written = true)
  add column if not exists b2_results_expected_date  date,      -- expected results date (b2_exam_written = true)
  add column if not exists b2_planned_exam_date      date,      -- expected date to write (b2_exam_written = false)
  add column if not exists b2_registration_status    text;      -- 'paid' (registered+fees paid) | 'waiting' (website not open yet) | null
