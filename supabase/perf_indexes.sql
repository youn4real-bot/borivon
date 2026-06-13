-- Hot-path performance indexes (audit 2026-06-13). All ADDITIVE + IF NOT EXISTS
-- — no behavior change, no LAW touched. Each removes a full-table seq-scan from
-- a frequently-hit query. Run this once in the Supabase SQL editor.

-- 1) Community unread-badge poll: feed/unread runs
--    feed_comments WHERE created_at > since (count) on a recurring poll for every
--    logged-in user. The only existing index leads with post_id, so created_at
--    can't be used → seq scan every poll.
create index if not exists feed_comments_created_at_idx
  on public.feed_comments (created_at desc);

-- 2) Supreme-admin inbox: admin/messages lists the newest 500 messages with
--    ORDER BY created_at DESC and NO thread filter (the founder's own inbox).
--    messages_thread_idx leads with thread_user_id → can't serve a global sort.
create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

-- 3) Admin panel load: admin route lists ALL documents ORDER BY uploaded_at DESC
--    with no user_id filter (supreme admin + regular sub-admins). Both existing
--    documents indexes lead with user_id → can't serve the global newest-first sort.
create index if not exists documents_uploaded_at_idx
  on public.documents (uploaded_at desc);
