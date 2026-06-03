-- ─────────────────────────────────────────────────────────────────────────────
-- Per-agency vaccine requirement (drives the Impfung pipeline track).
--
-- Each organization (agency/employer) can declare how many doses its candidates
-- need: { "masern": N, "varizell": M }. Absent / all-zero ⇒ NO Impfung required
-- for that agency's candidates (they won't appear on the Impfung track) — many
-- employers require none, so this is optional by design.
--
-- Example: Calmaroi (works with UKSH) → 2× Masern + 2× Varizell.
--
-- ▶ Run this once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists vaccine_req jsonb not null default '{}'::jsonb;

-- Seed Calmaroi's known requirement (2× Masern + 2× Varizell). Safe to re-run;
-- only sets it if still the empty default, so a later manual edit isn't clobbered.
update public.organizations
   set vaccine_req = '{"masern":2,"varizell":2}'::jsonb
 where name ilike 'calmaroi' and vaccine_req = '{}'::jsonb;
