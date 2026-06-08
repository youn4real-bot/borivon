-- ─────────────────────────────────────────────────────────────────────────────
-- Force-logout helper for the supreme-admin password-reset page.
--
-- When the supreme admin sets a new password for a user we also want to kick
-- that user off EVERY device immediately. Logging out = removing their auth
-- sessions (each holds the refresh token). The auth schema isn't reachable via
-- PostgREST / the normal service client, so this SECURITY DEFINER function is
-- the bridge. EXECUTE is granted to service_role ONLY (the server's key) — never
-- anon/authenticated — and it only ever touches the one user id passed in.
--
-- Returns the number of sessions removed (just for the confirmation UI).
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_force_logout(target_user uuid)
returns integer
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  removed integer;
begin
  delete from auth.sessions where user_id = target_user;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.admin_force_logout(uuid) from public, anon, authenticated;
grant execute on function public.admin_force_logout(uuid) to service_role;
