-- Remember which language somebody booked in, so their confirmation, reminder
-- and cancellation emails come back in that language.
--
-- The FR/DE copy for all three emails already exists in lib/email.ts — it was
-- simply unreachable, because no caller ever passed `lang` and every sender
-- defaulted to English. A Moroccan nurse who did the whole tap-only flow on a
-- French page got an English confirmation, an English reminder, and an English
-- reschedule link: the one action that prevents a no-show, worded in a language
-- she may not read.
--
-- Nullable on purpose: an admin-entered booking has no page language, and falls
-- through to the existing English default.
--
-- ▶ Run once in the Supabase SQL editor. Safe to re-run.

alter table public.bookings
  add column if not exists lang text check (lang in ('fr','en','de'));
