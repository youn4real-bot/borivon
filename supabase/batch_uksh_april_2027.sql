-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the first tracked intake batch: "UKSH Kiel — April 2027".
-- Chain: Calmaroi (organizations) → UKSH Kiel (employers.agency_id → Calmaroi)
--        → this batch (employer_batches.employer_id → UKSH Kiel).
--
-- Idempotent: inserts only if the UKSH Kiel employer exists AND a batch with
-- this exact name doesn't already exist. Requires supabase/employers.sql (which
-- seeds the UKSH Kiel employer, slug='uksh_kiel') to have been run first.
--
-- ▶ Run once in the Supabase SQL editor to make the batch appear in the tracker.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.employer_batches (employer_id, name, seats, target_start, target_end, status)
select e.id, 'UKSH Kiel — April 2027', 12, '2027-04-01', '2027-04-30', 'open'
from public.employers e
where e.slug = 'uksh_kiel'
  and not exists (
    select 1 from public.employer_batches b where b.name = 'UKSH Kiel — April 2027'
  );
