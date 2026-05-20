-- One-time data setup: point Calmaroi's org row at its existing logo file
-- (public/logos/calmaroi-yellow.png) so every candidate assigned to an
-- employer with agency_id = Calmaroi auto-brands their CV + cover letter.
--
-- Branding resolution order in /api/portal/{cv,letter}/generate:
--   1) candidate_organizations link (legacy)
--   2) candidate.employer_id → employer.agency_id  ← used by via-Calmaroi
--
-- Run once in Supabase → SQL Editor.

UPDATE organizations
SET logo_filename = 'calmaroi-yellow.png'
WHERE LOWER(name) = 'calmaroi'
  AND (logo_filename IS NULL OR logo_filename = '');

-- Verify
SELECT id, name, logo_filename, footer_text FROM organizations WHERE LOWER(name) = 'calmaroi';
