-- ──────────────────────────────────────────────────────────────────────────────
-- Profile photo
--
-- Stores a candidate's profile photo (base64 data URL, resized to ~400px max
-- before save). Used by the CV builder photo upload, then mirrored into
-- candidate_profiles so it can be displayed as the avatar everywhere
-- (ProfileIcon, public profile page, in-app popup).
--
-- TEXT is fine — typical compressed photos sit at 30-80 KB which Postgres
-- handles trivially.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS profile_photo TEXT;
