-- ── Payments migration ───────────────────────────────────────────────────────
-- Run in Supabase SQL editor once.

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS payment_tier TEXT;
-- NULL = not paid yet | 'starter' = €9 | 'kandidat' = €99
