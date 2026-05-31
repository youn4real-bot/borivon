/**
 * THE gold "verified" tick rule — single source of truth.
 *
 * A candidate shows the gold tick iff EITHER:
 *   1. a supreme admin granted it (candidate_profiles.manually_verified), OR
 *   2. they hold a paid premium tier (candidate_profiles.payment_tier === "premium").
 *
 * This MUST be used everywhere a verified badge is computed. Several admin /
 * chat / feed / org views previously checked manually_verified ALONE, so a
 * paying premium candidate (e.g. someone who just checked out via Stripe) had
 * NO gold tick in those views even though /me/verified + the public profile
 * already showed it. Centralising the rule keeps the tick consistent for a
 * paying customer everywhere it appears.
 */
export function isVerified(
  p: { manually_verified?: boolean | null; payment_tier?: string | null } | null | undefined,
): boolean {
  return !!p && (!!p.manually_verified || p.payment_tier === "premium");
}
