-- ─────────────────────────────────────────────────────────────────────────────
-- B2 sub-journey: a single stage field on each candidate that moves through the
-- B2 mini-roadmap (searching → studying → registered → booked & paid → awaiting
-- result → partial [loops back to booked] → passed).
--
-- Replaces the old single b2_passed journey checkbox with a richer status. The
-- old rows had 0 ticked done (verified), so nothing is lost; we still backfill
-- anyone already marked passed.
--
-- ▶ Run this once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_profiles
  add column if not exists b2_stage text not null default 'not_started';

-- Backfill: any candidate whose old b2_passed milestone was ticked → 'passed'.
update public.candidate_profiles p
   set b2_stage = 'passed'
  from public.candidate_journey_items j
 where j.candidate_user_id = p.user_id
   and j.preset_key = 'b2_passed'
   and j.done = true
   and p.b2_stage = 'not_started';
