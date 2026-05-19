-- Enable Supabase Realtime for the tables the portal live-syncs across
-- supreme admin / sub-admins / candidates (no page refresh anywhere).
--
-- Idempotent: only adds a table to the `supabase_realtime` publication if it
-- isn't already a member (ALTER PUBLICATION ... ADD TABLE errors on dupes).
-- Safe to run repeatedly. Run once in the Supabase SQL editor.
--
-- `documents` is the important new one (live doc grid + dossier). The others
-- are already used by existing subscriptions; included defensively so a fresh
-- environment is fully wired in one shot.

do $$
declare
  t text;
  tables text[] := array[
    'documents',
    'notifications',
    'admin_notifications',
    'candidate_profiles',
    'candidate_pipeline',
    'messages'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
