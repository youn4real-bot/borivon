-- ─────────────────────────────────────────────────────────────────────────────
-- Distributed rate limiting backed by Postgres (no Redis/Upstash required).
--
-- Why: lib/rateLimit.ts's "distributed" path only used Vercel KV / Upstash, and
-- none is wired — so every "distributed" cap (uploads, feed posts, check-email,
-- redeem-code, sign-requests, cv/letter generation …) was SILENTLY running
-- in-process per-Lambda, i.e. effectively `limit × live-instances` ≈ unlimited
-- across a scaled-out fleet. This gives a real SHARED counter for free, reusing
-- Supabase. The API layer fails OPEN to the in-process limiter if this table /
-- function is missing, so routes keep working before/without this migration —
-- it just upgrades the cap from per-instance to truly global.
--
-- Fixed-window counter: one row per (bucket_key, window_start). rl_hit() does an
-- atomic INSERT … ON CONFLICT increment and returns the new count + window end.
--
-- Run once in Supabase → SQL editor. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.rate_limits (
  bucket_key   text    not null,
  window_start bigint  not null,            -- epoch ms of the window's start
  count        integer not null default 0,
  primary key (bucket_key, window_start)
);

-- Lets a periodic cleanup prune old windows cheaply (optional; rows are tiny).
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- Atomic "hit": increment the counter for the fixed window containing p_now_ms
-- and return the new count + the window's reset (epoch ms). p_window_ms = bucket
-- size in ms. SECURITY DEFINER so it never needs broad table grants; it only
-- ever touches its own counter row.
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
