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

export type LiveRowStep = {
  /** Watched columns that moved and must be applied NOW. */
  apply: Set<string>;
  /** The snapshot the next poll is diffed against. */
  next: Record<string, unknown>;
};

/**
 * One poll of a live row, decided purely so the rules are unit-tested:
 *
 *   - The FIRST read (prev = null) is the baseline and applies nothing — the
 *     page's bootstrap already put that state on screen; re-applying it would
 *     re-fire "verified" celebrations and window events on every mount.
 *   - `always` columns (admin-driven: status, verified, payment, photo) apply
 *     the moment they move, even while the user is typing.
 *   - `deferrable` columns (fields the user edits) are held back while `defer`
 *     is true, and their snapshot is NOT advanced — so a genuine change from
 *     another device is applied on the next quiet poll instead of being lost.
 *     Realtime delivered each change once; if a naive port advanced the
 *     snapshot here, an edit made on the phone while the laptop was mid-typing
 *     would never show on the laptop.
 */
export function planLiveRowStep(
  prev: Readonly<Record<string, unknown>> | null,
  row: Readonly<Record<string, unknown>>,
  cols: { always: readonly string[]; deferrable: readonly string[]; defer: boolean },
): LiveRowStep {
  if (!prev) return { apply: new Set(), next: { ...row } };
  const changed = changedKeys(prev, row, [...cols.always, ...cols.deferrable]);
  const next: Record<string, unknown> = { ...prev };
  const apply = new Set<string>();
  for (const k of cols.always) {
    next[k] = row[k];
    if (changed.includes(k)) apply.add(k);
  }
  if (!cols.defer) {
    for (const k of cols.deferrable) {
      next[k] = row[k];
      if (changed.includes(k)) apply.add(k);
    }
  }
  return { apply, next };
}

/**
 * Structural equality for API payloads (row lists, one pipeline row). Used to
 * keep React state identity stable when a poll returns what is already on
 * screen, so effects keyed on that state don't re-run every tick.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  return norm(a) === norm(b);
}
