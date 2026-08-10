-- ============================================================================
-- EMERGENCY: candidate_profiles is readable by the PUBLIC anon key.
-- ============================================================================
-- Every other table the app touches (78 checked) is correctly locked down with
-- row-level security. This ONE table was left open, so anyone on the internet
-- can read all ~78 nurses' passport numbers, dates of birth, phone numbers and
-- home addresses with only the public key that ships in the page — no login.
--
-- This bypasses every server-side auth gate because it goes straight to the
-- database. The only fix is at the database, and it is the block below.
--
-- SAFE:
--   * Candidates keep FULL access to their OWN row (dashboard, CV builder,
--     cover letter, feed) — the self policy below preserves it.
--   * The admin panel and every server API use the service-role key, which
--     bypasses row-level security entirely — UNAFFECTED.
--   * There are ZERO browser-side writes to this table (all writes are
--     server-side), so no write policy is needed.
--
-- ONE KNOWN DEGRADATION, temporary: an admin LIVE-editing ANOTHER candidate's
-- CV/cover-letter in the collaborative builder loses the live row-sync for that
-- person (the browser can no longer read someone else's row). The admin review
-- panel is unaffected. A follow-up code change routes that read through the
-- server so even this comes back.
--
-- Run this whole block once in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- 1. Turn on row-level security (no-op if already on).
alter table public.candidate_profiles enable row level security;

-- 2. Remove ANY existing policy on this table. We do not know the name of the
--    permissive one that is letting anon read, so drop them all and rebuild the
--    single correct one below. (Dropping policies cannot expose data — with RLS
--    on and no policy, nobody except the service role can read anything.)
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

-- 3. Belt-and-suspenders: the anonymous role must never read this table at all.
revoke select on public.candidate_profiles from anon;

-- 4. A logged-in user may read ONLY their own row. Admins and every server
--    route use the service-role key and bypass this entirely.
create policy cp_self_select on public.candidate_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ============================================================================
-- AFTER RUNNING: confirm it worked. This should return an empty result / 0.
-- ============================================================================
-- Run in a terminal (replace <ANON_KEY> with NEXT_PUBLIC_SUPABASE_ANON_KEY):
--   curl -s 'https://lobmtvfvrnlkngrqxgkb.supabase.co/rest/v1/candidate_profiles?select=passport_no&limit=1' \
--     -H 'apikey: <ANON_KEY>' -H 'Authorization: Bearer <ANON_KEY>'
-- Expected: []   (before the fix it returns real passport numbers)
