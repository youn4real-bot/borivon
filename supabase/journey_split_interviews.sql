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
--    Only touches rows that haven't already been migrated.
update public.candidate_journey_items
   set preset_key = 'interview_first',
       position   = 2,
       text       = 'First interview',
       updated_at = now()
 where preset_key = 'interview_done';

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

-- 3. Re-align the positions of the later milestones so the rail order is correct
--    (contract=4, recognition=5, … unchanged from the catalog; B2 moved to 99).
update public.candidate_journey_items set position = 99 where preset_key = 'b2_passed';
