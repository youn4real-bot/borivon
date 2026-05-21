-- Admin-only toggle: when FALSE the admin-generated CV ignores the
-- assigned agency's logo + footer and uses the plain Borivon template
-- instead. Default TRUE preserves the existing "agency branding on
-- admin CV" behavior for every existing candidate.
--
-- Lives next to passport columns so the CV generate route reads it in
-- the same SELECT as candidate_organizations / employer_id resolution.
-- Candidate side is unaffected — the candidate's own CV is always
-- Borivon (resolveBrand short-circuits when byAdmin === false).

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS cv_use_agency_branding BOOLEAN DEFAULT TRUE;
