-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY: candidates may READ their own rows from the browser — never write.
--
-- Found by the live catalog capture (2026-09-11):
--   • documents had a dashboard-created policy "Users manage own documents"
--     FOR ALL using/with check auth.uid() = user_id. With her own login a
--     candidate could PATCH /rest/v1/documents and set status='approved' on her
--     own passport/diploma, insert rows, or hard-delete them (LAW #33).
--   • messages let a candidate INSERT into / UPDATE any column of her thread
--     (including the admin's messages).
--   • notifications let her UPDATE any column of her own notifications.
--
-- What the browser actually does (verified by grep of every client file and
-- every createClient call — no server code acts as the user):
--   documents      → SELECT only (dashboard list + realtime)
--   notifications  → SELECT + UPDATE { read: true } only (NotificationBell)
--   messages       → nothing directly (realtime SELECT only)
-- Every real write goes through API routes with the service role, which RLS and
-- these grants do not affect.
-- ▶ Run once in the Supabase SQL editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Users manage own documents" on public.documents;
drop policy if exists "candidates read own documents" on public.documents;
create policy "candidates read own documents" on public.documents
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.documents from anon, authenticated;

drop policy if exists "candidates insert own thread" on public.messages;
drop policy if exists "candidates mark own read" on public.messages;
revoke insert, update, delete on public.messages from anon, authenticated;

revoke insert, update, delete on public.notifications from anon, authenticated;
grant update (read) on public.notifications to authenticated;
