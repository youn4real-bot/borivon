-- Feature #3 — track WHICH batch folder each mirrored doc copy lives in.
--
-- Problem it fixes: the Google Drive mirror records ONE drive_mirror_id per
-- document. When a candidate moves from batch A to batch B, every doc looks
-- "already mirrored", so (1) the new batch folder gets nothing (the agency sees
-- an empty candidate) and (2) the old batch folder is never cleaned, so the old
-- agency keeps the whole dossier forever.
--
-- With this column the mirror knows the batch each copy belongs to: a doc whose
-- drive_mirror_batch_id != the candidate's current batch is retracted from the
-- old folder (moved to Archiv — LAW #33, never deleted) and re-uploaded fresh to
-- the new folder. NULL = legacy/unknown (treated as "current", so nothing is
-- wrongly retracted before the code has stamped it).
--
-- Fully additive + idempotent. The mirror code is schema-tolerant: until this is
-- run it behaves exactly as before (batch tracking simply inactive).
--
-- ▶ Run once in the Supabase SQL editor.

alter table public.documents
  add column if not exists drive_mirror_batch_id uuid;
