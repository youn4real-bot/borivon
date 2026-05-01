-- Add member invite code to organizations
-- Candidate invite_code stays as-is (shared with candidates)
-- member_invite_code is for org admins (e.g. Calmaroi team member onboarding)

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS member_invite_code TEXT UNIQUE;

-- Generate unique member invite codes for all existing orgs
UPDATE organizations
  SET member_invite_code = LOWER(REPLACE(gen_random_uuid()::text, '-', ''))
WHERE member_invite_code IS NULL;
