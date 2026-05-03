-- ── Community Feed migration ──────────────────────────────────────────────────
-- Run in Supabase SQL editor once.
-- Safe to re-run (all statements are idempotent).

-- ── Base tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feed_posts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL,
  content     TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  image_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_likes (
  post_id  UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS feed_comments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID        NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL,
  content    TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_comment_likes (
  comment_id UUID NOT NULL REFERENCES feed_comments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

-- ── Additional columns (added in later releases) ──────────────────────────────

ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS title   TEXT        CHECK (char_length(title) <= 100);
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS pinned  BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS gif_url TEXT;
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS category TEXT       NOT NULL DEFAULT 'general';

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS feed_posts_created_at_idx  ON feed_posts  (pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_comments_post_id_idx  ON feed_comments (post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS feed_likes_post_id_idx     ON feed_likes (post_id);
CREATE INDEX IF NOT EXISTS feed_clikes_comment_id_idx ON feed_comment_likes (comment_id);

-- ── RLS (all reads/writes go through service key on the server) ───────────────
-- The API uses the service role key which bypasses RLS.
-- No public client-side access is allowed; policies are a safety net only.

ALTER TABLE feed_posts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_likes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_comment_likes ENABLE ROW LEVEL SECURITY;

-- Drop any stale policies before recreating (safe noop if they don't exist)
DROP POLICY IF EXISTS "feed_posts_no_public"         ON feed_posts;
DROP POLICY IF EXISTS "feed_likes_no_public"         ON feed_likes;
DROP POLICY IF EXISTS "feed_comments_no_public"      ON feed_comments;
DROP POLICY IF EXISTS "feed_comment_likes_no_public" ON feed_comment_likes;

-- Deny all direct client access (API uses service key → bypasses RLS)
CREATE POLICY "feed_posts_no_public"         ON feed_posts         FOR ALL USING (false);
CREATE POLICY "feed_likes_no_public"         ON feed_likes         FOR ALL USING (false);
CREATE POLICY "feed_comments_no_public"      ON feed_comments      FOR ALL USING (false);
CREATE POLICY "feed_comment_likes_no_public" ON feed_comment_likes FOR ALL USING (false);

-- ── Storage bucket ────────────────────────────────────────────────────────────
-- The "feed-photos" bucket is created automatically by the first POST to
-- /api/portal/feed that includes an image. No manual step needed here.
-- If you want to pre-create it: Storage → New bucket → name: feed-photos → Public ✓
