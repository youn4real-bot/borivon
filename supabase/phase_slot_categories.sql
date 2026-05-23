-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor. Idempotent.
--
-- Collapsible, reorderable CATEGORIES for the Bearbeitung / Visum document
-- slots. Admins group slot boxes into named categories (e.g. "UKSH",
-- "Calmaroi", "ABH"); candidates see the boxes grouped + can fold each
-- category. Drag-and-drop still reorders boxes within a category and moves
-- them between categories.
--
-- Model:
--   • phase_slot_categories — one row per category. Scoped per-org or
--     global, exactly like phase_slots (LAW #34). `position` orders the
--     categories within a phase. Deleting a category does NOT delete its
--     slots — the API first nulls their category_id (un-groups them).
--   • phase_slots.category_id — nullable FK. NULL = uncategorized (renders
--     ungrouped, same as before this feature existed → fully backward
--     compatible: existing slots stay flat until an admin groups them).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.phase_slot_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID,                                  -- NULL = global
  phase       TEXT        NOT NULL,                  -- 'bearbeitung' | 'visum'
  label       TEXT        NOT NULL DEFAULT '',
  position    INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS phase_slot_categories_scope_idx
  ON public.phase_slot_categories (phase, org_id, position);

-- Slot → category link. ON DELETE SET NULL so removing a category just
-- un-groups its slots (belt-and-suspenders; the API nulls them first too).
ALTER TABLE public.phase_slots
  ADD COLUMN IF NOT EXISTS category_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'phase_slots_category_fk'
  ) THEN
    ALTER TABLE public.phase_slots
      ADD CONSTRAINT phase_slots_category_fk
      FOREIGN KEY (category_id)
      REFERENCES public.phase_slot_categories(id)
      ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS phase_slots_category_idx
  ON public.phase_slots (category_id) WHERE category_id IS NOT NULL;
