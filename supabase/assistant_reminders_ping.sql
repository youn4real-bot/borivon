-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor.
--
-- Adds assistant_reminders.last_ping_message_id — the Telegram message_id of the most
-- recent fired ping for a reminder. It lets the founder ACT ON a reminder by REPLYING to
-- its ping: a reply-to of "done" / "+1h" / "tomorrow 9am" maps deterministically (by
-- message_id, no fuzzy name matching) back to THAT exact reminder and completes or snoozes
-- it. Without this column the feature is inert (the bot just treats the reply as a normal
-- message) — fully fail-safe, nothing breaks before it's run.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.assistant_reminders
  ADD COLUMN IF NOT EXISTS last_ping_message_id BIGINT;

-- Look up the reminder a ping-reply targets (owner + message_id), among open reminders.
CREATE INDEX IF NOT EXISTS assistant_reminders_ping_idx
  ON public.assistant_reminders (owner_user_id, last_ping_message_id)
  WHERE last_ping_message_id IS NOT NULL;
