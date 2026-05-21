-- ─────────────────────────────────────────────────────────────────────────────
-- Run once in Supabase → SQL Editor.
--
-- Adds missing indexes to the heaviest hot-query paths the portal hits.
-- Idempotent — uses CREATE INDEX IF NOT EXISTS so re-running is safe.
--
-- Audit pass 5 finding: the original notifications.sql / sign_requests.sql /
-- (untracked) documents schema never declared indexes on the columns every
-- single page query filters by. With a few hundred candidates × dozens of
-- docs / sigreqs / notifs each, postgres falls back to seq-scan and the bell
-- load / dashboard render slowly grows from <50ms to multi-second.
--
-- Every index here is BACKED BY a real query in the app:
--   • notifications.user_id              ← /api/portal/me/notifications (bell)
--   • notifications.user_id + read       ← unread-count badge
--   • admin_notifications.created_at     ← admin bell list (ORDER BY DESC)
--   • admin_notifications.user_email     ← /api/portal/admin/delete-user cleanup
--   • documents.user_id                  ← every dashboard / admin doc list
--   • documents.user_id + file_type      ← passport lookup, slot doc resolve
--   • documents.drive_file_id            ← /api/portal/file proxy (.eq("drive_file_id"))
--   • sign_requests.candidate_user_id    ← /api/portal/me/sign-requests
--   • sign_requests.status               ← admin pending-sign queue
--   • candidate_profiles.passport_status ← admin pending-passport queue
--   • candidate_profiles.agency_id       ← admin per-agency filter
--   • phase_slots.org_id + phase         ← phase-slot resolve per org
--   • messages.thread_user_id            ← message bell + threads
--   • sub_admin_assignments.sub_admin_email ← role lookup
-- ─────────────────────────────────────────────────────────────────────────────

-- ── notifications (candidate bell) ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS notifications_user_id_idx
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id) WHERE read = false;

-- ── admin_notifications (admin bell) ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS admin_notifications_created_at_idx
  ON public.admin_notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_notifications_user_email_idx
  ON public.admin_notifications (user_email);

CREATE INDEX IF NOT EXISTS admin_notifications_unread_idx
  ON public.admin_notifications (read, created_at DESC) WHERE read = false;

-- ── documents (the heaviest table — every dashboard + admin view hits it) ─
CREATE INDEX IF NOT EXISTS documents_user_id_idx
  ON public.documents (user_id);

CREATE INDEX IF NOT EXISTS documents_user_id_file_type_idx
  ON public.documents (user_id, file_type);

CREATE INDEX IF NOT EXISTS documents_drive_file_id_idx
  ON public.documents (drive_file_id) WHERE drive_file_id IS NOT NULL;

-- ── sign_requests (signature flow) ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS sign_requests_candidate_user_id_idx
  ON public.sign_requests (candidate_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sign_requests_status_idx
  ON public.sign_requests (status) WHERE status = 'pending';

-- ── candidate_profiles (admin pipeline + per-agency filter) ───────────────
CREATE INDEX IF NOT EXISTS candidate_profiles_passport_status_idx
  ON public.candidate_profiles (passport_status) WHERE passport_status = 'pending';

CREATE INDEX IF NOT EXISTS candidate_profiles_agency_id_idx
  ON public.candidate_profiles (agency_id) WHERE agency_id IS NOT NULL;

-- ── phase_slots (per-org or global slot resolution) ───────────────────────
CREATE INDEX IF NOT EXISTS phase_slots_org_phase_idx
  ON public.phase_slots (org_id, phase, position);

-- ── messages (thread lookup, admin bell) ──────────────────────────────────
-- Only create if the messages table exists — it's added via a later migration
-- (admin/messages route). Wrap in DO block so this file stays safe to re-run
-- before that migration lands.
DO $$
BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS messages_thread_user_id_idx
      ON public.messages (thread_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS messages_sender_user_id_idx
      ON public.messages (sender_user_id, created_at DESC);
  END IF;
END$$;

-- ── sub_admin_assignments (role lookup per request) ───────────────────────
DO $$
BEGIN
  IF to_regclass('public.sub_admin_assignments') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS sub_admin_assignments_email_idx
      ON public.sub_admin_assignments (sub_admin_email);
    CREATE INDEX IF NOT EXISTS sub_admin_assignments_candidate_idx
      ON public.sub_admin_assignments (candidate_user_id);
  END IF;
END$$;

-- ── invite_tokens (redeem path) ───────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.invite_tokens') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS invite_tokens_code_idx
      ON public.invite_tokens (code);
    CREATE INDEX IF NOT EXISTS invite_tokens_org_id_idx
      ON public.invite_tokens (org_id) WHERE org_id IS NOT NULL;
  END IF;
END$$;
