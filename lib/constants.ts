/**
 * Shared constants — single source of truth for magic strings.
 *
 * Import with:  import { DOC_STATUSES, PASSPORT_FILE_TYPES, ... } from "@/lib/constants";
 *
 * Rules:
 *  - Never hardcode these values in individual files.
 *  - If a value needs to change, change it here and TypeScript will flag every callsite.
 */

import type { DocStatus } from "@/types";

// ─────────────────────────── Document statuses ───────────────────────────────

export const DOC_STATUSES: readonly DocStatus[] = ["pending", "approved", "rejected"] as const;

// ─────────────────────────── Document file types ─────────────────────────────

/**
 * All file_type values that count as "passport" for verification logic.
 * Used in both the public profile API and the verified-status API.
 */
export const PASSPORT_FILE_TYPES = ["Passport", "Reisepass", "Passeport"] as const;

/**
 * All file_type values that count as "German CV" for verification logic.
 */
export const CV_DE_FILE_TYPES = ["Lebenslauf (DE)", "Lebenslauf"] as const;

/**
 * Combined list of file types that contribute to candidate verification.
 * Use with Supabase `.in("file_type", VERIFICATION_FILE_TYPES)`.
 */
export const VERIFICATION_FILE_TYPES = [
  ...PASSPORT_FILE_TYPES,
  ...CV_DE_FILE_TYPES,
] as const;

// ─────────────────────────── Profile fields ──────────────────────────────────

/**
 * Allowlist of candidate_profiles columns that admins/sub-admins may update.
 * Any field NOT in this set is silently dropped (mass-assignment prevention).
 */
export const ALLOWED_PROFILE_FIELDS = new Set<string>([
  "first_name", "last_name", "dob", "sex", "nationality",
  "passport_no", "passport_expiry", "city_of_birth", "country_of_birth",
  "issuing_authority", "issue_date",
  "address_street", "address_number", "address_postal",
  "city_of_residence", "country_of_residence",
  "passport_status", "passport_feedback",
  "marital_status", "children_ages",
]);
// NOTE: `manually_verified` is intentionally NOT in this allowlist.
// It can ONLY be flipped via /api/portal/admin/verify-user, which requires
// the ultimate admin role (not sub-admins, not org members).

// ─────────────────────────── UI dimensions ───────────────────────────────────

/** Portal top navbar height in pixels */
export const NAVBAR_HEIGHT_PX = 58;

/** Mobile bottom action bar height in pixels (icon + padding + safe-area) */
export const MOBILE_BAR_HEIGHT_PX = 72;

// ─────────────────────────── Uploads / attachments ───────────────────────────

/** Max base64-encoded attachment size (~600 KB decoded) */
export const MAX_ATTACH_CHARS = 800_000;
