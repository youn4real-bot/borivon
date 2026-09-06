-- Affiliate Terms & Conditions acceptance. RUN ONCE IN THE SUPABASE SQL EDITOR.
-- Each affiliate must read + confirm the affiliate agreement on their dashboard
-- before they can use it; this records WHEN and which version they accepted
-- (auditable). Degrades gracefully: until this runs, the dashboard shows no gate.
alter table public.affiliates
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version     text;
