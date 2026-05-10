-- Stores the Supabase Storage path of the admin-signed version of a document.
-- When set, the file API serves this instead of the original Drive file.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS signed_storage_path text;
