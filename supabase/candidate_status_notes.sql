-- Adds a free-text admin notes field to candidate_status (admin-only,
-- RLS-locked — candidate never sees it). Additive, safe to re-run.
-- RUN THIS IN THE SUPABASE SQL EDITOR.
alter table public.candidate_status
  add column if not exists b2_notes text;
