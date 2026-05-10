-- Add review columns to sign_requests
ALTER TABLE sign_requests
  ADD COLUMN IF NOT EXISTS review_status   TEXT CHECK (review_status IN ('accepted', 'rejected')),
  ADD COLUMN IF NOT EXISTS review_feedback TEXT;

-- Extend admin_notifications type constraint to include 'doc-signed'
-- (Original constraint only allowed 'signup' | 'upload')
ALTER TABLE admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
ALTER TABLE admin_notifications
  ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN ('signup', 'upload', 'doc-signed'));
