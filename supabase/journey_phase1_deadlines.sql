-- ─────────────────────────────────────────────────────────────────────────────
-- Anerkennung / Visa Autopilot — Phase 1: deadlines + blocked state.
--
-- Upgrades the passive journey checklist into a deadline-tracked pipeline:
--   • due_date       — target date for a milestone (drives overdue detection)
--   • blocked        — this step is actively stuck (waiting on an authority, a
--                      missing doc, etc.) → shows RED on the pipeline board
--   • blocked_reason — short note on WHY it's stuck (Borivon/org only)
--
-- All nullable / defaulted, so existing rows + the seeding upsert are unaffected.
-- Idempotent — safe to run multiple times.
--
-- ▶ Run this once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_journey_items
  add column if not exists due_date       date,
  add column if not exists blocked        boolean not null default false,
  add column if not exists blocked_reason text;

-- Hot path: the pipeline board scans open (not-done) dated/blocked items.
create index if not exists idx_journey_due
  on public.candidate_journey_items (candidate_user_id, done, due_date);
