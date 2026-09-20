/**
 * "A blank form is not a fact." — the two guards that stand between a failed
 * read and a candidate's stored passport.
 *
 * WHAT HAPPENED. A nurse taps her passport box. The dashboard reads her
 * profile (`getMyProfile`), the read fails, the `{ data, error }` pair is
 * destructured as `{ data }` alone, and `data` is null — so the form opens with
 * eighteen empty inputs. Eight hundred milliseconds later the draft autosave
 * fires on exactly that emptiness: POST /api/portal/passport with every field
 * null and `confirmed_fields: []`. The route upserts it verbatim. Her name,
 * her passport number, the issue and expiry dates are gone, every LAW #38
 * confirmation tick is cleared — and because a draft deliberately preserves
 * the review status, `passport_status` still reads "approved", so no surface
 * anywhere shows a problem. Sixty-two profiles were exposed to this.
 *
 * Two shapes, one bug: a read that fails into a blank (A), and a write whose
 * emptiness nobody questions (B). This module answers both, as pure functions
 * so the rule is testable without a browser or a database:
 *
 *   classifyProfileRead  — the CLIENT half. "failed" is not "empty". A form
 *                          seeded from a failed read must never open, and
 *                          therefore never autosave.
 *   planPassportWrite    — the SERVER half, and the backstop that holds even
 *                          for an old or broken client: an all-blank payload
 *                          may never overwrite a row that holds data, and the
 *                          confirmation ticks are only ever rewritten when the
 *                          client actually sent the human-ticked list.
 */

/** The eighteen candidate_profiles columns the passport form owns. */
export const PASSPORT_DRAFT_FIELDS = [
  "first_name", "last_name", "dob", "sex", "nationality", "city_of_birth",
  "country_of_birth", "passport_no", "passport_expiry", "issuing_authority",
  "issue_date", "address_street", "address_number", "address_postal",
  "city_of_residence", "country_of_residence", "marital_status", "children_ages",
] as const;

export type PassportDraftField = (typeof PASSPORT_DRAFT_FIELDS)[number];

/** Any bag keyed by those columns — a request body, or a row read back. */
export type PassportFieldValues = Partial<Record<PassportDraftField, unknown>>;

/**
 * Does this bag hold a single real passport value? Whitespace is not a value:
 * a form autofilled with " " would otherwise count as data and defeat the
 * guard below.
 */
export function hasAnyPassportValue(v: PassportFieldValues | null | undefined): boolean {
  if (!v) return false;
  return PASSPORT_DRAFT_FIELDS.some((k) => {
    const raw = v[k];
    return typeof raw === "string" && raw.trim() !== "";
  });
}

/**
 * What a `{ data, error }` profile read actually means.
 *
 * The whole bug lives in the difference between the last two:
 *   "failed" — the request errored (offline, 500, expired JWT). We know
 *              NOTHING about what is stored. Rendering this as an empty form
 *              is the lie that started the wipe.
 *   "absent" — the request succeeded and there is genuinely no row yet. A
 *              brand-new candidate. An empty form is correct here.
 *   "loaded" — a row came back.
 */
export type ProfileReadVerdict = "failed" | "absent" | "loaded";

export function classifyProfileRead(
  res: { data: unknown; error?: string | null } | null | undefined,
): ProfileReadVerdict {
  // No result object at all is a failure, not an absence — a helper that threw
  // or returned undefined tells us nothing about the row.
  if (!res) return "failed";
  if (res.error) return "failed";
  if (res.data === null || res.data === undefined) return "absent";
  return "loaded";
}

/** Why a write was narrowed. `null` = nothing was held back. */
export type PassportWriteSkip = "blank_over_stored" | null;

export type PassportWritePlan = {
  /** Persist the eighteen field columns. */
  writeFields: boolean;
  /** Persist `passport_confirmed_fields` (LAW #38). */
  writeConfirmed: boolean;
  skipped: PassportWriteSkip;
};

/**
 * Decide what a passport save is allowed to touch.
 *
 * Rule 1 (LAW #38) — the confirmation ticks are rewritten ONLY when the client
 * supplied a real array. A body with no `confirmed_fields` key, or a malformed
 * one, used to be coerced to `[]` and written, which silently un-ticked boxes
 * no human had un-ticked. Absent means "I am not talking about the ticks",
 * never "clear them".
 *
 * Rule 2 — an entirely blank payload may not overwrite a row that holds
 * passport data. Clearing ONE field while others are filled is a real edit and
 * still goes through; eighteen-of-eighteen blank is never a real edit, it is a
 * form that was never loaded. This is the backstop that holds even if the
 * client-side guard is bypassed by a stale bundle on a candidate's phone.
 */
export function planPassportWrite(opts: {
  incoming: PassportFieldValues;
  /** The row as it stands, or null when there is genuinely no row yet. Never
   *  pass null to stand in for a read that FAILED — the caller must refuse the
   *  write in that case, because "unknown" is not "empty". */
  stored: PassportFieldValues | null;
  /** `Array.isArray(body.confirmed_fields)` — did the client actually send the list? */
  confirmedSupplied: boolean;
}): PassportWritePlan {
  if (!hasAnyPassportValue(opts.incoming) && hasAnyPassportValue(opts.stored)) {
    return { writeFields: false, writeConfirmed: false, skipped: "blank_over_stored" };
  }
  return { writeFields: true, writeConfirmed: opts.confirmedSupplied, skipped: null };
}
