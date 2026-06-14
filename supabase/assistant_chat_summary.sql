-- ════════════════════════════════════════════════════════════════════════════
-- Rolling conversation summary for the bot — "effectively unlimited" memory.
-- ════════════════════════════════════════════════════════════════════════════
-- The bot keeps the recent ~50 messages verbatim (assistant_chat_turns) and
-- folds everything OLDER into one running prose summary stored here, which rides
-- along on every message. So "the 4 CVs we talked about" or "resend yesterday's
-- email" resolve indefinitely, while the prompt stays a bounded, cheap size
-- (compress-and-continue, like a long ChatGPT/Claude thread).
--
-- `summarized_through` is the watermark: every turn at/before this timestamp is
-- already captured in `summary`; turns after it are the live verbatim tail.
--
-- One row per admin (owner_user_id is the PK). Idempotent + additive. The code
-- is fail-safe: until this is run, lib/assistantChatHistory.ts just falls back
-- to the recent-turns window, so nothing breaks before you run it.
-- RUN THIS in the Supabase SQL editor.

create table if not exists assistant_chat_summary (
  owner_user_id       uuid primary key,
  summary             text not null default '',
  summarized_through  timestamptz,           -- turns <= this are folded into summary
  updated_at          timestamptz not null default now()
);

-- Service-role only (the app uses the service client; no anon RLS policy — same
-- posture as the other assistant_* tables). RLS on, no policy = locked down.
alter table assistant_chat_summary enable row level security;
