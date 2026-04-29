-- ─────────────────────────────────────────────────────────────────────────────
-- Run this once in Supabase → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. CANDIDATE NOTIFICATIONS (approved / rejected by admin)
create table if not exists notifications (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  doc_id      uuid        not null,
  doc_name    text        not null,
  doc_type    text        not null,
  action      text        not null check (action in ('approved', 'rejected')),
  feedback    text,
  read        boolean     not null default false,
  created_at  timestamptz not null default now()
);

alter table notifications enable row level security;

create policy "candidates read own notifications"
  on notifications for select using (auth.uid() = user_id);

create policy "candidates mark own notifications read"
  on notifications for update using (auth.uid() = user_id);

-- real-time so bell updates instantly
alter publication supabase_realtime add table notifications;


-- 2. ADMIN NOTIFICATIONS (new signups + new uploads)
create table if not exists admin_notifications (
  id          uuid        default gen_random_uuid() primary key,
  type        text        not null check (type in ('signup', 'upload')),
  user_name   text        not null default '',
  user_email  text        not null default '',
  doc_type    text,        -- for 'upload' events
  doc_name    text,        -- for 'upload' events
  read        boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- Only service-role can write; admin user can read via API (bypasses RLS with service key)
alter table admin_notifications enable row level security;

-- Allow the admin's authenticated session to SELECT (for real-time channel)
-- Replace with your actual admin email if you want real-time in the bell
-- create policy "admin reads" on admin_notifications for select using (auth.jwt()->>'email' = 'YOUR_ADMIN_EMAIL');
