-- ─────────────────────────────────────────────────────────────────────────────
-- Lead lifecycle — a status on each lead so the bot can track top-of-funnel.
--
-- The leads table only ever INSERTed rows (website form + createLead); there was no
-- way to mark a lead contacted / dead / converted, so "mark Sara contacted", "list
-- my cold leads", "how many never converted" were impossible. This adds:
--   • status        — 'new' | 'contacted' | 'dead' | 'converted' (default 'new').
--   • converted_at  — when a lead became a real candidate account.
--   • candidate_user_id — the account it converted into (if any).
--
-- Read by listLeads (status filter) + getLeadStats; written by setLeadStatus. Until
-- this runs, those tools fall back gracefully (status simply absent / 'new').
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.leads
  add column if not exists status            text not null default 'new',
  add column if not exists converted_at      timestamptz,
  add column if not exists candidate_user_id uuid;

create index if not exists leads_status_idx on public.leads (status, created_at desc);
