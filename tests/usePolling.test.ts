// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePolling, type UsePollingOptions } from "@/lib/usePolling";
import type { PollRun } from "@/lib/poller";

/**
 * The React wrapper, mounted for real (jsdom + react-dom). What it must
 * guarantee on top of the pure poller: a token rotation (new `run` closure) is
 * picked up WITHOUT restarting the loop, a candidate switch (resetKey) DOES
 * restart it and drops the old in-flight response, and unmount stops it cold.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let hidden = false;
let container: HTMLDivElement;
let root: Root;
let refresh: () => void = () => {};

function Probe(props: { run: PollRun } & UsePollingOptions) {
  const { run, ...opts } = props;
  refresh = usePolling(run, opts).refresh;
  return null;
}

async function render(props: { run: PollRun } & UsePollingOptions) {
  await act(async () => { root.render(createElement(Probe, props)); });
}
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

describe("usePolling", () => {
  it("fetches on mount, polls at the interval, and stops cold on unmount", async () => {
    const signals: AbortSignal[] = [];
    const run = vi.fn<PollRun>(async (s) => { signals.push(s); return true; });
    await render({ run, intervalMs: 5_000 });
    expect(run).toHaveBeenCalledTimes(1);
    await tick(10_000);
    expect(run).toHaveBeenCalledTimes(3);

    await act(async () => { root.unmount(); });
    expect(signals.every((s) => s.aborted)).toBe(true);
    await tick(60_000);
    window.dispatchEvent(new Event("focus"));
    await tick(0);
    expect(run).toHaveBeenCalledTimes(3);
    root = createRoot(container); // afterEach unmounts again
  });

  it("uses the LATEST closure without restarting (token rotation)", async () => {
    const seen: string[] = [];
    const runWith = (token: string): PollRun => async () => { seen.push(token); return true; };
    await render({ run: runWith("jwt-1"), intervalMs: 5_000 });
    await render({ run: runWith("jwt-2"), intervalMs: 5_000 }); // onAuthStateChange refreshed the token
    expect(seen).toEqual(["jwt-1"]); // re-render alone fires nothing
    await tick(5_000);
    expect(seen).toEqual(["jwt-1", "jwt-2"]);
  });

  it("restarts on resetKey change and drops the previous key's response", async () => {
    const signals: Record<string, AbortSignal[]> = {};
    const runFor = (key: string): PollRun => async (s) => { (signals[key] ??= []).push(s); return true; };
    await render({ run: runFor("cand-a"), intervalMs: 8_000, resetKey: "cand-a" });
    await tick(1_000);
    await render({ run: runFor("cand-b"), intervalMs: 8_000, resetKey: "cand-b" });
    expect(signals["cand-a"][0].aborted).toBe(true);
    expect(signals["cand-b"]).toHaveLength(1); // immediate run for the newly opened candidate
    expect(signals["cand-b"][0].aborted).toBe(false);
  });

  it("does nothing while disabled and starts when enabled", async () => {
    const run = vi.fn<PollRun>(async () => true);
    await render({ run, intervalMs: 5_000, enabled: false });
    await tick(30_000);
    expect(run).not.toHaveBeenCalled();
    await render({ run, intervalMs: 5_000, enabled: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("immediate:false skips the mount fetch", async () => {
    const run = vi.fn<PollRun>(async () => true);
    await render({ run, intervalMs: 15_000, immediate: false });
    expect(run).not.toHaveBeenCalled();
    await tick(15_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("an intervalMs change applies to the running loop", async () => {
    const run = vi.fn<PollRun>(async () => true);
    await render({ run, intervalMs: 30_000 });
    await render({ run, intervalMs: 2_000 }); // thread opened
    await tick(2_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("pauses in a hidden tab and refetches on return", async () => {
    const run = vi.fn<PollRun>(async () => true);
    await render({ run, intervalMs: 5_000 });
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("refresh() refetches now", async () => {
    const run = vi.fn<PollRun>(async () => true);
    await render({ run, intervalMs: 30_000 });
    await tick(3_000);
    await act(async () => { refresh(); });
    await tick(0);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
