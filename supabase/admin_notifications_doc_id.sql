-- admin_notifications.doc_id — make an upload notification OPEN the document.
--
-- The bell row has carried only the candidate's email and a filename, so
-- clicking an upload notification dropped the admin on the candidate with no
-- file open and the reviewer had to hunt the document down by name. There was
-- nothing on the row to deep-link with.
--
-- doc_id is the `documents` row the upload just created. ON DELETE SET NULL, so
-- a notification whose document was later removed degrades to today's behaviour
-- (land on the candidate) instead of dangling or blocking the delete.
--
-- Safe to run twice. Existing rows keep doc_id NULL — they simply behave as
-- they do now. The upload route writes it schema-tolerantly, so this migration
-- being un-run costs the deep link and nothing else.

alter table public.admin_notifications
  add column if not exists doc_id uuid references public.documents(id) on delete set null;

create index if not exists admin_notifications_doc_id_idx
  on public.admin_notifications (doc_id) where doc_id is not null;
