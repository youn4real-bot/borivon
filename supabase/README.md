# Supabase migrations

All schema changes live here as standalone `.sql` files. The owner
runs them by hand in the Supabase SQL Editor — never ship a feature
that depends on a new column without also writing the migration and
flagging the SQL to the owner.

Every file is idempotent (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS`, etc.) so they're
safe to re-run.

## From-zero apply order

If you ever need to bootstrap a fresh Supabase project, apply in this
order. (Inside each group, order doesn't usually matter.)

### 1 — Core profile + auth scaffold
- `passport_status.sql` — adds `passport_status` enum + column.
- `add_address_columns.sql` — `address_street`, `address_number`,
  `address_postal`, `city_of_residence`, `country_of_residence`.
- `add_phone.sql` — `phone` column. (Critical — every SELECT touching
  passport fields includes this column; missing column → entire
  query fails silently.)
- `profile_photo.sql` — `profile_photo` URL + storage bucket.
- `passport_confirmed_fields.sql` — per-field confirmation array.
- `manually_verified.sql` — supreme-admin verified flag.
- `saved_signature.sql` — candidate's handwritten signature.
- `cv_draft.sql` — JSONB column the CV builder autosaves into.
- `cv_use_agency_branding.sql` — admin-only CV branding toggle.

### 2 — Documents + notifications
- `documents.sql` — file index (Drive file id + status).
- `notifications.sql` + `notifications_update.sql` +
  `notifications_fix_silent_failures.sql` — candidate bell.
- `admin_notifications_types.sql` — admin bell.

### 3 — Multi-tenancy (orgs + sub-admins)
- `multi_tenancy.sql` — bootstraps `agencies` table (legacy).
- `organizations.sql` — `organizations`, `organization_members`,
  `candidate_organizations`. The CV branding source of truth.
- `organizations_branding.sql` — `logo_filename`, `footer_text`.
- `org_member_invite_code.sql` — second invite code for admin members.
- `candidate_status.sql` + variants — admin-only notes per candidate.
- `candidate_status_assign.sql` — denormalized assignment mirror.
- `candidate_status_b2_exam.sql` — B2 exam fields.
- `candidate_status_notes.sql` — internal admin notes.
- `candidate_status_vaccines.sql` — Masern / Varizell.

### 4 — Employer assignment
- `employers.sql` — employers table + `agency_id` FK to organizations
  + `candidate_profiles.employer_id` FK.
- `uksh_campus.sql` — legacy enum, still read by letter generator
  fallback. Slated for removal once all candidates have `employer_id`.

### 5 — Slot wizard (Bearbeitung / Visum)
- `phase_slots_pdf_has_native_fields.sql` — slot template flag.
- `sign_requests.sql` + `sign_requests_v2.sql` + `add_sign_request_action.sql`
  — legacy sign-request flow.

### 6 — Misc
- `matching.sql` — `org_requirements`, `suggested_matches`.
- `payments.sql` — Stripe payment tier.
- `messages.sql` — admin ↔ candidate chat.
- `feed.sql` + `feed_org.sql` — community feed.
- `community_seen.sql` — read-receipt tracking.
- `admin_saved_signature.sql` — per-admin signature.
- `agency_profiles.sql` — per-admin employer-block auto-fill.
- `invite_tokens.sql` — sub-admin invite tokens.
- `hard_delete_user.sql` — destructive user removal.

### One-time data setups (not schema)
- `calmaroi_logo.sql` — points Calmaroi's row at its existing logo file.
- `calmaroi_branding.sql` — seeds Calmaroi's CV footer text.
- `archive_existing_cover_letters.sql` — one-time bulk archive.
- `silent_placement_cleanup.sql` — purges old "placement" bell rows.

## Conventions

- **Idempotent or bust.** Every script must be re-runnable. Use
  `IF NOT EXISTS` / `IF EXISTS` everywhere.
- **No destructive ops** without explicit owner approval. Drops,
  cascades, truncates require a heads-up — they're never silent.
- **One file per change.** Don't append to old migrations; new column
  = new file.
- **RLS by default.** New tables get `ENABLE ROW LEVEL SECURITY` with
  zero policies (service-role only) unless the client side genuinely
  needs anon access. Comment WHY policies exist when they do.
