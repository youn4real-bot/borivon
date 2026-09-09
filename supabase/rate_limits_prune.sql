-- ─────────────────────────────────────────────────────────────────────────────
-- rate_limits: self-pruning.
--
-- The table keeps one row per (bucket_key, window). rate_limits.sql shipped an
-- index "so a periodic cleanup can prune old windows cheaply" — but no cleanup
-- was ever written, anywhere in the repo. Every rate-limited request since then
-- has left a row behind permanently: per-minute buckets alone are 1,440 windows
-- per key per day, and the new per-IP daily template cap adds a row per visitor.
-- It only ever grows, and it is on the hot path of every limited endpoint.
--
-- Rather than add a cron (and a new failure mode), rl_hit prunes opportunistically:
-- roughly one call in a thousand deletes windows older than two days. That is far
-- more often than needed to stay flat, costs nothing on the other 99.9% of calls,
-- and needs no scheduler.
--
-- Two days, not one: the longest window in use is 24h (the daily download caps),
-- so the current AND previous window must survive. Deleting a live window would
-- silently reset someone's daily allowance.
--
-- Idempotent — `create or replace`. Behaviour is otherwise byte-identical to
-- rate_limits.sql, so running this after it is safe and additive.
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.rl_hit(
  p_key       text,
  p_window_ms bigint,
  p_now_ms    bigint
)
returns table (new_count integer, reset_ms bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start bigint := (p_now_ms / p_window_ms) * p_window_ms;
begin
  -- Opportunistic GC. Keeps the table flat without a scheduled job.
  if random() < 0.001 then
    delete from public.rate_limits
      where window_start < (p_now_ms - 172800000);   -- older than 2 days
  end if;

  insert into public.rate_limits (bucket_key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set count = public.rate_limits.count + 1
  returning public.rate_limits.count into new_count;

  reset_ms := v_window_start + p_window_ms;
  return next;
end;
$$;

grant execute on function public.rl_hit(text, bigint, bigint) to service_role, authenticated, anon;

-- One-off catch-up for whatever has already accumulated.
delete from public.rate_limits where window_start < (extract(epoch from now()) * 1000 - 172800000);
