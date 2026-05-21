"use client";

/**
 * CvCollabCursors — Google-Docs-style "who is editing where" floating
 * avatar bubble, anchored to the actual input/button being clicked or
 * focused (not just the section header).
 *
 * Anonymisation rule:
 *   - viewerRole === "candidate"  →  every non-self peer renders as the
 *     Borivon "B" disc with no name. Candidate never learns which admin
 *     is in the doc.
 *   - viewerRole === admin / sub_admin  →  real photo + name for each
 *     non-self peer.
 *
 * Transport: Supabase Realtime broadcast on channel cv-collab-<id>.
 *
 * Mechanism:
 *   1. focusin AND click at document level → identify the focused/clicked
 *      element via a stable selector path. Broadcast { peerId, selector }
 *      to peers.
 *   2. Peers receive, store peerFields: Map<peerId, { selector, at }>.
 *   3. Render loop (rAF, gated to only run when at least one peer has an
 *      active selector) resolves selector → getBoundingClientRect →
 *      positions an avatar at the top-right corner of that element.
 *   4. Multiple peers anchored to the same element get clustered along
 *      the right edge with a small horizontal offset so they don't
 *      overlap.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { CollabPeer } from "./CvCollabPresence";

type Props = {
  channel:    RealtimeChannel | null;
  selfPeer:   CollabPeer | null;
  peers:      CollabPeer[];
  viewerRole: CollabPeer["role"];
};

const ANON_SIZE = 26;
const STALE_MS  = 8000;
const CLUSTER_OFFSET = 14; // px shift per stacked peer on the same element

/** Focus target encoding that survives small DOM differences between
 *  admin and candidate views (lock icons rendered for one role only,
 *  conditional buttons, etc). Sender walks UP to the closest id-bearing
 *  ancestor and records the focused element's ordinal among siblings
 *  of the same KIND inside that ancestor. Receiver resolves by re-
 *  querying the same kind inside the same anchor — order is consistent
 *  across views as long as the React tree renders the form fields in
 *  the same order, which it does.
 */
type CollabTgt = {
  anchorId: string | null;
  kind: "input" | "button" | "anchor";
  index: number;
};

function targetFor(el: HTMLElement): CollabTgt {
  // Find closest id-bearing ancestor (typically a SectionCard wrapper).
  let anchor: HTMLElement | null = el;
  while (anchor && !anchor.id) anchor = anchor.parentElement;
  const anchorId = anchor?.id ?? null;
  if (!anchorId || !anchor) return { anchorId: null, kind: "anchor", index: -1 };
  const tagName = el.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    const collection = Array.from(anchor.querySelectorAll<HTMLElement>("input, textarea, select"));
    return { anchorId, kind: "input", index: collection.indexOf(el) };
  }
  if (tagName === "BUTTON" || el.getAttribute("role") === "button") {
    const collection = Array.from(anchor.querySelectorAll<HTMLElement>("button, [role='button']"));
    return { anchorId, kind: "button", index: collection.indexOf(el) };
  }
  return { anchorId, kind: "anchor", index: -1 };
}

function resolveTarget(t: CollabTgt): HTMLElement | null {
  if (!t.anchorId) return null;
  const anchor = document.getElementById(t.anchorId);
  if (!anchor) return null;
  if (t.kind === "anchor" || t.index < 0) return anchor;
  const sel = t.kind === "input"
    ? "input, textarea, select"
    : "button, [role='button']";
  const collection = Array.from(anchor.querySelectorAll<HTMLElement>(sel));
  return collection[t.index] ?? anchor;
}

/** True for elements that count as "focusable / interactable" — we
 *  broadcast on focus or click for these so an admin clicking into any
 *  box (even a non-input like a button or a section header) lights up
 *  the avatar on peers' screens. */
function isInteractiveTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.dataset.bvCollabIgnore === "1") return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute("role") === "button") return true;
  if (el.tabIndex >= 0) return true;
  return !!el.closest("input, textarea, select, button, [contenteditable], [role='button']");
}

