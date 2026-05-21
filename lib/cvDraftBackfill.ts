/**
 * Reverse-propagate cv_draft personal fields into the candidate_profiles
 * passport columns when those columns are empty. Same logic used by both
 * /api/portal/me/cv-draft and /api/portal/admin/cv-draft after a draft
 * upsert succeeds.
 *
 * Coalesce semantics: only fills columns that are currently null/empty.
 * Never overwrites a value the admin or candidate previously approved.
 *
 * This is best-effort — the caller wraps it in a try/catch and treats
 * any failure here as non-fatal (the primary cv_draft save has already
 * succeeded by the time we run).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// Map: candidate_profiles column → matching cv_draft key on cvData.
const FIELD_MAP: ReadonlyArray<readonly [string, string]> = [
  ["first_name",           "firstName"],
  ["last_name",            "lastName"],
  ["address_street",       "address"],
  ["address_number",       "addressNumber"],
  ["address_postal",       "postalCode"],
  ["city_of_residence",    "city"],
  ["country_of_residence", "countryOfResidence"],
  ["phone",                "phone"],
];

/**
 * Apply the backfill. Caller passes the service-role supabase client and
 * the candidate's user_id + the cv_draft body that was just upserted.
 *
 * Returns null on success, an error string when something fails — caller
 * decides whether to log it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function backfillPassportFromCvDraft(
  db: SupabaseClient<any, any, any>,
  userId: string,
  body: unknown,
): Promise<string | null> {
  if (!body || typeof body !== "object") return null;
  const incoming = body as Record<string, unknown>;

  // Build the candidate set of column → value pairs.
  const candidateFields: Record<string, string> = {};
  for (const [col, draftKey] of FIELD_MAP) {
    const v = incoming[draftKey];
    if (typeof v === "string" && v.trim() !== "") candidateFields[col] = v.trim();
  }
  if (Object.keys(candidateFields).length === 0) return null;

  // RACE-SAFE: one UPDATE per field with `is(col, null)` in the WHERE.
  // Postgres evaluates the predicate atomically with the write, so a
  // concurrent PUT that just landed a value for `address_street` makes
  // the matching null-check fail → 0 rows updated. The old read-then-
  // write pattern allowed concurrent writers to clobber a fresh value
  // by reading null between the other writer's STEP 1 and STEP 2.
  for (const [col, val] of Object.entries(candidateFields)) {
    const { error: updErr } = await db
      .from("candidate_profiles")
      .update({ [col]: val })
      .eq("user_id", userId)
      .is(col, null);
    if (updErr) return `update(${col}): ${updErr.message ?? String(updErr)}`;
    // Separately mop up "" → val case (the null-check above misses
    // empty-string rows but those are equally safe to overwrite).
    const { error: updErr2 } = await db
      .from("candidate_profiles")
      .update({ [col]: val })
      .eq("user_id", userId)
      .eq(col, "");
    if (updErr2) return `update-empty(${col}): ${updErr2.message ?? String(updErr2)}`;
  }
  return null;
}
