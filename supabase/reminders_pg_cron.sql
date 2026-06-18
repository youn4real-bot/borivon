-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL: to-the-minute reminder firing, straight from Supabase (no Vercel Pro,
-- no external account). We're on Vercel Hobby, where crons run at most once a day —
-- so for a reminder to ping at an arbitrary minute, SOMETHING has to poke the app
-- every minute. This uses Supabase's built-in pg_cron + pg_net to GET the
-- /api/cron/reminders endpoint every minute; that endpoint pushes any now-due
-- reminders to Telegram (exactly once each).
--
-- WITHOUT this, reminders still work — they fire whenever you message the bot and at
-- the existing daily briefing/nudge/auto-chase/inbox windows. This just makes the
-- timing exact (a "3:07pm" reminder pings at ~3:07pm instead of the next window).
--
-- ▶ Setup (once, in the Supabase SQL editor):
--   1. Replace <YOUR_CRON_SECRET> below with the exact CRON_SECRET you set in Vercel.
--   2. (If your domain isn't www.borivon.com, change the URL.)
--   3. Run it. Check it's scheduled:  select * from cron.job;
--   To remove later:  select cron.unschedule('borivon-fire-reminders');
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop a prior copy of this job before re-adding (ignore if absent).
do $$
begin
  perform cron.unschedule('borivon-fire-reminders');
exception when others then
  null;
end $$;

select cron.schedule(
  'borivon-fire-reminders',
  '* * * * *',  -- every minute
  $$
  select net.http_get(
    url := 'https://www.borivon.com/api/cron/reminders?secret=<YOUR_CRON_SECRET>',
    timeout_milliseconds := 8000
  );
  $$
);
