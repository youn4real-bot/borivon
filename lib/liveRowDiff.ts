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
 *   - A column with NO baseline yet (prev = null, or a partial seed that didn't
 *     include it) takes this read as its baseline and applies nothing — the
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
 *   - The next snapshot always holds every watched column (missing = null), so
 *     a row that appears later is diffed column by column like any other.
 */
export function planLiveRowStep(
  prev: Readonly<Record<string, unknown>> | null,
  row: Readonly<Record<string, unknown>>,
  cols: { always: readonly string[]; deferrable: readonly string[]; defer: boolean },
): LiveRowStep {
  const next: Record<string, unknown> = { ...(prev ?? {}) };
  const apply = new Set<string>();
  const hasBaseline = (k: string) => !!prev && Object.prototype.hasOwnProperty.call(prev, k);
  for (const k of [...cols.always, ...cols.deferrable]) {
    const incoming = row[k] ?? null;
    if (!hasBaseline(k)) { next[k] = incoming; continue; }
    if (norm(prev![k]) === norm(incoming)) continue;
    if (cols.defer && !cols.always.includes(k)) continue; // held back, snapshot not advanced
    next[k] = incoming;
    apply.add(k);
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

// ─── The live row as a whole: snapshot + "could this read be stale?" ────────

/** A read taken within this long after a local edit may predate that edit's save. */
export const LOCAL_EDIT_GUARD_MS = 3_000;
/** A save still unanswered after this long no longer holds the sync back (it hung). */
export const SAVE_STALE_MS = 60_000;

export type LiveRowTracker = {
  /** The user just typed / ticked a box on this row. */
  markLocalEdit(): void;
  /** Wrap every write of this row; while it is out (and just after), reads are held back. */
  trackSave<T>(p: Promise<T>): Promise<T>;
  /** Call BEFORE the read's await; hand the result to step()/seed(). */
  readStart(): number;
  /**
   * The page itself loaded these columns (e.g. its bootstrap) and put them on
   * screen: they become the baseline, and any poll read that started before
   * this one is dropped as older than the screen.
   */
  seed(key: string, values: Record<string, unknown>, readStartedAt: number): void;
  /** One poll read. null = the read is older than what the page shows; skip it. */
  step(
    key: string,
    row: Readonly<Record<string, unknown>>,
    readStartedAt: number,
    cols: { always: readonly string[]; deferrable: readonly string[] },
  ): LiveRowStep | null;
  /** Would a read started at `readStartedAt` possibly miss the user's own writes? */
  mayMissLocalWrites(readStartedAt: number): boolean;
};

/**
 * The dashboard's passport row, where a stale read does real damage.
 *
 * The first port checked "did she edit in the last 3 s?" when the poll's
 * RESPONSE arrived. On a cold Worker (2-5 s) a read sent while she was typing
 * could pick up an in-between draft save ("Sch") and land more than 3 s after
 * her last keystroke: the guard said "not editing", the older value went over
 * "Schmidt" in the open modal — or re-ticked a confirmation box she had just
 * unticked — and the 800 ms draft autosave then POSTed that older value back,
 * leaving a box saved as ticked with no human tick last (LAW #38).
 *
 * So the question is asked about the moment the read STARTED, and about her
 * saves rather than only her keystrokes: a read is held back if she edited
 * within the guard before it started (her debounced save may not have fired),
 * if any save of hers is still in flight, or if one landed after the read
 * started (the read may predate it). Realtime never had this problem because
 * it delivered events in commit order; a poll has to prove its read is newer.
 *
 * `key` is the account: a different key starts from scratch, so a switch of
 * user can never diff one person's row against another's.
 */
export function createLiveRowTracker(opts: {
  now?: () => number;
  guardMs?: number;
  saveStaleMs?: number;
} = {}): LiveRowTracker {
  const now = opts.now ?? (() => Date.now());
  const guardMs = opts.guardMs ?? LOCAL_EDIT_GUARD_MS;
  const saveStaleMs = opts.saveStaleMs ?? SAVE_STALE_MS;

  let key: string | null = null;
  let snapshot: Record<string, unknown> | null = null;
  let seededAt = Number.NEGATIVE_INFINITY;
  let lastEditAt = Number.NEGATIVE_INFINITY;
  let lastSaveSettledAt = Number.NEGATIVE_INFINITY;
  const savesOut = new Map<number, number>(); // id -> started at
  let nextSaveId = 0;

  const useKey = (k: string) => {
    if (k === key) return;
    key = k;
    snapshot = null;
    seededAt = Number.NEGATIVE_INFINITY;
  };

  const tracker: LiveRowTracker = {
    markLocalEdit() { lastEditAt = now(); },
    trackSave(p) {
      const id = nextSaveId++;
      savesOut.set(id, now());
      const done = () => { savesOut.delete(id); lastSaveSettledAt = now(); };
      p.then(done, done);
      return p;
    },
    readStart: () => now(),
    mayMissLocalWrites(readStartedAt) {
      if (lastEditAt > readStartedAt - guardMs) return true;
      if (lastSaveSettledAt >= readStartedAt) return true;
      const t = now();
      for (const startedAt of savesOut.values()) if (t - startedAt < saveStaleMs) return true;
      return false;
    },
    seed(k, values, readStartedAt) {
      useKey(k);
      snapshot = { ...(snapshot ?? {}), ...values };
      seededAt = Math.max(seededAt, readStartedAt);
    },
    step(k, row, readStartedAt, cols) {
      useKey(k);
      if (readStartedAt < seededAt) return null;
      const plan = planLiveRowStep(snapshot, row, { ...cols, defer: tracker.mayMissLocalWrites(readStartedAt) });
      snapshot = plan.next;
      return plan;
    },
  };
  return tracker;
}
