-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor.  Depends on: uksh_campus.sql
--
-- CANONICAL employer model. A candidate is assigned ONE employer via
-- candidate_profiles.employer_id (FK → employers.id). An employer may
-- optionally belong to an agency (organizations.id) — "reached through agency"
-- vs "direct employer"; either way the candidate ends up with one employer.
-- The Motivationsschreiben recipient block + PDF read the address from here,
-- server-side only.
--
-- Scales without code changes: adding employer #3 … #100 = one INSERT.
-- Assigning a candidate = set candidate_profiles.employer_id (admin picker).
--
-- ── Add a new employer (direct) ─────────────────────────────────────────────
--   INSERT INTO public.employers (slug, name, address_lines) VALUES
--     ('charite_berlin','Charité Berlin',
--       ARRAY['Charité – Universitätsmedizin Berlin','Personalabteilung',
--             'Charitéplatz 1','10117 Berlin']);
--
-- ── Add an employer reached through an agency ───────────────────────────────
--   INSERT INTO public.employers (slug, name, address_lines, agency_id) VALUES
--     ('xyz_klinik','XYZ Klinik', ARRAY[...],
--       (SELECT id FROM public.organizations WHERE name = 'Calmaroi'));
--
-- ── Retire an employer without losing history ───────────────────────────────
--   UPDATE public.employers SET active = FALSE WHERE slug = '…';
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Employers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE,                   -- optional stable key (seed/backfill)
  name          TEXT NOT NULL,                 -- display name
  address_lines TEXT[] NOT NULL,               -- recipient block, one entry per line
  agency_id     UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE, -- offer for assignment?
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employers_active_idx ON public.employers (active);
CREATE INDEX IF NOT EXISTS employers_agency_idx ON public.employers (agency_id);

CREATE OR REPLACE FUNCTION public.employers_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employers_set_updated_at ON public.employers;
CREATE TRIGGER employers_set_updated_at
  BEFORE UPDATE ON public.employers
  FOR EACH ROW EXECUTE FUNCTION public.employers_touch_updated_at();

-- Seed the two UKSH campuses (idempotent — safe to re-run, edits preserved
-- except the canonical name/address which stay in sync with this file).
INSERT INTO public.employers (slug, name, address_lines)
VALUES
  ('uksh_kiel', 'UKSH Kiel',
   ARRAY['Universitätsklinikum Schleswig-Holstein','Campus Kiel',
         'Personalabteilung','Arnold-Heller-Straße 3','24105 Kiel']),
  ('uksh_luebeck', 'UKSH Lübeck',
   ARRAY['Universitätsklinikum Schleswig-Holstein','Campus Lübeck',
         'Personalabteilung','Ratzeburger Allee 160','23538 Lübeck'])
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, address_lines = EXCLUDED.address_lines;

ALTER TABLE public.employers ENABLE ROW LEVEL SECURITY;

-- 2. Canonical candidate → employer link ──────────────────────────────────────
ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS employer_id UUID
  REFERENCES public.employers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS candidate_profiles_employer_idx
  ON public.candidate_profiles (employer_id);

-- 3. Backfill from the old uksh_campus enum (one-time, idempotent) ─────────────
-- Existing Kiel/Lübeck assignments carry over to the new FK. uksh_campus is
-- left in place (deprecated, no longer written) so a rolling deploy can't
-- break; a later cleanup migration may drop it once nothing reads it.
UPDATE public.candidate_profiles cp
  SET employer_id = e.id
  FROM public.employers e
  WHERE cp.employer_id IS NULL
    AND cp.uksh_campus IS NOT NULL
    AND e.slug = CASE cp.uksh_campus
                   WHEN 'kiel'    THEN 'uksh_kiel'
                   WHEN 'luebeck' THEN 'uksh_luebeck'
                 END;
