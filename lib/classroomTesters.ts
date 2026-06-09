/**
 * PERMANENT live-classroom test allowlist — the canonical "first test" pair that
 * is ALWAYS allowed, independent of the classroom_tester DB toggle, so a misclick,
 * a wiped column, or a not-yet-run migration can never drop it.
 *
 *   • Admin side  — the supreme admin (role === "admin") is already a permanent
 *                   host everywhere; no entry needed here.
 *   • Candidate side — Soufiane Jalal, the standing test candidate.
 *
 * Anything new is tested with THIS pair first, then migrated to other users by
 * flagging them via the classroom_tester column (admin toggle in the Status →
 * Engagement tab). Server-side only (never shipped to the client bundle).
 */
export const PERMANENT_TESTER_USER_IDS: readonly string[] = [
  "78936524-e9bd-4672-9fff-9025f7fbdb77", // Soufiane Jalal — permanent test candidate
];

export function isPermanentTester(userId: string | null | undefined): boolean {
  return !!userId && PERMANENT_TESTER_USER_IDS.includes(userId);
}

/**
 * THE reusable gate for any EXPERIMENTAL / in-test feature.
 *
 * Standing test pair = the supreme admin (role "admin") + the permanent test
 * candidate(s) (Soufiane). Pass the caller's resolved role + userId; a feature
 * gated on this is visible to EXACTLY those two and nobody else (sub-admins and
 * other candidates included). `columnFlag` lets a per-feature DB allowlist
 * widen it later (e.g. classroom_tester) without touching this core rule.
 *
 * Server-side. The client mirror is the `experimental` boolean on /me/role.
 */
export function canSeeExperimental(
  role: string | null | undefined,
  userId: string | null | undefined,
  columnFlag = false,
): boolean {
  if (role === "admin") return true;               // supreme admin — always
  return isPermanentTester(userId) || columnFlag === true; // Soufiane (permanent) / DB-flagged
}
