-- ============================================================================
-- EMERGENCY: close the candidate_profiles public-read leak. RE-RUNNABLE.
-- ============================================================================
-- Passport numbers, DOB, phone and home address of all 78 nurses are readable
-- by anyone with the public key, no login. This is the fix. Only the database
-- can close it (it bypasses all app code).
--
-- HOW TO RUN (important): in the Supabase SQL editor, the "Run" button executes
-- ONLY the statement your cursor is in unless text is highlighted. So:
--   → Select ALL of this file (Ctrl/Cmd-A), THEN click Run.
-- It is wrapped in a single transaction so it all applies or none of it does,
-- and it is safe to run more than once.
-- ============================================================================

begin;

  -- 1. Row-level security ON (no-op if already on).
  alter table public.candidate_profiles enable row level security;

  -- 2. Drop EVERY existing policy on the table (we don't know the name of the
  --    permissive one letting anon read). With RLS on and no policy, only the
  --    service role can read — so this cannot expose data.
  do $$
  declare pol record;
  begin
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'candidate_profiles'
    loop
      execute format('drop policy if exists %I on public.candidate_profiles', pol.policyname);
    end loop;
  end $$;

  -- 3. The anonymous role must never read this table.
  revoke select on public.candidate_profiles from anon;

  -- 4. A logged-in user may read ONLY their own row. Admins + every server
  --    route use the service-role key and bypass this entirely.
  create policy cp_self_select on public.candidate_profiles
    for select to authenticated
    using (auth.uid() = user_id);

commit;

-- ============================================================================
-- CHECK — this SELECT runs at the end and shows the result. Expect:
--   rls_enabled = true, policy_count = 1, policies = cp_self_select ... SELECT
-- ============================================================================
select
  (select relrowsecurity
     from pg_class
     where oid = 'public.candidate_profiles'::regclass)                       as rls_enabled,
  (select count(*)
     from pg_policies
     where schemaname = 'public' and tablename = 'candidate_profiles')        as policy_count,
  (select string_agg(policyname || ' [' || cmd || ']', ', ')
     from pg_policies
     where schemaname = 'public' and tablename = 'candidate_profiles')        as policies;
