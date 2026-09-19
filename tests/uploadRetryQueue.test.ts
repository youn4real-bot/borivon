import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRetryScheduler } from "@/lib/uploadRetryQueue";

/** A minimal event target that also reports how many listeners it still holds —
 *  a leaked one fires a retry for a slot that is no longer on screen. */
function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    emit(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    count() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
  };
}

describe("createRetryScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(visibilityState = "visible") {
    const win = fakeTarget();
    const doc = Object.assign(fakeTarget(), { visibilityState });
    return { win, doc, s: createRetryScheduler(win, doc) };
  }

  it("runs the retry after the backoff", () => {
    const { s } = setup();
    const run = vi.fn();
    s.schedule(3_000, run);
    vi.advanceTimersByTime(2_999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("goes immediately when the phone comes back online", () => {
    // The whole reason for the listener: the backoff is a floor, and signal
    // returning is exactly the moment the upload can succeed.
    const { win, s } = setup();
    const run = vi.fn();
    s.schedule(8_000, run);
    win.emit("online");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("goes immediately when she switches back to the tab", () => {
    const { doc, s } = setup();
    const run = vi.fn();
    s.schedule(8_000, run);
    doc.emit("visibilitychange");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores a visibilitychange that means the tab was just hidden", () => {
    const { doc, s } = setup("hidden");
    const run = vi.fn();
    s.schedule(8_000, run);
    doc.emit("visibilitychange");
    expect(run).not.toHaveBeenCalled();
  });

  it("NEVER runs twice — a second trigger cannot re-POST the body", () => {
    const { win, doc, s } = setup();
    const run = vi.fn();
    s.schedule(5_000, run);
    win.emit("online");
    doc.emit("visibilitychange");
    win.emit("online");
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("leaves no listener behind once it has fired", () => {
    const { win, doc, s } = setup();
    s.schedule(1_000, () => {});
    expect(win.count() + doc.count()).toBe(2);
    vi.advanceTimersByTime(1_000);
    expect(win.count() + doc.count()).toBe(0);
  });

  it("cancel() drops both the timer and the listeners", () => {
    const { win, doc, s } = setup();
    const run = vi.fn();
    s.schedule(5_000, run);
    s.cancel();
    win.emit("online");
    vi.advanceTimersByTime(60_000);
    expect(run).not.toHaveBeenCalled();
    expect(win.count() + doc.count()).toBe(0);
  });

  it("cancel() on an empty queue is a no-op", () => {
    const { s } = setup();
    expect(() => { s.cancel(); s.cancel(); }).not.toThrow();
  });

  it("a fresh upload supersedes the retry queued for the previous one", () => {
    // Starting a new pick while a retry is pending must not leave two attempts
    // racing for the same slot.
    const { s } = setup();
    const first = vi.fn();
    const second = vi.fn();
    s.schedule(5_000, first);
    s.schedule(1_000, second);
    vi.advanceTimersByTime(60_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
