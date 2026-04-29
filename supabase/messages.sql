-- ─────────────────────────────────────────────────────────────────────────────
-- Direct messaging between candidates and the admin (super-admin only inbox).
--
-- One conversation per candidate. Both sides post into the same table tagged
-- by sender_role; thread_user_id is always the candidate's user_id (so admin
-- replies are scoped to the right candidate without needing a separate threads
-- table).
--
-- Run this once in Supabase → SQL Editor. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists messages (
  id              uuid        default gen_random_uuid() primary key,
  thread_user_id  uuid        not null references auth.users(id) on delete cascade,
  sender_user_id  uuid        not null references auth.users(id) on delete set null,
  sender_role     text        not null check (sender_role in ('candidate', 'admin')),
  body            text        not null default '',
  -- Optional small screenshot, stored inline as a data: URL (PNG/JPEG, ≤ 600 KB
  -- encoded). Keeps the feature self-contained — no separate storage bucket.
  attachment      text,
  -- Free-form tag so we can distinguish bug reports from regular messages.
  kind            text        not null default 'message' check (kind in ('message', 'bug')),
  read_by_admin   boolean     not null default false,
  read_by_candidate boolean   not null default true,  -- candidate is the author by default
  created_at      timestamptz not null default now()
);

create index if not exists messages_thread_idx on messages(thread_user_id, created_at desc);
create index if not exists messages_unread_admin_idx on messages(read_by_admin) where read_by_admin = false;

alter table messages enable row level security;

-- Candidates: can read & insert messages in their own thread. Cannot pretend
-- to be admin (sender_role check is enforced server-side too).
drop policy if exists "candidates read own thread" on messages;
create policy "candidates read own thread"
  on messages for select using (auth.uid() = thread_user_id);

drop policy if exists "candidates insert own thread" on messages;
create policy "candidates insert own thread"
  on messages for insert with check (
    auth.uid() = thread_user_id
    and auth.uid() = sender_user_id
    and sender_role = 'candidate'
  );

drop policy if exists "candidates mark own read" on messages;
create policy "candidates mark own read"
  on messages for update using (auth.uid() = thread_user_id);

-- Admin reads everything via service-role key in API routes (bypasses RLS).
-- No direct admin RLS policy needed.

-- Real-time so unread badge updates instantly on both sides.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end$$;
