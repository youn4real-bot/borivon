-- ─────────────────────────────────────────────────────────────────────────────
-- Add a THIRD manual-checklist bucket: the org↔Borivon channel.
--
-- An org admin's "Shared" tab now has two sub-lists:
--   • scope 'shared'    + org_id = X  → internal: only that org's admins.
--   • scope 'shared_hq' + org_id = X  → private channel between org X's admins
--                                        and Borivon HQ (supreme + sub-admins).
-- HQ global list is unchanged: scope 'shared' + org_id NULL.
--
-- This just widens the CHECK constraint to permit the new scope value and adds
-- a matching partial index. Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.admin_checklist_items
  drop constraint if exists admin_checklist_items_scope_check;

alter table public.admin_checklist_items
  add constraint admin_checklist_items_scope_check
  check (scope in ('personal', 'shared', 'shared_hq'));

create index if not exists idx_admin_checklist_shared_hq
  on public.admin_checklist_items (org_id) where scope = 'shared_hq';
