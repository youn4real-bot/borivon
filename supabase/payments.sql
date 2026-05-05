-- ── Payments migration ───────────────────────────────────────────────────────
-- Run in Supabase SQL editor once.

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS payment_tier TEXT;
-- NULL = free | 'premium' = €99 one-time OR €19/month × 6 cycles
-- (Legacy values 'starter' and 'kandidat' migrated; see premium_rename.sql.)