export function CvCollabCursors({ channel, selfPeer, peers, viewerRole }: Props) {
  const [peerFields, setPeerFields] = useState<Record<string, { target: CollabTgt | null; at: number }>>({});
  const [positions, setPositions] = useState<Record<string, { x: number; y: number; cluster: number } | null>>({});

  // ── Local: focus/click → broadcast a structured target descriptor
  //    (anchorId + kind + index) that survives small DOM differences
  //    between admin and candidate views (lock icons rendered for one
  //    role only, conditional sections, etc).
  useEffect(() => {
    if (!channel || !selfPeer) return;
    let currentKey: string | null = null;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;

    const send = (t: CollabTgt | null) => {
      try {
        void channel.send({
          type:    "broadcast",
          event:   "field-focus",
          payload: { peerId: selfPeer.id, target: t, at: Date.now() },
        });
      } catch { /* not yet subscribed */ }
    };

    const interactiveAncestor = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof HTMLElement)) return null;
      return isInteractiveTarget(target)
        ? target
        : target.closest<HTMLElement>("input, textarea, select, button, [contenteditable], [role='button']");
    };

    const handleEnter = (e: Event) => {
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      const el = interactiveAncestor(e.target);
      if (!el) return;
      const t = targetFor(el);
      const key = `${t.anchorId}|${t.kind}|${t.index}`;
      if (key !== currentKey) { currentKey = key; send(t); }
    };
    const handleBlur = () => {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) {
          if (currentKey !== null) { currentKey = null; send(null); }
        }
      }, 400);
    };

    document.addEventListener("focusin",  handleEnter);
    document.addEventListener("click",    handleEnter, true);
    document.addEventListener("focusout", handleBlur);
    const heartbeat = setInterval(() => {
      if (currentKey) {
        // Re-resolve from the live activeElement to ensure index is
        // still correct after DOM mutations (entries added/removed).
        const el = document.activeElement as HTMLElement | null;
        if (el) send(targetFor(el));
      }
    }, 6000);
    return () => {
      document.removeEventListener("focusin",  handleEnter);
      document.removeEventListener("click",    handleEnter, true);
      document.removeEventListener("focusout", handleBlur);
      if (blurTimer) clearTimeout(blurTimer);
      clearInterval(heartbeat);
      send(null);
    };
  }, [channel, selfPeer]);

  // ── Remote: receive target broadcasts. Back-compat: older clients
  //    that still send the legacy `selector` field are accepted by
  //    wrapping the selector as an "anchor" target.
  useEffect(() => {
    if (!channel) return;
    const sub = channel.on(
      "broadcast",
      { event: "field-focus" },
      ({ payload }: { payload?: { peerId?: string; target?: CollabTgt | null; selector?: string | null; sectionId?: string | null; at?: number } }) => {
        const p = payload ?? {};
        if (!p.peerId) return;
        if (selfPeer && p.peerId === selfPeer.id) return;
        let target: CollabTgt | null = null;
        if (p.target && typeof p.target === "object") target = p.target;
        else if (p.selector || p.sectionId) {
          // Map legacy `selector` / `sectionId` to an anchor-only target.
          // Both old shapes resolve to a single element via querySelector
          // / getElementById on the receiver; we keep the avatar visible
          // even if old clients are still in the channel.
          target = { anchorId: p.sectionId ?? null, kind: "anchor", index: -1 };
        }
        setPeerFields(prev => ({
          ...prev,
          [p.peerId!]: { target, at: p.at ?? Date.now() },
        }));
      },
    );
    return () => {
      void sub;
      setPeerFields({});
    };
  }, [channel, selfPeer]);

  // ── Position avatars by resolved target. rAF gated to skip work
  //    when no peer is anchored anywhere.
  useEffect(() => {
    const activePeers = peers.filter(
      p => !p.isSelf && peerFields[p.id] && peerFields[p.id]!.target,
    );
    if (activePeers.length === 0) {
      setPositions({});
      return;
    }
    const update = () => {
      const next: Record<string, { x: number; y: number; cluster: number } | null> = {};
      // Group peers by their target key so 2+ on the same field cluster
      // side-by-side rather than stacking on top of each other.
      const byKey = new Map<string, string[]>();
      const elByKey = new Map<string, HTMLElement | null>();
      const now = Date.now();
      for (const peer of activePeers) {
        const entry = peerFields[peer.id];
        if (!entry || !entry.target || now - entry.at > STALE_MS) { next[peer.id] = null; continue; }
        const t = entry.target;
        const key = `${t.anchorId}|${t.kind}|${t.index}`;
        if (!elByKey.has(key)) elByKey.set(key, resolveTarget(t));
        const arr = byKey.get(key) ?? [];
        arr.push(peer.id);
        byKey.set(key, arr);
      }
      for (const [key, peerIds] of byKey.entries()) {
        const el = elByKey.get(key) ?? null;
        if (!el) {
          for (const id of peerIds) next[id] = null;
          continue;
        }
        const rect = el.getBoundingClientRect();
        const baseX = rect.right;
        const baseY = rect.top;
        peerIds.forEach((id, idx) => {
          const x = Math.max(20, Math.min(window.innerWidth  - 20, baseX - idx * CLUSTER_OFFSET));
          const y = Math.max(20, Math.min(window.innerHeight - 20, baseY));
          next[id] = { x, y, cluster: idx };
        });
      }
      setPositions(next);
    };
    update();
    let rafId: number | null = null;
    const tick = () => { update(); rafId = requestAnimationFrame(tick); };
    rafId = requestAnimationFrame(tick);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [peers, peerFields]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <style>{`
        @keyframes bvCollabCursorPop {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1);   }
        }
      `}</style>
      {peers.map(peer => {
        if (peer.isSelf) return null;
        const pos = positions[peer.id];
        if (!pos) return null;
        const anonymise = viewerRole === "candidate";
        const label = anonymise ? "Borivon" : (peer.displayName || peer.email || "—");
        return (
          <div key={peer.id}
            className="pointer-events-none fixed"
            data-bv-collab-ignore="1"
            title={label}
            aria-label={label}
            style={{
              left: pos.x,
              top:  pos.y,
              width: ANON_SIZE, height: ANON_SIZE,
              // 1090 sits ABOVE normal page content but BELOW any
              // LAW #36 popup (z-[1100]). Without this the floating
              // cursor was rendering on top of the candidate profile
              // popup — visual collision flagged 2026-05.
              zIndex: 1090,
              // Top-right anchor: nudge the disc so it half-overlaps the
              // input's top-right corner instead of hovering off in space.
              transform: "translate(-50%, -50%)",
              animation: "bvCollabCursorPop .22s var(--ease-out)",
            }}>
            <div className="rounded-full flex items-center justify-center select-none"
              style={{
                width: ANON_SIZE, height: ANON_SIZE,
                background: "var(--gdim)",
                border: "2px solid var(--gold)",
                boxShadow: "0 4px 14px rgba(201,162,64,0.45)",
                color: "var(--gold)",
                overflow: "hidden",
              }}>
              {anonymise ? (
                // Real brand mark from /favicon.png — single source of
                // truth (same asset registered as the site favicon in
                // app/layout.tsx). Matches CvCollabPresence so the avatar
                // shown to candidates is consistent across the floating
                // cursor + the top-right peer row.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/favicon.png"
                  alt=""
                  draggable={false}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
                />
              ) : peer.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={peer.photo} alt={label}
                  style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: Math.round(ANON_SIZE * 0.45), fontWeight: 600 }}>
                  {(label || "?").trim().charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            {/* Subtle pulse so the avatar reads as live presence */}
            <div className="absolute inset-0 rounded-full"
              style={{
                boxShadow: "0 0 0 3px rgba(201,162,64,0.32)",
                animation: "bvCollabPulse 1.6s ease-in-out infinite",
                pointerEvents: "none",
              }} />
          </div>
        );
      })}
    </>,
    document.body,
  );
}
