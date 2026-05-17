-- ════════════════════════════════════════════════════════════════════════
--  PERMANENT user deletion — run ONCE in the Supabase SQL editor.
--
--  Problem this fixes:
--  "Delete user" was falling back to a SOFT delete (ban + scramble email to
--  deleted+<uuid>@borivon.invalid) whenever ANY app table still had a row
--  FK-referencing auth.users without ON DELETE CASCADE. Those banned-but-
--  not-removed accounts kept showing up on the admin dashboard ("ghost"
--  users). The owner's rule: Delete = gone everywhere, permanently. The
--  only thing kept is the user's documents, archived in Google Drive.
--
--  Solution: one SECURITY DEFINER function that, in a SINGLE transaction:
--    1. dynamically finds EVERY table whose foreign key points at
--       auth.users(id) — no hard-coded table list, so it can never go
--       stale when new tables are added,
--    2. deletes that user's rows from each of them,
--    3. deletes the auth.users row itself.
--  Any error rolls the whole thing back — no partial / orphaned state.
--
--  The API route calls this via db.rpc('app_delete_user', { p_uid }).
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.app_delete_user(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  r record;
begin
  -- Every single-column FK that references auth.users(id): child table +
  -- the child column holding the user id. Covers documents, notifications,
  -- candidate_profiles, candidate_pipeline, feed_posts/comments/likes,
  -- sign_requests, suggested_matches, community_seen, agency_profiles,
  -- candidate_organizations, sub_admin_assignments, … automatically.
  for r in
    select con.conrelid::regclass as child_table,
           att.attname           as child_col
    from   pg_constraint con
    join   pg_attribute  att
      on   att.attrelid = con.conrelid
     and   att.attnum   = con.conkey[1]
    where  con.contype  = 'f'
      and  con.confrelid = 'auth.users'::regclass
  loop
    execute format('delete from %s where %I = $1', r.child_table, r.child_col)
      using p_uid;
  end loop;

  -- Finally the account itself.
  delete from auth.users where id = p_uid;
end;
$$;

-- Let the service role (used by the API) execute it.
grant execute on function public.app_delete_user(uuid) to service_role;

-- ── One-time cleanup of the ghosts already created by the old soft delete ──
-- Removes every previously soft-deleted account (banned + scrambled email)
-- permanently, using the same cascade-safe path. Oussama and any others
-- disappear the moment you run this file.
do $$
declare u record;
begin
  for u in
    select id
    from   auth.users
    where  (raw_user_meta_data ->> 'deleted') = 'true'
       or  email like 'deleted+%@borivon.invalid'
  loop
    perform public.app_delete_user(u.id);
  end loop;
end $$;
