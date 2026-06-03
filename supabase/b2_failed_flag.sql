-- ─────────────────────────────────────────────────────────────────────────────
-- B2 "failed once" flag — drives the persistent RED HALO on the pipeline map.
--
-- A candidate who fails B2 keeps b2_failed = true FOREVER (even while they move
-- through the stages again for a retake). On the map their avatar shows a red
-- outer halo + their current stage colour inside, so you always know they failed
-- before but are going for the exam again.
--
-- Independent of b2_stage (the linear stage). Cleared only if an admin unticks it.
--
-- ▶ Run this once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_profiles
  add column if not exists b2_failed boolean not null default false;
