-- Atomic per-key claim/release for one-time login-less upload links.
--
-- WHY: the route used to claim a key by overwriting the WHOLE uploaded_keys
-- array with a value computed from a request-start snapshot. Two concurrent
-- uploads of DIFFERENT doc keys on a multi-doc link (the candidate taps two
-- tiles in quick succession — each DocUploader autoProceeds) both read the same
-- old array and the second write clobbered the first, dropping a key. That
-- dropped key then showed as still-needed (duplicate upload) and the single-use
-- link never retired (used_at never set). These functions do the append/remove
-- server-side under a guard so concurrent different-key claims can't lose an
-- update.
--
-- The route calls these via db.rpc(...) and gracefully falls back to the legacy
-- whole-array claim if this migration hasn't been applied yet, so deploying the
-- code before running this is safe (it just keeps the old racy behavior).

-- Append p_key to the link's uploaded_keys iff it isn't already present and the
-- link is still live. Returns the NEW uploaded_keys, or NULL when nothing was
-- claimed (key already present, or the link is used/revoked).
create or replace function public.claim_upload_key(p_link_id uuid, p_key text)
returns text[]
language sql
security definer
set search_path = public
as $$
  update public.upload_links
     set uploaded_keys = (
       select array(select distinct e
                      from unnest(coalesce(uploaded_keys, '{}'::text[]) || array[p_key]) as e)
     )
   where id = p_link_id
     and used_at is null
     and revoked_at is null
     and not (coalesce(uploaded_keys, '{}'::text[]) @> array[p_key])
  returning uploaded_keys;
$$;

-- Roll back a single key after a failed upload (array_remove — never a
-- whole-array reset, which could wipe a key a concurrent request just claimed).
create or replace function public.release_upload_key(p_link_id uuid, p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.upload_links
     set uploaded_keys = array_remove(coalesce(uploaded_keys, '{}'::text[]), p_key)
   where id = p_link_id;
$$;

-- Only the service role (the server) may call these; the table itself stays
-- RLS-locked and the anon/authenticated keys can never invoke them.
revoke all on function public.claim_upload_key(uuid, text)  from public, anon, authenticated;
revoke all on function public.release_upload_key(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_upload_key(uuid, text)  to service_role;
grant execute on function public.release_upload_key(uuid, text) to service_role;
