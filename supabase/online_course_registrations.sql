-- Online-course registrations submitted from the public /online-courses page.
-- The previous flow tried to write these into admin_notifications, whose
-- `type` CHECK constraint only allows signup/upload/doc-* — so every submit
-- 500'd ("insert_failed"). This dedicated table stores the full structured
-- lead and powers the admin "Online Courses" list.
--
-- ▶ Run this once in the Supabase SQL editor BEFORE the feature works.

create table if not exists online_course_registrations (
  id          uuid        default gen_random_uuid() primary key,
  first_name  text        not null default '',
  last_name   text        not null default '',
  email       text        not null,
  phone       text        not null default '',
  address     text        not null default '',
  group_slot  text        not null default '',   -- chosen time group, e.g. "18:00 – 20:00"
  level       text        not null default '',   -- chosen level, e.g. "B2"
  created_at  timestamptz not null default now()
);

create index if not exists idx_ocr_created_at on online_course_registrations (created_at desc);
create index if not exists idx_ocr_email      on online_course_registrations (email);

-- Service-role only: the API writes with the service key and the admin list
-- reads with the service key (gated by requireAdminRole). Deny anon/auth by
-- default — no public policy, so RLS blocks direct client access.
alter table online_course_registrations enable row level security;
