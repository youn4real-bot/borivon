-- Per-template field-mapping memory.
--
-- When admin uploads a PDF with native AcroForm fields, the auto-fill modal
-- detects the fields and tries to match each by name. Admin can override.
-- We store the resulting mappings keyed by a STABLE SIGNATURE of the PDF's
-- field-name set, so the next admin who uploads the same form (same field
-- names — even for a different candidate) gets every mapping pre-applied.
--
-- Signature = sha256(sorted unique field names, joined by "|"), truncated
-- to the first 32 hex chars. Computed client-side; stable across renames as
-- long as the form author doesn't change the field-name list.
--
-- mappings JSON shape: [{ name: string, binding: string | null, literal?: string }, ...]
--
-- Run once in the Supabase SQL editor. Idempotent.

create table if not exists pdf_field_mappings (
  signature   text primary key,
  mappings    jsonb not null,
  field_count int  not null default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  created_by  uuid references auth.users(id) on delete set null
);

create index if not exists pdf_field_mappings_updated_idx
  on pdf_field_mappings(updated_at desc);
