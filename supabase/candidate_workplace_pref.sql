-- ─────────────────────────────────────────────────────────────────────────────
-- Which German workplace TYPE the candidate wants: Altenheim (nursing home) vs
-- Klinik (hospital/clinic) — or 'either'. Free text (typically 'altenheim' |
-- 'klinik' | 'either'). Shown in the candidate Google Sheet + set from the bot
-- ("Amina wants Klinik"). NULL = not asked yet.
--
-- ▶ Run once in the Supabase SQL editor. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_profiles
  add column if not exists workplace_pref text;
