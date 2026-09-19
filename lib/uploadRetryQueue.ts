/**
 * The wait between upload attempts.
 *
 * A backoff is a floor, not a sentence. The two moments a mobile upload becomes
 * possible again are the radio coming back and the candidate switching back to
 * the tab — waiting out the rest of an 8-second timer past either of those is
 * dead time she spends staring at a stalled bar.
 *
 * Extracted from the dashboard so the parts that can do real damage are
 * testable without a browser: firing twice would re-POST a 20 MB body, and a
 * leaked listener would fire a retry for a slot that is no longer on screen.
 */

type Listenable = {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
};

export interface RetryScheduler {
  /** Queue `run` after `delayMs`, or sooner if the page comes back online / visible. */
  schedule(delayMs: number, run: () => void): void;
  /** Drop a queued retry and its listeners. Safe to call when nothing is queued. */
  cancel(): void;
}

export function createRetryScheduler(
  win: Listenable,
  doc: Listenable & { visibilityState?: string },
  timers: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (h: unknown) => void;
  } = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
): RetryScheduler {
  let teardown: (() => void) | null = null;

  const cancel = () => {
    const t = teardown;
    teardown = null;
    t?.();
  };

  return {
    cancel,
    schedule(delayMs: number, run: () => void) {
      // A new attempt supersedes anything already queued — never two in flight.
      cancel();
      let fired = false;
      const onOnline = () => fire();
      const onVisible = () => { if (doc.visibilityState !== "hidden") fire(); };
      const cleanup = () => {
        timers.clearTimeout(handle);
        win.removeEventListener("online", onOnline);
        doc.removeEventListener("visibilitychange", onVisible);
        teardown = null;
      };
      function fire() {
        if (fired) return; // online + visibilitychange can land in the same tick
        fired = true;
        cleanup();
        run();
      }
      const handle = timers.setTimeout(fire, delayMs);
      teardown = cleanup;
      win.addEventListener("online", onOnline);
      doc.addEventListener("visibilitychange", onVisible);
    },
  };
}
