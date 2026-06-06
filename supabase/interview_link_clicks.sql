-- ─────────────────────────────────────────────────────────────────────────────
-- Interview-link engagement tracking. The interview link (Teams/Zoom) is given
-- to the candidate ONLY through the portal (JourneyView "Join" button) — a
-- deliberate habit hook (they must come to the platform to join). We can't see
-- inside the employer's meeting, but we CAN log that they opened the link from
-- here: how many times + when last. That's the closest honest "they showed up"
-- signal, and the admin sees it in the pipeline peek.
--
--   interview_link_clicks          how many times the candidate opened the link
--   interview_link_last_clicked_at the most recent open
--
-- interview_link / interview_date already exist on candidate_pipeline.
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_pipeline
  add column if not exists interview_link_clicks          integer     not null default 0,
  add column if not exists interview_link_last_clicked_at timestamptz;
