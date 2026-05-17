-- Enable Supabase Realtime broadcasts on `candidate_profiles` so passport
-- data edits sync LIVE across the candidate's devices (phone <-> laptop):
-- edit on one → debounced DB draft-save → Postgres emits the change →
-- the dashboard's realtime channel updates the open passport modal on the
-- other device instantly.
--
-- The dashboard already subscribes to changes on this table; without the
-- publication entry Postgres never emits, and the channel stays silent.
--
-- Run once in the Supabase SQL editor. Idempotent — guarded by a check.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'candidate_profiles'
  ) then
    alter publication supabase_realtime add table candidate_profiles;
  end if;
end$$;

-- REPLICA IDENTITY FULL so payload.new carries every passport column, not
-- just the primary key — the client patches individual fields from it.
alter table candidate_profiles replica identity full;
