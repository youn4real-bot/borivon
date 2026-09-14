/**
 * Change detection for polled rows.
 *
 * A postgres_changes handler only ran when the row CHANGED. A poll hands back
 * the same row every few seconds, so a handler ported naively would re-run on
 * every tick: re-dispatching "payment tier changed" / "profile photo changed"
 * window events, re-checking the verified celebration, and — the one that
 * matters — pushing server values over passport fields the candidate is typing
 * but hasn't saved yet. Diffing successive snapshots restores "only on change".
 */

// null and undefined both mean "no value": a row that doesn't exist yet (an
// empty baseline) must not report every null column as a change once it appears.
const norm = (v: unknown): string => JSON.stringify(v ?? null) ?? "null";

/** The keys whose value differs between two snapshots (deep, via JSON). */
export function changedKeys<K extends string>(
  prev: Readonly<Record<string, unknown>> | null | undefined,
  next: Readonly<Record<string, unknown>> | null | undefined,
  keys: readonly K[],
): K[] {
  return keys.filter((k) => norm(prev?.[k]) !== norm(next?.[k]));
}

/**
 * Structural equality for API payloads (row lists, one pipeline row). Used to
 * keep React state identity stable when a poll returns what is already on
 * screen, so effects keyed on that state don't re-run every tick.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  return norm(a) === norm(b);
}
