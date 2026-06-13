-- ─────────────────────────────────────────────────────────────────────────────
-- Chat attachments → Cloudflare R2 (cut Supabase DB egress).
--
-- Until now chat image attachments were stored INLINE as base64 data-URLs in
-- messages.attachment (~600 KB each). The candidate chat re-fetches the whole
-- thread (up to 200 rows incl. every attachment) on a perpetual poll, so those
-- bytes left Supabase over and over — the single biggest egress source in the app.
--
-- New messages now store ONLY a Cloudflare R2 object key + mime (R2 egress is
-- free). The legacy `attachment` column stays for back-compat until the one-time
-- data migration (POST /api/portal/admin/migrate-chat-attachments-to-r2) moves
-- existing rows to R2 and nulls it out.
--
-- Run this once in Supabase → SQL Editor. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.messages
  add column if not exists attachment_key  text,
  add column if not exists attachment_mime text;

-- Cheap boolean for list/poll queries so we NEVER pull the heavy attachment
-- bytes just to know "does this message carry an image?". Covers BOTH the new
-- R2 path (attachment_key) and not-yet-migrated legacy rows (inline attachment).
-- Dropped + re-added so re-running picks up the latest expression.
alter table public.messages drop column if exists has_attachment;
alter table public.messages
  add column has_attachment boolean
  generated always as (
    attachment_key is not null
    or (attachment is not null and attachment <> '')
  ) stored;
