-- ─────────────────────────────────────────────────────────────────────────────
-- Telegram dedupe — recover from a DIED turn instead of silently losing the message.
--
-- The dedupe (telegram_updates) claims each update_id BEFORE processing so a retry
-- can't double-reply. But if a HEAVY turn exceeds the 60s function cap (or crashes)
-- BEFORE replying, the function dies, Telegram retries the same update, the retry
-- hits the primary-key conflict — and was being DROPPED. Result: the founder's
-- message got NO answer and the one recovery chance was gone (silent message loss
-- on exactly the slow, complex turns that matter most).
--
-- This adds `responded_at`: the webhook stamps it the instant it sends a reply. On a
-- retry the webhook can now tell the difference between "already answered" (drop the
-- retry) and "the earlier attempt died without answering" (re-process the retry). The
-- 60s hard function cap makes this unambiguous: a claim with responded_at still null
-- and older than ~65s CANNOT still be running, so it must have died → safe to reprocess.
--
-- Fail-safe: until this is run, the webhook's responded_at read errors and it falls
-- back to today's behaviour (drop the retry) — nothing breaks, the recovery is just off.
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.telegram_updates
  add column if not exists responded_at timestamptz;
