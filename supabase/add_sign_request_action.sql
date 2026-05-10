-- Allow sign_request action in the notifications table.
-- The existing constraint only allows: approved, rejected, verified, placed.
-- Without this, sign-request bell notifications silently fail.

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_action_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_action_check
    CHECK (action IN ('approved', 'rejected', 'verified', 'placed', 'sign_request'));
