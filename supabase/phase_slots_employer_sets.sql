-- ─────────────────────────────────────────────────────────────────────────────
-- Per-EMPLOYER fixed document sets for Bearbeitung / Visum.
--
-- A phase_slot can now be scoped at THREE levels (most specific wins):
--   employer_id set            → only candidates placed at that employer
--                                 (candidate_profiles.employer_id), e.g.
--                                 "Calmaroi → UKSH Lübeck". Reused for EVERY
--                                 candidate at that employer — define once,
--                                 they all get the same docs to sign/fill.
--   org_id set                 → all candidates of that organization.
--   both NULL                  → global default.
--
-- Resolution (server, /api/portal/phase-slots GET):
--   candidate's employer set  →  else their org set  →  else global.
-- Auto-applies: the moment a candidate's employer_id is set, that employer's
-- fixed set appears in their Bearbeitung/Visa phases — no per-candidate upload.
--
-- Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.phase_slots
  add column if not exists employer_id uuid references public.employers(id) on delete cascade;

create index if not exists phase_slots_employer_phase_pos
  on public.phase_slots (employer_id, phase, position);
