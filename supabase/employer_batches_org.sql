-- ─────────────────────────────────────────────────────────────────────────────
-- UNIVERSAL: let any intake batch optionally carry the AGENCY (organization) it
-- runs through, alongside the employer. This is a capability, NOT a seed — you
-- create batches yourself from the Borivon portal (Batches / Batch Tracker) or
-- the Telegram bot, each with { name, date window, agency (org, optional),
-- employer (optional) }.
--
--   employer_batches.org_id  →  organizations(id)   (e.g. Calmaroi)
--   employer_batches.employer_id → employers(id)    (e.g. UKSH Kiel)  [already exists]
--
-- ▶ Run once in the Supabase SQL editor. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.employer_batches
  add column if not exists org_id uuid references public.organizations(id) on delete set null;

create index if not exists employer_batches_org_idx on public.employer_batches (org_id);
