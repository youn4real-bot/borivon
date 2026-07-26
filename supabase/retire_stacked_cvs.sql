-- ONE-TIME BACKFILL — retire the CVs that stacked up before the supersede fix.
--
-- WHY. publishCandidateCv() used to only INSERT: every "regenerate CV" added
-- another approved row and never retired the previous one. That was fixed in
-- code (it now stamps superseded_at on the older ones), but the fix only applies
-- to CVs generated FROM THAT POINT ON — the pile that had already accumulated
-- was never cleaned. A live probe of the production DB found:
--
--     86 live approved CV rows across 35 candidates
--     18 candidates holding 2-7 CVs each
--     51 of those rows are redundant
--
-- Nothing is visibly broken (every reader — the dashboard slot, the Drive
-- mirror's filename dedup, the email-attach query, sellable/journey checks —
-- already takes the newest), but it is exactly the "old copies left behind"
-- problem the founder asked to eliminate, and it is what feeds a stale CV into
-- the agency Drive folder if a candidate's NAME ever changed (a renamed CV has a
-- different filename, so dedup can't collapse it and BOTH get mirrored).
--
-- WHAT THIS DOES. Keeps the NEWEST CV per candidate and marks every older one
-- superseded. SOFT ONLY — sets a timestamp, deletes nothing, so it satisfies
-- LAW #33 and is fully reversible (see the undo at the bottom).
--
-- Safe to run twice: the second run matches nothing, because the rows it would
-- have targeted are no longer `superseded_at is null`.
--
-- ▶ Run once in the Supabase SQL editor.

-- OPTIONAL — preview first. Should report 18 candidates / 51 rows.
-- select count(*) as redundant_rows, count(distinct user_id) as candidates
-- from (
--   select id, user_id,
--          row_number() over (partition by user_id
--                             order by uploaded_at desc nulls last, id desc) as rn
--   from public.documents
--   where status = 'approved' and superseded_at is null
--     and file_type = 'Lebenslauf (DE)'
-- ) r where rn > 1;

with ranked as (
  select id,
         row_number() over (partition by user_id
                            order by uploaded_at desc nulls last, id desc) as rn
  from public.documents
  where status = 'approved'
    and superseded_at is null
    and file_type = 'Lebenslauf (DE)'
)
update public.documents d
   set superseded_at = now()
  from ranked r
 where d.id = r.id
   and r.rn > 1;

-- UNDO (only if something looks wrong — restores every CV retired by this run):
-- update public.documents
--    set superseded_at = null
--  where file_type = 'Lebenslauf (DE)'
--    and status = 'approved'
--    and superseded_at >= now() - interval '1 hour';
