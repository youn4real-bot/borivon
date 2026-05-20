-- Silent placement cleanup.
--
-- Going forward the portal no longer creates 'placement' notifications,
-- and the bell already filters them out — but any rows that were inserted
-- before the change are still in the table. This one-time DELETE drops
-- them so the unread badge can never resurface an old match.
--
-- Safe to run any time. Idempotent — re-running deletes nothing once
-- the table is clean.

DELETE FROM notifications WHERE doc_type = 'placement';

-- Verify (expect 0 rows)
SELECT COUNT(*) AS leftover_placement_rows FROM notifications WHERE doc_type = 'placement';
