-- Sign requests v2 — run once in Supabase SQL editor. Safe to re-run.

-- 1. viewed_at: set when candidate first opens their pending requests
ALTER TABLE sign_requests ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;

-- 2. Allow 'sign_request' action in candidate notifications
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_action_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_action_check
  CHECK (action IN ('approved', 'rejected', 'verified', 'placed', 'sign_request'));
