-- ── Notifications table update ────────────────────────────────────────────────
-- Run in Supabase SQL editor once.
--
-- 1. Make doc_id nullable so verified/placed notifications don't need a doc
-- 2. Drop + recreate the action CHECK constraint to allow all four action types

-- Make doc_id nullable (it's currently NOT NULL but verified/placed have no doc)
ALTER TABLE notifications
  ALTER COLUMN doc_id DROP NOT NULL;

-- Drop the old constraint (name may vary — use the pg_constraint catalog if needed)
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_action_check;

-- Add updated constraint with all four valid action types
ALTER TABLE notifications
  ADD CONSTRAINT notifications_action_check
    CHECK (action IN ('approved', 'rejected', 'verified', 'placed'));
