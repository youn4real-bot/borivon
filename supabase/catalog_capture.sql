-- ─────────────────────────────────────────────────────────────────────────────
-- READ-ONLY inventory of the live database structure, for the Supabase → D1
-- migration. Changes nothing. Returns ONE cell of JSON: copy it back.
--
-- It contains structure only (constraints, foreign keys and what a delete does
-- to them, column defaults, triggers, functions, indexes, policies, extensions,
-- realtime tables, views) plus COUNTS of password-hash formats (the first 4
-- characters, e.g. "$2a$") — never a hash, email or name.
--
-- v2 (2026-09-13) adds two things the first capture could not see, both proven
-- to matter by the adapter parity hunt:
--   foreign_keys     — ON DELETE / ON UPDATE actions (a=no action, r=restrict,
--                      c=cascade, n=set null, d=set default). Without them the
--                      copy has no foreign keys at all, so deleting an
--                      organisation leaves its members and candidate links behind.
--   column_defaults  — every column default, including the jsonb / array ones
--                      ('[]'::jsonb) that PostgREST's OpenAPI silently omits.
-- Re-running the whole capture also refreshes the checks and indexes, so the
-- copy's rulebook can no longer fall a migration behind unnoticed.
-- ─────────────────────────────────────────────────────────────────────────────

select jsonb_pretty(jsonb_build_object(
  'checks', (select jsonb_agg(jsonb_build_object('t', conrelid::regclass::text, 'n', conname, 'd', pg_get_constraintdef(oid)))
             from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace),
  'foreign_keys', (select jsonb_agg(jsonb_build_object(
                     't', c.conrelid::regclass::text,
                     'n', c.conname,
                     'cols', (select jsonb_agg(a.attname order by k.ord)
                              from unnest(c.conkey) with ordinality k(attnum, ord)
                              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum),
                     'ref', c.confrelid::regclass::text,
                     'refcols', (select jsonb_agg(a.attname order by k.ord)
                                 from unnest(c.confkey) with ordinality k(attnum, ord)
                                 join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum),
                     'on_delete', c.confdeltype,
                     'on_update', c.confupdtype,
                     'd', pg_get_constraintdef(c.oid)))
                   from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace),
  'column_defaults', (select jsonb_agg(jsonb_build_object('t', table_name, 'c', column_name, 'd', column_default, 'type', data_type, 'udt', udt_name))
                      from information_schema.columns where table_schema = 'public' and column_default is not null),
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
