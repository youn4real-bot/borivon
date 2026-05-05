-- Persistent PDF rotation per document.
-- Stored as multiples of 90 (0, 90, 180, 270). Applied server-side on
-- /api/portal/file and /api/portal/documents/merge-pdf so downloads /
-- previews always reflect the saved orientation.
alter table documents
  add column if not exists rotation int not null default 0;
