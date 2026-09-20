/**
 * THE gold "verified" tick rule — single source of truth.
 *
 * A candidate shows the gold tick iff a supreme admin granted it
 * (candidate_profiles.manually_verified). Nothing else earns it: not passport
 * approval, not CV approval, and — since the paid plan was removed on
 * 2026-09-20 — nothing she can buy. The rule used to have a second arm for a
 * paid premium tier; that arm is gone, and payment_tier is not read anywhere.
 *
 * This MUST stay the only place the rule is written down. Several admin / chat
 * / feed / org views once each had their own copy of it, which is how they
 * drifted apart in the first place.
 */
export function isVerified(
  p: { manually_verified?: boolean | null } | null | undefined,
): boolean {
  return !!p && !!p.manually_verified;
}
