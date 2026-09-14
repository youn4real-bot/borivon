/**
 * Visibility-aware, single-flight polling loop — the replacement for Supabase
 * Realtime `postgres_changes` subscriptions.
 *
 * WHY: once the database lives in Cloudflare D1, rows stop changing inside
 * Supabase, so every postgres_changes channel goes silent for good. The bell,
 * the chat badge, document statuses, the admin's live passport-OCR view (LAW
 * #38) and the pipeline unlocks would all freeze until a reload. Polling our own
 * authorised API routes works identically on BOTH backends, so it can ship
 * before the switch.
 *
 * The rules this enforces, each one a failure it prevents:
 *   - Only while the tab is visible. A backgrounded tab left open overnight must
 *     not hammer the Worker (and, today, Supabase egress) every few seconds.
 *   - Refetch the moment the tab comes back (visibilitychange / focus). Realtime
 *     had no replay either, so a change made while the phone was locked used to
 *     stay invisible until reload; this closes that window.
 *   - Never overlap. The next tick is scheduled only after the previous request
 *     settles, so a slow cold-start Worker (2-5 s TTFB) can't stack requests
 *     and land them out of order over each other.
 *   - Back off on errors (2x per failure, capped). A 429 or an outage must not
 *     be answered with the same request rate that caused or worsens it.
 *   - stop() kills everything: timer, listeners, and the AbortSignal the run
 *     receives, so a response landing after unmount can't set state.
 *
 * Pure (no React) so the timing rules are unit-tested with fake timers; the
 * React wrapper is lib/usePolling.ts.
 */

/**
 * One poll. Resolve `false` (or throw) to report a failure — that drives the
 * backoff. Anything else counts as success. Check `signal.aborted` after every
 * await before touching state: it flips when the poller is stopped.
 */
export type PollRun = (signal: AbortSignal) => Promise<boolean | void> | boolean | void;

type Listenable = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

/** Injectable browser surface — tests pass fakes; the app uses the real globals. */
export type PollerEnv = {
  doc?: (Listenable & { readonly hidden: boolean }) | null;
  win?: Listenable | null;
  now?: () => number;
};

export type PollerOptions = {
  run: PollRun;
  /** Cadence while visible and healthy. */
  intervalMs: number;
  /**
   * Run once as soon as start() is called (default true). This first run is the
   * mount load, so it happens even in a hidden tab — only the REPEATING ticks
   * are visibility-gated. Pass false where the page's bootstrap already fetched
   * the same data, so mounting doesn't double every request.
   */
  immediate?: boolean;
  /** Ceiling for the error backoff (never below intervalMs). */
  maxBackoffMs?: number;
  /**
   * Focus and visibilitychange usually fire together on tab return; a wake-up
   * within this long after the last request started is folded into the schedule
   * instead of firing a second request.
   */
  wakeGapMs?: number;
  env?: PollerEnv;
};

export type Poller = {
  start(): void;
  stop(): void;
  /** Change the cadence; the pending tick is re-timed from the last completion. */
  setIntervalMs(ms: number): void;
  /** Refetch now (e.g. after a broadcast ping). Queues ONE rerun if a request is in flight. */
  trigger(): void;
};

/** A misconfigured 0 ms interval must never become a request storm. */
export const MIN_INTERVAL_MS = 500;
export const DEFAULT_MAX_BACKOFF_MS = 120_000;
export const DEFAULT_WAKE_GAP_MS = 2_000;

/** Delay before the next tick after `failures` consecutive failures. */
export function backoffDelay(intervalMs: number, failures: number, maxBackoffMs: number): number {
  if (failures <= 0) return intervalMs;
  const cap = Math.max(intervalMs, maxBackoffMs);
  return Math.min(cap, intervalMs * 2 ** Math.min(failures, 20));
}

export function createPoller(opts: PollerOptions): Poller {
  const env = opts.env ?? {};
  const doc = env.doc !== undefined ? env.doc : (typeof document !== "undefined" ? document : null);
  const win = env.win !== undefined ? env.win : (typeof window !== "undefined" ? window : null);
  const now = env.now ?? (() => Date.now());
  const maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const wakeGapMs = opts.wakeGapMs ?? DEFAULT_WAKE_GAP_MS;
  const clampInterval = (ms: number) => (Number.isFinite(ms) ? Math.max(MIN_INTERVAL_MS, ms) : MIN_INTERVAL_MS);

  let intervalMs = clampInterval(opts.intervalMs);
  let started = false;
  let stopped = false;
  let inFlight = false;
  let rerunQueued = false;
  let failures = 0;
  let lastStartAt = Number.NEGATIVE_INFINITY;
  let lastDoneAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();

  const hidden = () => !!doc?.hidden;
  const clearTimer = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  function scheduleNext() {
    clearTimer();
    // In flight: the completion schedules. Hidden: the visibility wake-up does.
    if (stopped || inFlight || hidden()) return;
    const due = lastDoneAt + backoffDelay(intervalMs, failures, maxBackoffMs);
    timer = setTimeout(onTimer, Math.max(0, due - now()));
  }

  function onTimer() {
    timer = null;
    if (stopped || hidden()) return;
    void runNow();
  }

  async function runNow() {
    if (stopped || inFlight) return;
    clearTimer();
    inFlight = true;
    lastStartAt = now();
    let ok = false;
    try {
      ok = (await opts.run(controller.signal)) !== false;
    } catch {
      ok = false;
    }
    inFlight = false;
    if (stopped) return;
    failures = ok ? 0 : failures + 1;
    lastDoneAt = now();
    if (rerunQueued) {
      rerunQueued = false;
      void runNow();
      return;
    }
    scheduleNext();
  }

  function wake() {
    if (stopped || hidden() || inFlight) return;
    if (now() - lastStartAt < wakeGapMs) {
      if (timer === null) scheduleNext();
      return;
    }
    void runNow();
  }

  const onVisibility = () => {
    if (hidden()) clearTimer();
    else wake();
  };
  const onFocus = () => wake();

  return {
    start() {
      if (started || stopped) return;
      started = true;
      doc?.addEventListener("visibilitychange", onVisibility);
      win?.addEventListener("focus", onFocus);
      lastDoneAt = now();
      if (opts.immediate !== false) void runNow();
      else scheduleNext();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimer();
      doc?.removeEventListener("visibilitychange", onVisibility);
      win?.removeEventListener("focus", onFocus);
      controller.abort();
    },
    setIntervalMs(ms: number) {
      const next = clampInterval(ms);
      if (next === intervalMs) return;
      intervalMs = next;
      if (started && timer !== null) scheduleNext();
    },
    trigger() {
      if (!started || stopped) return;
      if (inFlight) { rerunQueued = true; return; }
      void runNow();
    },
  };
}
