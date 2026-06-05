-- ─────────────────────────────────────────────────────────────────────────────
-- Message email-reminder throttle. The admin can MANUALLY email a candidate who
-- isn't reading/answering their Borivon messages ("you have unread messages").
-- It's a button, never automatic — but to protect email credits + sender
-- reputation (spam), each candidate can only be emailed this reminder once every
-- 72h. We stamp the last send here and gate on it server-side.
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_profiles
  add column if not exists last_msg_email_at timestamptz;
