-- ─────────────────────────────────────────────────────────────────────────────
-- ACADEMY — tab visibility control (supreme-admin only).
--
-- The Academy nav tab is a work-in-progress. The SUPREME admin (ADMIN_EMAIL)
-- controls who sees it:
--   • academy_settings.masked_all = true  → hidden from EVERYONE but supreme
--   • academy_tab_access(user_id, visible) → per-person override (allow / hide)
--
-- Resolution for a non-supreme user:
--   override exists → use override.visible
--   else           → visible = NOT masked_all
-- Supreme admin always sees it.
--
-- Seeded masked_all = TRUE: running this migration HIDES Academy from everyone
-- but you immediately (it's not ready for candidates yet). Flip it off / add
-- per-person exceptions from the Academy panel's Visibility card.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- Single-row global flag.
CREATE TABLE IF NOT EXISTS public.academy_settings (
  id          BOOLEAN     PRIMARY KEY DEFAULT TRUE,
  masked_all  BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academy_settings_single_row CHECK (id = TRUE)
);
INSERT INTO public.academy_settings (id, masked_all) VALUES (TRUE, TRUE)
  ON CONFLICT (id) DO NOTHING;

-- Per-person explicit override (allow or hide a specific user).
CREATE TABLE IF NOT EXISTS public.academy_tab_access (
  user_id     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  visible     BOOLEAN     NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: ON, no policies — only the service-role (server, supreme-gated) touches these.
ALTER TABLE public.academy_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_tab_access  ENABLE ROW LEVEL SECURITY;
