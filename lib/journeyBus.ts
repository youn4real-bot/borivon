import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Tiny realtime bus for the per-candidate journey/assigned checklist.
 *
 * Uses Supabase BROADCAST (pub/sub messaging), NOT Postgres-changes — so it
 * needs no RLS policy and the candidate_journey_items table stays
 * service-role-only. A change just pings `bv-journey-<candidateId>` with an
 * empty payload; every listener then re-fetches through the authorized API
 * (the broadcast carries no data, only a "something changed" signal).
 *
 * Lets the candidate's icon badge bump the instant an admin assigns, and any
 * open journey view (candidate's Assigned tab, admin's Status → Journey) refresh
 * the instant someone ticks a box — across sessions.
 */

const channels = new Map<string, { ch: RealtimeChannel; listeners: Set<() => void> }>();

/** Subscribe to changes for one candidate. Returns an unsubscribe fn. */
export function onJourneyChange(candidateId: string, cb: () => void): () => void {
  if (!candidateId) return () => {};
  let entry = channels.get(candidateId);
  if (!entry) {
    const ch = supabase.channel(`bv-journey-${candidateId}`, { config: { broadcast: { self: true } } });
    const e = { ch, listeners: new Set<() => void>() };
    ch.on("broadcast", { event: "changed" }, () => e.listeners.forEach(l => l()));
    ch.subscribe();
    channels.set(candidateId, e);
    entry = e;
  }
  entry.listeners.add(cb);
  return () => {
    const e = channels.get(candidateId);
    if (!e) return;
    e.listeners.delete(cb);
    if (e.listeners.size === 0) {
      supabase.removeChannel(e.ch);
      channels.delete(candidateId);
    }
  };
}

/** Signal that a candidate's journey changed (assigned / ticked / edited / removed). */
export function emitJourneyChange(candidateId: string): void {
  if (!candidateId) return;
  const entry = channels.get(candidateId);
  if (entry) {
    void entry.ch.send({ type: "broadcast", event: "changed", payload: {} });
    return;
  }
  // Not locally subscribed (e.g. an admin assigning from the Assign tab) — open
  // an ephemeral channel just to send, then tear it down.
  const ch = supabase.channel(`bv-journey-${candidateId}`);
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      void ch.send({ type: "broadcast", event: "changed", payload: {} });
      setTimeout(() => { void supabase.removeChannel(ch); }, 500);
    }
  });
}
