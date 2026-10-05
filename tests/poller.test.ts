import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPoller, backoffDelay, runDeadline, MIN_INTERVAL_MS, type PollRun } from "@/lib/poller";

/**
 * The polling loop that replaced Supabase Realtime postgres_changes. Every rule
 * here maps to a concrete failure: a hidden tab hammering the Worker, stacked
 * requests landing out of order on a cold start, an outage answered at full
 * request rate, and a response landing after unmount.
 */

function fakeEnv() {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = new EventTarget();
  return {
    env: { doc, win },
    setHidden(h: boolean) {
      doc.hidden = h;
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    focus() { win.dispatchEvent(new Event("focus")); },
  };
}

/** A run whose every call stays pending until released. */
function deferredRun() {
  const releases: Array<(v: boolean) => void> = [];
  const run = vi.fn<PollRun>(() => new Promise<boolean>((res) => { releases.push(res); }));
  return { run, release: (v = true) => releases.shift()?.(v), pending: () => releases.length };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

describe("createPoller — cadence", () => {
  it("runs immediately on start, then once per interval", async () => {
    const f = fakeEnv();
    const run = vi.fn<PollRun>(async () => true);
    const p = createPoller({ run, intervalMs: 5_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(5);
    p.stop();
  });

  it("immediate:false waits one full interval (bootstrap already fetched)", async () => {
    const f = fakeEnv();
    const run = vi.fn<PollRun>(async () => true);
    const p = createPoller({ run, intervalMs: 15_000, immediate: false, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it("clamps a zero interval instead of spinning", async () => {
    const f = fakeEnv();
    const run = vi.fn<PollRun>(async () => true);
    const p = createPoller({ run, intervalMs: 0, immediate: false, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 4);
    expect(run).toHaveBeenCalledTimes(4);
    p.stop();
  });

  it("setIntervalMs re-times the pending tick from the last completion", async () => {
    const f = fakeEnv();
    const run = vi.fn<PollRun>(async () => true);
    const p = createPoller({ run, intervalMs: 30_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(1);
    p.setIntervalMs(5_000); // e.g. the chat thread was opened
    await vi.advanceTimersByTimeAsync(1_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    p.stop();
  });
});

describe("createPoller — visibility", () => {
  it("pauses while hidden and refetches the moment the tab is visible again", async () => {
    const f = fakeEnv();
    const run = vi.fn<PollRun>(async () => true);
    const p = createPoller({ run, intervalMs: 5_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    f.setHidden(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);

    f.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    // and the cadence resumes from there
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it("a timer that fires while hidden is skipped, not run", async () => {
    const f = fakeEnv();
    const run = vi.fn<PollRun>(async () => true);
    const p = createPoller({ run, intervalMs: 5_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    f.env.doc.hidden = true; // hidden without an event (some browsers batch it)
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it("window focus refetches immediately", async () => {
    const f = fakeEnv();
    const run = vi.fn<PollRun>(async () => true);
    const p = createPoller({ run, intervalMs: 30_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(10_000);
    f.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("focus + visibilitychange together (tab return) cost ONE request", async () => {
    const f = fakeEnv();
    const run = vi.fn<PollRun>(async () => true);
    const p = createPoller({ run, intervalMs: 30_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(10_000);
    f.setHidden(true);
    await vi.advanceTimersByTimeAsync(10_000);
    f.setHidden(false);
    f.focus();
    await vi.advanceTimersByTimeAsync(0);
    f.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("the mount load still runs in a hidden tab, but nothing repeats until visible", async () => {
    const f = fakeEnv();
    f.env.doc.hidden = true;
    const run = vi.fn<PollRun>(async () => true);
    const p = createPoller({ run, intervalMs: 5_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    f.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    p.stop();
  });
});

describe("createPoller — no overlap", () => {
  it("never starts a second request while one is in flight", async () => {
    const f = fakeEnv();
    const d = deferredRun();
    // A deadline above the wait: this is slow-but-alive, not hung (see below).
    const p = createPoller({ run: d.run, intervalMs: 2_000, timeoutMs: 60_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(30_000); // a very slow cold start
    f.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(d.pending()).toBe(1);

    d.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.run).toHaveBeenCalledTimes(1); // next one is an interval AFTER completion
    await vi.advanceTimersByTimeAsync(2_000);
    expect(d.run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("trigger() during a request queues exactly one rerun", async () => {
    const f = fakeEnv();
    const d = deferredRun();
    const p = createPoller({ run: d.run, intervalMs: 30_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.trigger();
    p.trigger();
    p.trigger();
    expect(d.run).toHaveBeenCalledTimes(1);
    d.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.run).toHaveBeenCalledTimes(2);
    d.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.run).toHaveBeenCalledTimes(2);
    p.stop();
  });
});

describe("createPoller — backoff", () => {
  it("backoffDelay doubles per failure and respects the cap", () => {
    expect(backoffDelay(5_000, 0, 120_000)).toBe(5_000);
    expect(backoffDelay(5_000, 1, 120_000)).toBe(10_000);
    expect(backoffDelay(5_000, 3, 120_000)).toBe(40_000);
    expect(backoffDelay(5_000, 10, 120_000)).toBe(120_000);
    // a cap below the interval never makes polling FASTER
    expect(backoffDelay(30_000, 2, 10_000)).toBe(30_000);
    expect(backoffDelay(5_000, 10_000, 120_000)).toBe(120_000);
  });

  it("slows down on failures (false or throw) and snaps back after a success", async () => {
    const f = fakeEnv();
    let fail = true;
    const run = vi.fn<PollRun>(async () => {
      if (!fail) return true;
      if (run.mock.calls.length % 2) throw new Error("503");
      return false;
    });
    const p = createPoller({ run, intervalMs: 1_000, maxBackoffMs: 8_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(0);      // #1 fails
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);  // #2 at +2s, fails
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);      // #3 at +4s, fails
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8_000);  // #4 at +8s (capped), fails
    expect(run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(8_000);  // #5 still capped at 8s
    expect(run).toHaveBeenCalledTimes(5);

    fail = false;
    await vi.advanceTimersByTimeAsync(8_000);  // #6 succeeds
    expect(run).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1_000);  // back to the base cadence
    expect(run).toHaveBeenCalledTimes(7);
    p.stop();
  });

  it("returning undefined counts as success", async () => {
    const f = fakeEnv();
    const run = vi.fn<PollRun>(async () => undefined);
    const p = createPoller({ run, intervalMs: 1_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(4);
    p.stop();
  });
});

describe("createPoller — a request that never answers", () => {
  // Browser fetch has no timeout. Before the deadline, ONE dead socket froze
  // the loop for good: tab return, focus and refresh() all bailed on inFlight.
  it("runDeadline: 3x the interval, never below 15 s, overridable", () => {
    expect(runDeadline(2_000)).toBe(15_000);
    expect(runDeadline(15_000)).toBe(45_000);
    expect(runDeadline(5_000, 1_000)).toBe(1_000);
    expect(runDeadline(5_000, 0)).toBe(MIN_INTERVAL_MS);
  });

  it("is abandoned at the deadline: signal aborted, counted as a failure, loop moves on", async () => {
    const f = fakeEnv();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const run = vi.fn<PollRun>((s) => {
      signals.push(s);
      calls++;
      return calls === 1 ? new Promise<boolean>(() => {}) : Promise.resolve(true);
    });
    const p = createPoller({ run, intervalMs: 5_000, env: f.env }); // deadline = 15 s
    p.start();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);            // deadline hits at 15 s
    expect(signals[0].aborted).toBe(true);           // a fetch given this signal is cancelled
    await vi.advanceTimersByTimeAsync(9_999);        // failure -> backoff 2x interval
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);            // recovered at 25 s
    await vi.advanceTimersByTimeAsync(5_000);        // success snaps back to the base cadence
    expect(run).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it("a late answer from the abandoned run changes nothing", async () => {
    const f = fakeEnv();
    const d = deferredRun();
    const p = createPoller({ run: d.run, intervalMs: 5_000, timeoutMs: 3_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(3_000);        // run #1 abandoned (failure)
    await vi.advanceTimersByTimeAsync(10_000);       // run #2 starts at 13 s and hangs too...
    expect(d.run).toHaveBeenCalledTimes(2);
    d.release(true);                                 // ...#1 answers late
    await vi.advanceTimersByTimeAsync(0);
    expect(d.run).toHaveBeenCalledTimes(2);          // no extra run, no reschedule
    d.release(true);                                 // #2 answers in time
    await vi.advanceTimersByTimeAsync(0);
    expect(d.run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);        // #2's success is what drives the cadence
    expect(d.run).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it("trigger() during a hung run is honoured once the deadline frees the loop", async () => {
    const f = fakeEnv();
    const d = deferredRun();
    const p = createPoller({ run: d.run, intervalMs: 30_000, timeoutMs: 4_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.trigger();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(d.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(d.run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("tab return restarts a request that was already out when the tab was hidden", async () => {
    const f = fakeEnv();
    const d = deferredRun();
    const p = createPoller({ run: d.run, intervalMs: 5_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(1_000);
    const first = d.run.mock.calls[0][0];
    f.setHidden(true);                               // phone locked, socket dies
    await vi.advanceTimersByTimeAsync(5_000);
    f.setHidden(false);
    f.focus();                                       // both events: still ONE restart
    await vi.advanceTimersByTimeAsync(0);
    expect(d.run).toHaveBeenCalledTimes(2);
    expect(first.aborted).toBe(true);
    d.release(true);                                 // the stale one answering late is ignored
    await vi.advanceTimersByTimeAsync(0);
    expect(d.run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("focus without a hide does not cut a slow-but-alive request short", async () => {
    const f = fakeEnv();
    const d = deferredRun();
    const p = createPoller({ run: d.run, intervalMs: 5_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(4_000);        // a cold Worker, still answering
    f.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(d.run.mock.calls[0][0].aborted).toBe(false);
    p.stop();
  });

  it("stop() during a hung run leaves no timer behind", async () => {
    const f = fakeEnv();
    const d = deferredRun();
    const p = createPoller({ run: d.run, intervalMs: 5_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(1_000);
    p.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(d.run.mock.calls[0][0].aborted).toBe(true);
  });

  it("each run gets its own signal; starting the next aborts the previous one", async () => {
    const f = fakeEnv();
    const signals: AbortSignal[] = [];
    const run = vi.fn<PollRun>(async (s) => { signals.push(s); return true; });
    const p = createPoller({ run, intervalMs: 1_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    p.stop();
    expect(signals[1].aborted).toBe(true);
  });
});

describe("createPoller — cleanup", () => {
  it("stop() clears the timer, detaches listeners and aborts the signal", async () => {
    const f = fakeEnv();
    const signals: AbortSignal[] = [];
    const run = vi.fn<PollRun>(async (s) => { signals.push(s); return true; });
    const p = createPoller({ run, intervalMs: 1_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.stop();
    expect(signals[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    f.focus();
    f.setHidden(true);
    f.setHidden(false);
    p.trigger();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a request that settles after stop() schedules nothing", async () => {
    const f = fakeEnv();
    const d = deferredRun();
    const p = createPoller({ run: d.run, intervalMs: 1_000, env: f.env });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.stop();
    d.release();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("start() twice does not double the loop", async () => {
    const f = fakeEnv();
    const run = vi.fn<PollRun>(async () => true);
    const p = createPoller({ run, intervalMs: 1_000, env: f.env });
    p.start();
    p.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(3);
    p.stop();
  });
});
