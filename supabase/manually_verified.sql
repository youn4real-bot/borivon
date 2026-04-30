-- ──────────────────────────────────────────────────────────────────────────────
-- Manual verification override.
--
-- Lets the ultimate admin grant the blue tick to any candidate, regardless of
-- whether they have an approved passport + Lebenslauf.
--
-- Default = FALSE (existing rows keep doc-based verification).
-- When TRUE, the candidate is treated as verified everywhere (public profile,
-- own dashboard, "Message Borivon" gate, etc.) — even with no docs uploaded.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS manually_verified BOOLEAN NOT NULL DEFAULT FALSE;
