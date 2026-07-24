-- Feature #4 — DROPPED COMMITMENTS ("Anna said she'd send the Fahrplan, and never did").
--
-- The bot already tracks two things, and NEITHER catches this:
--   • lib/followups.ts  — I emailed them, they never replied.
--   • lib/gmailApi classifyThreadFollowUp — POSITIONAL: it only looks at who sent
--     the LAST message in a thread.
-- So when someone REPLIES with a promise ("I'll send the Fahrplan Friday"), their
-- message IS the last one — the promise itself is invisible and quietly dies.
--
-- This table stores CONTENT-level promises other people made to the founder, so
-- an unfulfilled one can be surfaced on demand ("what is everyone owing me?") and
-- chased when it goes past due.
--
-- Fully additive + idempotent. All code is fail-safe: until this is run the
-- feature is a silent no-op (never a crash, never spam).
--
-- ▶ Run once in the Supabase SQL editor.

create table if not exists public.assistant_commitments (
  id                bigserial primary key,
  owner_user_id     uuid        not null,
  who_email         text        not null,          -- who promised
  who_name          text,
  what              text        not null,          -- "the Fahrplan", "the signed contract"
  due_at            timestamptz,                   -- stated deadline, when they gave one
  promised_at       timestamptz not null default now(),
  source_message_id text,                          -- the Gmail message it came from
  source_subject    text,
  status            text        not null default 'open'
                      check (status in ('open','done','dropped')),
  last_nudge_at     timestamptz,
  nudge_count       int         not null default 0,
  created_at        timestamptz not null default now()
);

-- One row per (promise, source email) — re-scanning the same message must never
-- duplicate it. COALESCE keeps the constraint usable when no message id is known.
create unique index if not exists assistant_commitments_src_idx
  on public.assistant_commitments (owner_user_id, coalesce(source_message_id, ''), what);

-- The hot read: "what's still open for me, soonest first".
create index if not exists assistant_commitments_open_idx
  on public.assistant_commitments (owner_user_id, status, due_at);
