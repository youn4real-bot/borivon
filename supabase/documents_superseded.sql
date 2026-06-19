-- ─────────────────────────────────────────────────────────────────────────────
-- Archive / retire a document — WITHOUT deleting it (LAW #33).
--
-- "That's the wrong file on Asmae — archive it, I'll re-upload the correct one."
-- The bot's archiveDocument(docId) sets superseded_at on that row, which HIDES it
-- from every active doc list (candidate dashboard, admin review, the bot's doc
-- tools, the checklist) — but the row AND the stored bytes are KEPT (LAW #33: never
-- delete a candidate document; it stays recoverable). Reversible: set back to null.
--
-- Fail-safe: until this runs, the column is absent → the filters treat every row as
-- active (nothing hidden) and archiveDocument returns needs_migration.
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.documents
  add column if not exists superseded_at timestamptz;

-- Hot path: active docs for a candidate (most reads filter "superseded_at is null").
create index if not exists documents_active_idx
  on public.documents (user_id) where superseded_at is null;
