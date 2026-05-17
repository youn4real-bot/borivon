-- Per-user "Community last seen" timestamp so the unread badge is
-- PERMANENT + cross-device. Visiting Community records seen_at = now();
-- the unread count only counts feed activity newer than that. Survives
-- logout/login and syncs across devices (no more stale localStorage badge).
--
-- Run once in the Supabase SQL editor. Idempotent.

CREATE TABLE IF NOT EXISTS community_seen (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  seen_at  timestamptz NOT NULL DEFAULT now()
);
