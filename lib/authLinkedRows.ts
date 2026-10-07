/**
 * Every row tied to a login, cleared before the login itself goes.
 *
 * On Supabase, app_delete_user (supabase/hard_delete_user.sql) deletes from
 * every table whose foreign key points at auth.users(id), then the auth row.
 * D1 holds the data now but not the logins, so it has none of those foreign
 * keys: deleting the login would leave this person's rows behind in D1 —
 * personal data of a deleted account, and rows a rollback's parity check
 * would find missing from Supabase. So callers run this on the service client
 * FIRST (on D1 these are ordinary journaled deletes), then the RPC, which
 * lib/d1/serviceFetch.ts sends to Supabase to do the same there plus the login.
 * On "supabase" the RPC finds these rows already gone; nothing changes.
 *
 * The list is the live catalog's foreign keys to auth.users
 * (d1/snapshot/catalog-*.json); tests/authLinkedRows.test.ts fails if they
 * drift apart. Like app_delete_user it DELETES every one, whatever the key's
 * own ON DELETE says. (The delete-user route nulls pdf_field_mappings.created_by
 * beforehand so shared PDF mappings survive; this then matches nothing there.)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const AUTH_LINKED_ROWS: readonly { table: string; column: string }[] = [
  { table: "google_calendar_tokens", column: "user_id" },
  { table: "documents", column: "user_id" },
  { table: "notifications", column: "user_id" },
  { table: "candidate_profiles", column: "user_id" },
  { table: "messages", column: "thread_user_id" },
  { table: "messages", column: "sender_user_id" },
  { table: "invite_tokens", column: "used_by" },
  { table: "candidate_journey_items", column: "candidate_user_id" },
  { table: "pdf_field_mappings", column: "created_by" },
  { table: "agency_profiles", column: "user_id" },
  { table: "community_seen", column: "user_id" },
  { table: "candidate_status", column: "user_id" },
  { table: "classroom_consent", column: "user_id" },
  { table: "academy_cohort_members", column: "candidate_user_id" },
  { table: "academy_tab_access", column: "user_id" },
  { table: "classroom_invites", column: "user_id" },
  { table: "academy_attendance", column: "candidate_user_id" },
  { table: "academy_submissions", column: "candidate_user_id" },
  { table: "academy_point_events", column: "candidate_user_id" },
  { table: "academy_student_badges", column: "candidate_user_id" },
];

/** Deletes them all; the first failure is returned and the login must then stay. */
export async function deleteAuthLinkedRows(
  db: SupabaseClient,
  userId: string,
): Promise<{ error: string | null }> {
  for (const { table, column } of AUTH_LINKED_ROWS) {
    const { error } = await db.from(table).delete().eq(column, userId);
    if (error) return { error: `${table}.${column}: ${error.message}` };
  }
  return { error: null };
}
