/**
 * Canonical personal-data mapping (LAW #37 — the "streamline").
 *
 * `candidate_profiles` is the SINGLE SOURCE OF TRUTH for passport / identity /
 * contact data. Every feature that reuses that data — the CV builder, the
 * generated CV, PDF AcroForm auto-fill, and ANY future project — must derive
 * its personal fields from THIS one function so an admin/sub-admin edit is
 * always reflected and downstream stores can never silently diverge.
 *
 * Server-safe: pure, no React, no DOM. Used both client-side (CV builder) and
 * server-side (admin PATCH → propagate into the stored cv_draft snapshot).
 */
import { natToLang } from "@/lib/countries";

/** ISO `YYYY-MM-DD` → German `DD.MM.YYYY` (passthrough if not ISO). */
export function isoToDDMMYYYY(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return String(iso);
}

/** Familienstand string for the CV from passport marital fields. */
export function computeFamilienstand(
  marital_status: string | null | undefined,
  children_ages: string | null | undefined,
): string {
  if (!marital_status) return "";
  if (marital_status === "ledig") return "ledig";
  let ages: number[] = [];
  try { ages = JSON.parse(children_ages || "[]"); } catch { ages = []; }
  if (!Array.isArray(ages) || ages.length === 0) return marital_status;
  const sorted = [...ages].filter(a => typeof a === "number" && a >= 0).sort((a, b) => b - a);
  if (sorted.length === 0) return marital_status;
  const kindStr = sorted.length === 1 ? "1 Kind" : `${sorted.length} Kinder`;
  return `${marital_status}, ${kindStr} (${sorted.join(", ")})`;
}

/** A candidate_profiles row (only the passport-derived columns are read). */
export interface ProfileLike {
  first_name?: string | null;
  last_name?: string | null;
  dob?: string | null;
  city_of_birth?: string | null;
  country_of_birth?: string | null;
  nationality?: string | null;
  city_of_residence?: string | null;
  country_of_residence?: string | null;
  address_postal?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  marital_status?: string | null;
  children_ages?: string | null;
}

/**
 * The canonical passport→CV field subset (camelCase, exactly the keys the CV
 * draft / form uses). MUST stay 1:1 with the CV builder's `pickPP` mapping —
 * both now come from here so they can never diverge.
 */
export function cvFieldsFromProfile(p: ProfileLike): Record<string, string> {
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  return {
    firstName:          s(p.first_name),
    lastName:           s(p.last_name),
    birthDate:          isoToDDMMYYYY(p.dob ?? null),
    birthPlace:         s(p.city_of_birth),
    countryOfBirth:     natToLang(p.country_of_birth, "de"),
    nationality:        natToLang(p.nationality, "de"),
    city:               s(p.city_of_residence),
    countryOfResidence: natToLang(p.country_of_residence, "de"),
    postalCode:         s(p.address_postal),
    address:            [p.address_street, p.address_number].filter(Boolean).join(" "),
    addressNumber:      s(p.address_number).trim(),
    maritalStatus:      computeFamilienstand(p.marital_status, p.children_ages),
  };
}

/** Profile columns that, when edited, must re-propagate into derived stores. */
export const PASSPORT_DERIVED_COLUMNS = [
  "first_name", "last_name", "dob", "city_of_birth", "country_of_birth",
  "nationality", "city_of_residence", "country_of_residence",
  "address_postal", "address_street", "address_number",
  "marital_status", "children_ages",
] as const;
