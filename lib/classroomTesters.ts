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
