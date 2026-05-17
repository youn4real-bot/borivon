-- Enable Supabase Realtime broadcasts on `candidate_pipeline` so admin
-- lock/unlock toggles (recognition_unlocked, embassy_unlocked,
-- integration_unlocked, start_unlocked, docs_approved, etc.) propagate to
-- the candidate's dashboard instantly — no refresh needed.
--
-- The dashboard already subscribes to UPDATE events on this table; without
-- the publication entry, Postgres never emits the change and the channel
-- stays silent.
--
-- Run once in the Supabase SQL editor. Idempotent — guarded by a check.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'candidate_pipeline'
  ) then
    alter publication supabase_realtime add table candidate_pipeline;
  end if;
end$$;

-- Ensure REPLICA IDENTITY FULL so payload.new contains all columns, not
-- just the primary key. Without this, the realtime payload arrives with
-- only `id` set and the dashboard's spread (`{ ...prev, ...row }`) wipes
-- existing flags to undefined.
alter table candidate_pipeline replica identity full;
