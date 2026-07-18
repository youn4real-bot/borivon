-- Drive share-mirror tracking (Calmaroi auto-share feature).
--
-- R2 stays the source of truth. Once a doc is GREEN-approved AND the candidate is
-- assigned to a Calmaroi employer, its bytes are copied from R2 into the founder's
-- Google Drive (folder tree: "Calmaroi X Borivon / <batch> / <candidate> / <doc>")
-- so he can share the batch folder with the agency without re-uploading.
--
-- These two columns make the copy idempotent + cheap (the founder's explicit ask:
-- "only copy once the file is green, and never keep re-doing it"):
--   • drive_mirror_id     — the Drive file id of the shared copy (so a re-run
--                           UPDATES that file instead of making a duplicate).
--   • drive_mirror_sha256 — the documents.file_sha256 that was last mirrored. If
--                           it still matches, the sync SKIPS the R2 read + Drive
--                           write entirely (no wasted API). It only re-uploads
--                           when the underlying file actually changed.
--
-- Run this in the Supabase SQL editor before deploying the feature.

alter table public.documents
  add column if not exists drive_mirror_id     text,
  add column if not exists drive_mirror_sha256 text;

-- Cheap lookups for "what still needs mirroring" (approved + assigned + unmirrored).
create index if not exists documents_drive_mirror_idx
  on public.documents (user_id)
  where status = 'approved' and r2_key is not null;
