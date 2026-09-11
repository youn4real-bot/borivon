-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY: the rate limiter must be callable by the server only.
--
-- rate_limits.sql / rate_limits_prune.sql granted EXECUTE on rl_hit to anon and
-- authenticated. rl_hit is SECURITY DEFINER, and the anon key ships inside the
-- public website, so anyone could call it over /rest/v1/rpc/rl_hit with any
-- bucket key — inflating a real user's counter to lock them out of uploads /
-- downloads / login-adjacent routes, or flooding the table. Found by the
-- Supabase→D1 mapping pass (2026-09-11).
--
-- The app only ever calls it with the service-role client (lib/rateLimit.ts),
-- so revoking the public grants changes nothing for real users.
-- ▶ Run once in the Supabase SQL editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.rl_hit(text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.rl_hit(text, bigint, bigint) to service_role;
