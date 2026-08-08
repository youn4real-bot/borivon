-- Collapse the document copies that piled up before uploads started retiring
-- their own predecessors.
--
-- A re-upload used to insert a new row and leave the old one live. The candidate
-- never saw it (the dashboard keeps only the newest per slot on the client), but
-- the admin review queue counts rows, so every re-upload added an orange badge
-- that could not be cleared.
--
-- Measured before this ran: 67 slots holding more than one live document, 147
-- redundant copies, one candidate with twelve live CVs, and 126 of the 181
-- documents awaiting review sitting in a duplicated slot.
--
-- SAFE BY CONSTRUCTION:
--   * DELETES NOTHING. Sets superseded_at only — the archive marker every live
--     list already hides (LAW #33). Nothing leaves R2, nothing leaves the table.
--   * Keeps the NEWEST row in every slot, so what is on screen does not change.
--   * SKIPS 'other'/Sonstiges, where several files are peers rather than
--     versions of one another.
--   * Idempotent: re-running changes nothing once each slot holds one live row.
--
-- Preview first, apply second, and there is an undo at the bottom.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PREVIEW — what would be archived. Run this on its own first.
-- ─────────────────────────────────────────────────────────────────────────────
with ranked as (
  select id, user_id, file_type, file_name, status, uploaded_at,
         row_number() over (
           partition by user_id, file_type
           order by uploaded_at desc nulls last, id desc
         ) as rn
  from documents
  where superseded_at is null
    and coalesce(file_type, '') not in ('other', 'Sonstiges', 'Autre', 'Other')
)
select file_type,
       count(*)                       as would_archive,
       count(*) filter (where status = 'pending') as of_which_pending
from ranked
where rn > 1
group by file_type
order by would_archive desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. APPLY — archive every copy except the newest in each slot.
-- ─────────────────────────────────────────────────────────────────────────────
with ranked as (
  select id,
         row_number() over (
           partition by user_id, file_type
           order by uploaded_at desc nulls last, id desc
         ) as rn
  from documents
  where superseded_at is null
    and coalesce(file_type, '') not in ('other', 'Sonstiges', 'Autre', 'Other')
)
update documents d
set    superseded_at = now()
from   ranked r
where  d.id = r.id
  and  r.rn > 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VERIFY — expect zero rows. Every slot now holds exactly one live document.
-- ─────────────────────────────────────────────────────────────────────────────
select user_id, file_type, count(*) as live_copies
from   documents
where  superseded_at is null
  and  coalesce(file_type, '') not in ('other', 'Sonstiges', 'Autre', 'Other')
group  by user_id, file_type
having count(*) > 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- UNDO — puts every row archived by step 2 back. Only safe to run immediately
-- afterwards: it clears any superseded_at stamped in the last hour, which would
-- also revive genuine archives made in that window.
-- ─────────────────────────────────────────────────────────────────────────────
-- update documents set superseded_at = null
-- where superseded_at > now() - interval '1 hour';
