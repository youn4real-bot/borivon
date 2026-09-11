/**
 * Input rules for the self-read routes under /api/portal/me/{profile,notifications}.
 *
 * These routes replace the browser's direct Supabase reads (step P0 of the
 * Supabase → D1 migration): the browser used to query candidate_profiles /
 * documents / notifications itself, protected only by row-level security. Now
 * it asks our server, which checks who is asking and reads with the service
 * role. Pure + unit-tested so the allow-lists can't drift silently.
 */
import { UUID_RE } from "@/lib/uuid";

/**
 * Every candidate_profiles column the browser has ever read about ITSELF (the
 * union of the old direct reads). Anything else is refused — the list is the
 * contract, and a new screen that needs a new column adds it here on purpose.
 */
export const ME_PROFILE_COLUMNS: ReadonlySet<string> = new Set([
  "first_name", "last_name", "dob", "sex", "nationality",
  "city_of_birth", "country_of_birth",
  "passport_no", "passport_expiry", "issuing_authority", "issue_date",
  "address_street", "address_number", "address_postal",
  "city_of_residence", "country_of_residence",
  "marital_status", "children_ages", "phone",
  "passport_confirmed_fields", "passport_status",
  "manually_verified", "payment_tier", "profile_photo", "cv_draft",
]);

/** "a, b,c" → ["a","b","c"] when every name is allowed; null otherwise. */
export function parseProfileCols(raw: string | null | undefined): string[] | null {
  const names = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!names.length || names.length > ME_PROFILE_COLUMNS.size) return null;
  if (!names.every((n) => ME_PROFILE_COLUMNS.has(n))) return null;
  return [...new Set(names)];
}

export type MarkReadRequest = { ids?: string[]; action?: "event_invite" };

/**
 * PATCH body for marking the caller's own notifications read:
 *   { ids: [uuid, …] }                    — those rows (max 100)
 *   { all: true }                         — every unread row
 *   { all: true, action: "event_invite" } — every unread calendar invite
 * Anything else → null (400).
 */
export function parseMarkRead(body: unknown): MarkReadRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { ids?: unknown; all?: unknown; action?: unknown };
  const action = b.action === undefined ? undefined : b.action === "event_invite" ? "event_invite" as const : null;
  if (action === null) return null;
  if (b.ids !== undefined) {
    if (!Array.isArray(b.ids) || b.ids.length === 0 || b.ids.length > 100) return null;
    if (!b.ids.every((x) => typeof x === "string" && UUID_RE.test(x))) return null;
    return { ids: [...new Set(b.ids as string[])], action };
  }
  return b.all === true ? { action } : null;
}
