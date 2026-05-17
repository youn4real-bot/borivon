-- Backfill notifications where doc_type or doc_name leaked a raw phase_slots
-- UUID into the candidate bell. Resolves each UUID to its slot label so old
-- rows render as "Vollmacht wurde genehmigt" instead of "bea8c6dc-... wurde
-- genehmigt".
--
-- Run once in the Supabase SQL editor. Idempotent: a second run is a no-op
-- because the regex only matches UUID-shaped strings.

UPDATE notifications n
SET doc_type = ps.label
FROM phase_slots ps
WHERE n.doc_type ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND ps.id::text = n.doc_type
  AND ps.label IS NOT NULL
  AND length(trim(ps.label)) > 0;

UPDATE notifications n
SET doc_name = ps.label
FROM phase_slots ps
WHERE n.doc_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND ps.id::text = n.doc_name
  AND ps.label IS NOT NULL
  AND length(trim(ps.label)) > 0;

-- Same for admin_notifications (admin bell).
UPDATE admin_notifications an
SET doc_type = ps.label
FROM phase_slots ps
WHERE an.doc_type ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND ps.id::text = an.doc_type
  AND ps.label IS NOT NULL
  AND length(trim(ps.label)) > 0;

UPDATE admin_notifications an
SET doc_name = ps.label
FROM phase_slots ps
WHERE an.doc_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND ps.id::text = an.doc_name
  AND ps.label IS NOT NULL
  AND length(trim(ps.label)) > 0;
