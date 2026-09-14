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
 *   - A run that never answers is abandoned after a deadline. Browser fetch has
 *     no timeout, so one dead socket (a phone switching from wifi to 4G, a stuck
 *     Worker request) used to hold `inFlight` forever: no tick, no tab-return
 *     refetch, no refresh() — the bell, the chat and the admin's live passport
 *     view (LAW #38) froze until reload. The deadline counts as a failure (so it
 *     backs off), aborts the run's signal (so a fetch given that signal is
 *     really cancelled) and moves on; a late answer is ignored.
 *   - A request that was already out when the tab was hidden is restarted on
 *     return instead of waited for: that is exactly the request whose socket
 *     died while the phone was locked.
 *   - stop() kills everything: timer, listeners, and the AbortSignal the run
 *     receives, so a response landing after unmount can't set state.
 *
 * Pure (no React) so the timing rules are unit-tested with fake timers; the
 * React wrapper is lib/usePolling.ts.
 */

/**
 * One poll. Resolve `false` (or throw) to report a failure — that drives the
 * backoff. Anything else counts as success. Pass `signal` to every fetch and
 * check `signal.aborted` after every await before touching state: it flips
 * when the poller is stopped, when the run hits its deadline, when a tab
 * return restarts it, and when the next run starts.
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
  /**
   * Longest one run may stay unanswered before it is abandoned. Default
   * runDeadline(intervalMs): max(15 s, 3 x the interval at run start).
   */
  timeoutMs?: number;
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
/**
 * Floor for a run's deadline. A cold Worker answers in 2-5 s; a 5 s chat poll
 * with a 3x deadline would abandon healthy-but-slow reads, so never below this.
 */
export const MIN_RUN_TIMEOUT_MS = 15_000;

/** Delay before the next tick after `failures` consecutive failures. */
export function backoffDelay(intervalMs: number, failures: number, maxBackoffMs: number): number {
  if (failures <= 0) return intervalMs;
  const cap = Math.max(intervalMs, maxBackoffMs);
  return Math.min(cap, intervalMs * 2 ** Math.min(failures, 20));
}

/** How long one run may stay unanswered before the loop abandons it. */
export function runDeadline(intervalMs: number, timeoutMs?: number): number {
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs)) return Math.max(MIN_INTERVAL_MS, timeoutMs);
  return Math.max(MIN_RUN_TIMEOUT_MS, 3 * intervalMs);
}

type Outcome = "ok" | "fail" | "timeout" | "abandoned";
type ActiveRun = {
  ctrl: AbortController;
  settle: (o: Outcome) => void;
  deadline: ReturnType<typeof setTimeout> | null;
};

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
  let lastHiddenAt = Number.NEGATIVE_INFINITY;
  let lastDoneAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The run currently awaited, if any. Identity is the "is this still mine?" check. */
  let active: ActiveRun | null = null;
  /** The most recent run's controller, settled or not — aborted by the next run and by stop(). */
  let lastCtrl: AbortController | null = null;

  const hidden = () => !!doc?.hidden;
  const clearTimer = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  /** Let go of the in-flight run without waiting for it: abort it, ignore its answer. */
  function abandonActive() {
    const run = active;
    if (!run) return;
    active = null;
    inFlight = false;
    if (run.deadline !== null) { clearTimeout(run.deadline); run.deadline = null; }
    run.ctrl.abort();
    run.settle("abandoned");
  }

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
    // One live signal at a time: the previous run's leftovers can't land over this one.
    lastCtrl?.abort();
    const ctrl = new AbortController();
    lastCtrl = ctrl;
    inFlight = true;
    lastStartAt = now();

    let settle: (o: Outcome) => void = () => {};
    const outcome = new Promise<Outcome>((resolve) => { settle = resolve; });
    const run: ActiveRun = { ctrl, settle, deadline: null };
    run.deadline = setTimeout(() => { run.deadline = null; settle("timeout"); }, runDeadline(intervalMs, opts.timeoutMs));
    active = run;
    try {
      Promise.resolve(opts.run(ctrl.signal)).then(
        (v) => settle(v === false ? "fail" : "ok"),
        () => settle("fail"),
      );
    } catch {
      settle("fail");
    }

    // The first of: the run's answer, its deadline, or stop()/tab-return letting go.
    const result = await outcome;
    if (run.deadline !== null) { clearTimeout(run.deadline); run.deadline = null; }
    if (active !== run) return; // let go of — whoever did that owns the loop now
    active = null;
    inFlight = false;
    if (result === "timeout") ctrl.abort(); // cancel the stuck fetch; its late answer must not set state
    failures = result === "ok" ? 0 : failures + 1;
    lastDoneAt = now();
    if (rerunQueued) {
      rerunQueued = false;
      void runNow();
      return;
    }
    scheduleNext();
  }

  function wake() {
    if (stopped || hidden()) return;
    if (inFlight) {
      // Sent before the tab was hidden: on a phone that socket most likely died
      // with the lock screen. Waiting for its deadline would leave the screen
      // stale for up to a minute right when she looks at it.
      if (lastStartAt <= lastHiddenAt) {
        abandonActive();
        rerunQueued = false;
        void runNow();
      }
      return;
    }
    if (now() - lastStartAt < wakeGapMs) {
      if (timer === null) scheduleNext();
      return;
    }
    void runNow();
  }

  const onVisibility = () => {
    if (hidden()) { clearTimer(); lastHiddenAt = now(); }
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
      abandonActive();
      lastCtrl?.abort();
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
