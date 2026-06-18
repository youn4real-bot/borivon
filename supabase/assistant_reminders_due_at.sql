-- ─────────────────────────────────────────────────────────────────────────────
-- Reminders that ACTUALLY FIRE AT A TIME.
--
-- The original assistant_reminders only had a `due_date` (a DATE — no time of day),
-- and nothing ever pushed a reminder at its due moment: open reminders just got
-- bundled into the 6am briefing / midday+evening nudges. So "remind me at 3pm" was
-- impossible — the time was thrown away and it never pinged at 3pm. This adds:
--
--   • due_at      timestamptz — the exact instant the reminder is due (with time).
--                 Kept ALONGSIDE the legacy due_date (old date-only rows still work).
--   • notified_at timestamptz — stamped the moment we push the reminder to Telegram,
--                 so each fires EXACTLY ONCE and is never re-spammed on every tick.
--   • remind_count int — how many times it was pushed (for future "snooze"/repeat).
--
-- Firing happens from (a) every inbound Telegram message (opportunistic flush) and
-- (b) a dedicated /api/cron/reminders endpoint. See lib/reminderFire.ts.
--
-- Additive + idempotent. Until this runs, the reminder code falls back to the old
-- date-only behaviour gracefully (the new columns are simply absent).
--
-- ▶ Run once in the Supabase SQL editor (required before time-precise reminders work).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.assistant_reminders
  add column if not exists due_at       timestamptz,
  add column if not exists notified_at  timestamptz,
  add column if not exists remind_count integer not null default 0,
  -- Optional repeat: 'daily' | 'weekly' | 'monthly' (null = one-shot). When a recurring
  -- reminder fires, the firing code re-arms the next occurrence (clears notified_at +
  -- advances due_at) so "remind me every Monday / every month" keeps pinging until done.
  add column if not exists recurrence   text;

-- Hot path for the firing query: "open, due now, not yet notified".
create index if not exists assistant_reminders_due_at_idx
  on public.assistant_reminders (done, notified_at, due_at);
