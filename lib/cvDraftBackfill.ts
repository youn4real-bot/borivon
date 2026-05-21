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

  const { data: existing, error: selErr } = await db
    .from("candidate_profiles")
    .select("first_name,last_name,address_street,address_number,address_postal,city_of_residence,country_of_residence,phone")
    .eq("user_id", userId)
    .maybeSingle();
  if (selErr) return `read: ${selErr.message ?? String(selErr)}`;

  const cur = (existing ?? {}) as Record<string, string | null | undefined>;
  const updates: Record<string, string> = {};
  for (const [col, val] of Object.entries(candidateFields)) {
    if (cur[col] == null || cur[col] === "") updates[col] = val;
  }
  if (Object.keys(updates).length === 0) return null;

  const { error: updErr } = await db
    .from("candidate_profiles")
    .update(updates)
    .eq("user_id", userId);
  if (updErr) return `update: ${updErr.message ?? String(updErr)}`;

  return null;
}
