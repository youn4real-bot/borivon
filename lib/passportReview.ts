/**
 * Passport-data review — pure helpers shared by the admin dashboard panel and
 * the pipeline-peek review modal. Kept framework-free so it's unit-testable.
 *
 * LAW #38: the per-field confirmation is a HUMAN-ONLY gate — boxes start
 * unchecked every session and approval is blocked until every FILLED field is
 * ticked. `canApprove` encodes exactly that rule (it never auto-confirms).
 * LAW #39: nothing here touches passport bytes — these are profile text fields.
 */

export type PassportProfile = {
  first_name: string | null; last_name: string | null;
  dob: string | null; sex: string | null; nationality: string | null;
  passport_no: string | null; passport_expiry: string | null;
  city_of_birth: string | null; country_of_birth: string | null;
  issuing_authority: string | null; issue_date: string | null;
  address_street: string | null; address_number: string | null;
  address_postal: string | null; city_of_residence: string | null;
  country_of_residence: string | null;
  passport_status: string | null; passport_feedback: string | null;
  marital_status: string | null; children_ages: string | null;
};

export type PassportField = { label: string; value: string };
export type PassportGroup = { title: string; fields: PassportField[] };

/** Raw profile columns snapshotted into the approve PATCH (mirrors the admin
 *  reviewPassport SNAPSHOT_FIELDS so the row reflects exactly what was confirmed). */
export const PASSPORT_SNAPSHOT_FIELDS = [
  "first_name", "last_name", "dob", "sex", "nationality",
  "passport_no", "passport_expiry", "city_of_birth", "country_of_birth",
  "issuing_authority", "issue_date",
  "address_street", "address_number", "address_postal",
  "city_of_residence", "country_of_residence",
  "marital_status", "children_ages",
] as const;

/** "is this display value a real, filled value (not the em-dash placeholder)?" */
export function isFilled(value: string | null | undefined): boolean {
  return !!(value && value !== "—" && value.trim() !== "");
}

/** Labels of every FILLED field across the groups — the set that must be confirmed. */
export function filledFieldLabels(groups: PassportGroup[]): string[] {
  return groups.flatMap((g) => g.fields.filter((f) => isFilled(f.value)).map((f) => f.label));
}

/**
 * LAW #38 approve gate: true ONLY when there is at least one filled field AND
 * every filled field's label is present in `confirmed`. Empty `confirmed` (the
 * fresh state) can never approve — boxes are never auto-checked.
 */
export function canApprove(groups: PassportGroup[], confirmed: ReadonlySet<string>): boolean {
  const labels = filledFieldLabels(groups);
  return labels.length > 0 && labels.every((l) => confirmed.has(l));
}

/** Count of filled fields still awaiting a human tick. */
export function unconfirmedCount(groups: PassportGroup[], confirmed: ReadonlySet<string>): number {
  return filledFieldLabels(groups).filter((l) => !confirmed.has(l)).length;
}
