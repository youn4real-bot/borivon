-- Assignment (agency / direct employer) inside candidate_status.
-- Admin-only / RLS-locked — candidate never sees it. Additive, safe to re-run.
--   assign_type      : 'agency' | 'employer' | null
--   assign_agency    : agency key  (e.g. 'calmaroi')        — when type='agency'
--   assign_site      : site/employer under the agency
--                       (e.g. 'kiel' | 'luebeck')           — when type='agency'
--   assign_employer  : direct-employer key (e.g. 'amb_murnau') — when type='employer'
-- RUN THIS IN THE SUPABASE SQL EDITOR.
alter table public.candidate_status
  add column if not exists assign_type     text,
  add column if not exists assign_agency   text,
  add column if not exists assign_site     text,
  add column if not exists assign_employer text;
