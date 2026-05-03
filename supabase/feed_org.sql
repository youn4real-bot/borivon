-- ── Per-org community feeds ───────────────────────────────────────────────────
-- Adds an optional org_id to feed_posts so each organization can have its
-- own private community feed (e.g. Calmaroi community, separate from the
-- global Borivon community).
--
-- NULL  → global Borivon community (visible to everyone)
-- UUID  → that org's private community (visible only to candidates linked
--         to that org and members of that organization)
--
-- Run in Supabase SQL editor once. Safe to re-run.

ALTER TABLE feed_posts
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Index so the feed list query stays fast when filtering by org_id.
CREATE INDEX IF NOT EXISTS feed_posts_org_id_idx ON feed_posts (org_id, created_at DESC);
