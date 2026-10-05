-- ─────────────────────────────────────────────────────────────────────────────
-- Read-only export of the login accounts, for the daily encrypted backup
-- (lib/supabaseFreePlanSafety.ts, riding the 06:00 briefing cron).
--
-- WHY A FUNCTION: after the database moves to D1, Supabase keeps only the
-- logins and drops to the Free plan, which has NO backups. The one thing that
-- cannot be rebuilt from D1 is auth.users — above all the bcrypt password hash,
-- without which moving logins later means every candidate resets a password.
-- auth.users is not exposed through PostgREST (it answers PGRST106), and the
-- Admin API never returns encrypted_password, so this SECURITY DEFINER function
-- is the only bridge that needs no new secret. EXECUTE goes to service_role ONLY.
-- Supabase grants new public functions to anon and authenticated by default,
-- hence the explicit revoke: without it any logged-in candidate could read
-- every password hash.
--
-- STABLE, so PostgREST serves it over GET: the backup never sends Supabase a
-- POST, and the function changes nothing.
--
-- One page of accounts ordered by id (keyset: pass the last id back as
-- after_id), each with its auth.identities rows, plus the total so the caller
-- can prove the export is complete. Columns are whitelisted out of to_jsonb(u):
-- a column a future GoTrue drops comes back absent instead of breaking the
-- function, and the one-time tokens (confirmation, recovery, email change) are
-- never exported — useless after a move, dangerous in a file.
--
-- d1/check-drift.mjs ignores the /rpc path this adds: D1 never answers it.
--
-- ▶ Run once in the Supabase SQL editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.bv_auth_users_backup_page(after_id uuid default null, page_size integer default 500)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with page as (
    select u.*
    from auth.users u
    where bv_auth_users_backup_page.after_id is null or u.id > bv_auth_users_backup_page.after_id
    order by u.id
    limit least(greatest(coalesce(bv_auth_users_backup_page.page_size, 500), 1), 1000)
  )
  select jsonb_build_object(
    'total', (select count(*) from auth.users),
    'users', coalesce((
      select jsonb_agg(
        (select jsonb_object_agg(e.key, e.value)
           from jsonb_each(to_jsonb(p)) as e(key, value)
          where e.key = any (array[
            'id', 'aud', 'role', 'email', 'encrypted_password', 'email_confirmed_at', 'invited_at',
            'phone', 'phone_confirmed_at', 'created_at', 'updated_at', 'last_sign_in_at',
            'raw_user_meta_data', 'raw_app_meta_data', 'banned_until', 'deleted_at',
            'is_sso_user', 'is_anonymous'
          ]))
        || jsonb_build_object('identities', coalesce(
             (select jsonb_agg(to_jsonb(i)) from auth.identities i where i.user_id = p.id),
             '[]'::jsonb))
        order by p.id)
      from page p), '[]'::jsonb)
  );
$$;

revoke all on function public.bv_auth_users_backup_page(uuid, integer) from public, anon, authenticated;
grant execute on function public.bv_auth_users_backup_page(uuid, integer) to service_role;
