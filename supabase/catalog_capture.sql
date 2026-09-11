-- ─────────────────────────────────────────────────────────────────────────────
-- READ-ONLY inventory of the live database structure, for the Supabase → D1
-- migration (step P0). Changes nothing. Returns ONE cell of JSON: copy it back.
--
-- It contains structure only (constraints, triggers, functions, indexes,
-- policies, extensions, realtime tables, views) plus COUNTS of password-hash
-- formats (the first 4 characters, e.g. "$2a$") — never a hash, email or name.
-- ─────────────────────────────────────────────────────────────────────────────

select jsonb_pretty(jsonb_build_object(
  'checks', (select jsonb_agg(jsonb_build_object('t', conrelid::regclass::text, 'n', conname, 'd', pg_get_constraintdef(oid)))
             from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace),
  'triggers', (select jsonb_agg(jsonb_build_object('t', event_object_table, 'n', trigger_name, 'when', action_timing, 'on', event_manipulation, 'do', action_statement))
               from information_schema.triggers where trigger_schema = 'public'),
  'functions', (select jsonb_agg(jsonb_build_object('n', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'definer', p.prosecdef))
                from pg_proc p where p.pronamespace = 'public'::regnamespace),
  'indexes', (select jsonb_agg(jsonb_build_object('t', tablename, 'd', indexdef)) from pg_indexes where schemaname = 'public'),
  'policies', (select jsonb_agg(jsonb_build_object('t', tablename, 'n', policyname, 'cmd', cmd, 'roles', roles::text, 'using', qual, 'check', with_check))
               from pg_policies where schemaname = 'public'),
  'views', (select jsonb_agg(table_name) from information_schema.views where table_schema = 'public'),
  'extensions', (select jsonb_agg(extname) from pg_extension),
  'realtime_tables', (select jsonb_agg(tablename) from pg_publication_tables where pubname = 'supabase_realtime'),
  'password_hash_formats', (select jsonb_object_agg(coalesce(pfx, 'none'), n)
                            from (select left(encrypted_password, 4) as pfx, count(*) as n from auth.users group by 1) s)
));
