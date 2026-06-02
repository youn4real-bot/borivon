-- ─────────────────────────────────────────────────────────────────────────────
-- Journey: split the single "Employer interview done" milestone into TWO —
--   interview_first   "First interview"
--   interview_second  "Second interview (final decision)"
-- and confirm B2 stays as a (now parallel) milestone.
--
-- Safe on live data: the old interview_done rows have 0 ticked done (verified),
-- so renaming the key loses no completion. The unique index
-- (candidate_user_id, preset_key) keeps everything idempotent. The seedPresets
-- upsert in the API will create interview_second for everyone on next load, but
-- we also backfill it here so the pipeline is correct immediately.
--
-- ▶ Run this once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Rename the existing single interview milestone → "first interview".
--    IDEMPOTENT: only rename when the candidate doesn't ALREADY have an
--    interview_first row (otherwise the unique (candidate, preset_key) index
--    collides on a re-run). Candidates who already have interview_first just
--    get their stale interview_done leftover deleted in step 1b.
update public.candidate_journey_items f
   set preset_key = 'interview_first',
       position   = 2,
       text       = 'First interview',
       updated_at = now()
 where f.preset_key = 'interview_done'
   and not exists (
     select 1 from public.candidate_journey_items x
      where x.candidate_user_id = f.candidate_user_id
        and x.preset_key = 'interview_first'
   );

-- 1b. Any interview_done left over (candidate already had interview_first) is a
--     duplicate from the old model — remove it.
delete from public.candidate_journey_items where preset_key = 'interview_done';

-- 2. Seed a "second interview" milestone for every candidate who now has a
--    first-interview row but no second one yet. position 3 slots it right after.
insert into public.candidate_journey_items
  (candidate_user_id, text, owner, preset_key, position, created_by)
select f.candidate_user_id,
       'Second interview (final decision)',
       'organization',
       'interview_second',
       3,
       'system'
  from public.candidate_journey_items f
 where f.preset_key = 'interview_first'
   and not exists (
     select 1 from public.candidate_journey_items s
      where s.candidate_user_id = f.candidate_user_id
        and s.preset_key = 'interview_second'
   );

-- 3. B2 is no longer a journey row — it became its own sub-journey on
--    candidate_profiles.b2_stage (see supabase/b2_stage.sql). Remove any old
--    b2_passed milestone rows so they don't linger on the rail.
delete from public.candidate_journey_items where preset_key = 'b2_passed';
