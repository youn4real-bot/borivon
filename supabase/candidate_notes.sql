-- ─────────────────────────────────────────────────────────────────────────────
-- Candidate NOTES — the founder's free-text observations about a candidate
-- ("passed the external interview", "wants a March start", "bailed out").
--
-- This is the HUMAN layer the portal can't derive from documents/pipeline:
-- dictated to the Telegram assistant ("note Amina: passed external interview")
-- and read back by getCandidateDossier / listCandidateNotes ("x Amina" → the
-- whole file including these notes, newest first). Later phases (WhatsApp
-- ingest) will append here too via the `source` column.
--
-- RLS is ENABLED with no policies → only the service role (the assistant
-- route) can read/write. No anon/authenticated access path exists — candidates
-- and org members can NEVER see these notes.
--
-- ▶ Run once in the Supabase SQL editor (required before the notes feature works).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.candidate_notes (
  id                uuid primary key default gen_random_uuid(),
  candidate_user_id uuid not null,
  author_email      text not null,
  note              text not null,
  source            text not null default 'telegram',
  created_at        timestamptz not null default now()
);

create index if not exists candidate_notes_candidate_idx
  on public.candidate_notes (candidate_user_id, created_at desc);

alter table public.candidate_notes enable row level security;
-- No policies on purpose: service-role only (the assistant route uses the
-- service client). Bypassed by service role, blocked for everyone else.
