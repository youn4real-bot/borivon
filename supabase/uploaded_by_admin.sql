-- Track whether a document was uploaded by an admin on behalf of a candidate.
-- Admin-uploaded docs don't need approve/reject review — they're admin records.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS uploaded_by_admin boolean NOT NULL DEFAULT false;
