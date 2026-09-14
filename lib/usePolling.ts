"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPoller, type Poller, type PollRun } from "@/lib/poller";

/**
 * React wrapper around lib/poller — the ONE way a screen stays live now that
 * Supabase Realtime postgres_changes is gone (see lib/poller.ts for why and for
 * the timing rules: visible-only, refetch on return, single-flight, backoff).
 *
 *   const { refresh } = usePolling(async (signal) => {
 *     const r = await fetch("/api/portal/…", { headers: { Authorization: `Bearer ${accessToken}` } });
 *     if (signal.aborted || !r.ok) return false;
 *     setThing(await r.json());
 *   }, { intervalMs: 15_000, enabled: !!accessToken, resetKey: userId });
 *
 * `run` may change on every render: the loop always calls the LATEST one without
 * restarting. That is what keeps the auth token fresh — pages already update
 * their token state from onAuthStateChange, and the next tick simply closes over
 * the new token. Restarting on every token rotation would fire an extra request
 * each time and, worse, abort an in-flight one.
 *
 * The loop restarts (fresh signal, immediate run) only when `enabled` or
 * `resetKey` changes — e.g. the admin opens a different candidate, so a slow
 * response for the previous one is dropped via its aborted signal.
 *
 * Call it before any early return (tests/hooksOrder.test.ts).
 */
export type UsePollingOptions = {
  intervalMs: number;
  enabled?: boolean;
  /** Read when the loop (re)starts. See PollerOptions.immediate. */
  immediate?: boolean;
  resetKey?: string | number | boolean | null;
};

export function usePolling(
  run: PollRun,
  { intervalMs, enabled = true, immediate = true, resetKey = null }: UsePollingOptions,
): { refresh: () => void } {
  const runRef = useRef<PollRun>(run);
  const intervalRef = useRef(intervalMs);
  const immediateRef = useRef(immediate);
  const pollerRef = useRef<Poller | null>(null);

  // Declared first so it commits before the start effect below on mount.
  useEffect(() => {
    runRef.current = run;
    intervalRef.current = intervalMs;
    immediateRef.current = immediate;
  });

  useEffect(() => {
    if (!enabled) return;
    const poller = createPoller({
      run: (signal) => runRef.current(signal),
      intervalMs: intervalRef.current,
      immediate: immediateRef.current,
    });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [enabled, resetKey]);

  useEffect(() => {
    pollerRef.current?.setIntervalMs(intervalMs);
  }, [intervalMs]);

  const refresh = useCallback(() => { pollerRef.current?.trigger(); }, []);
  return { refresh };
}
