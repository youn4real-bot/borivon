-- Adds the second half of the per-candidate CV branding override:
--   • cv_use_agency_branding  (existing) — when TRUE and an agency is
--     assigned, the admin-side CV stamps the agency's logo + footer.
--     When FALSE, falls through to the next flag.
--   • cv_use_borivon_branding (this column) — when TRUE the admin-side
--     CV uses the default Borivon template. When FALSE the CV renders
--     with NO logo and NO footer at all ("plain text only" mode).
--
-- The two flags together model the three desired CV branding states:
--
--   agency-branding-on, borivon-on  →  Agency logo + footer  (default for
--                                       any candidate assigned to an
--                                       agency)
--   agency-off,         borivon-on  →  Plain Borivon CV
--   anything,           borivon-off →  No branding at all
--
-- Candidate-side CV is unaffected (always Borivon — resolveBrand short-
-- circuits when byAdmin === false).
--
-- Idempotent + safe to re-run.

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS cv_use_borivon_branding BOOLEAN DEFAULT TRUE;
