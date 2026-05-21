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

/** Stable selector for an element — used by the receiver to re-locate
 *  the same DOM node on a peer's screen. Falls back from `#id` →
 *  `[data-collab-id]` → a nth-of-type chain up to the nearest id-bearing
 *  ancestor. Both peers run the same React tree, so the same path
 *  resolves to the same element on both sides. */
function selectorFor(el: HTMLElement): string | null {
  if (el.id)               return `#${cssEscape(el.id)}`;
  const collabId = el.dataset?.collabId;
  if (collabId)            return `[data-collab-id="${collabId}"]`;
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && !cur.id) {
    const parent: HTMLElement | null = cur.parentElement;
    const tag = cur.tagName.toLowerCase();
    if (!parent) { parts.unshift(tag); break; }
    const tagName = cur.tagName;
    const sameTag = (Array.from(parent.children) as Element[]).filter(c => c.tagName === tagName);
    const idx = sameTag.indexOf(cur) + 1;
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    cur = parent;
  }
  if (cur?.id) parts.unshift(`#${cssEscape(cur.id)}`);
  return parts.join(" > ");
}

function cssEscape(s: string): string {
  // Minimal escape — covers ids that React commonly generates.
  if (typeof window !== "undefined" && (window as Window & { CSS?: { escape?: (s: string) => string } }).CSS?.escape) {
    return (window as Window & { CSS: { escape: (s: string) => string } }).CSS.escape(s);
  }
  return s.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
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
  const [peerFields, setPeerFields] = useState<Record<string, { selector: string | null; at: number }>>({});
  const [positions, setPositions] = useState<Record<string, { x: number; y: number; cluster: number } | null>>({});

  // ── Local: focus/click → broadcast a stable selector for the focused
  //    or clicked target. focusin covers keyboard tabs + native form
  //    focus; click covers buttons / non-focusable boxes the user just
  //    interacted with. Walking up via closest() means even a click on
  //    an inner <svg> or label resolves to the parent interactive box.
  useEffect(() => {
    if (!channel || !selfPeer) return;
    let currentSelector: string | null = null;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;

    const send = (selector: string | null) => {
      try {
        void channel.send({
          type:    "broadcast",
          event:   "field-focus",
          payload: { peerId: selfPeer.id, selector, at: Date.now() },
        });
      } catch { /* not yet subscribed */ }
    };

    const resolveTarget = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof HTMLElement)) return null;
      // Find the interactive ancestor (covers svg/label/icon clicks too).
      const interactive = isInteractiveTarget(target)
        ? target
        : target.closest<HTMLElement>("input, textarea, select, button, [contenteditable], [role='button']");
      return interactive ?? null;
    };

    const handleEnter = (e: Event) => {
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      const el = resolveTarget(e.target);
      if (!el) return;
      const sel = selectorFor(el);
      if (sel !== currentSelector) { currentSelector = sel; send(sel); }
    };
    const handleBlur = () => {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) {
          if (currentSelector !== null) { currentSelector = null; send(null); }
        }
      }, 400);
    };

    document.addEventListener("focusin",  handleEnter);
    document.addEventListener("click",    handleEnter, true);  // capture, so we beat React's handlers
    document.addEventListener("focusout", handleBlur);
    // Heartbeat so a tab that joined late learns where everyone is.
    const heartbeat = setInterval(() => { if (currentSelector) send(currentSelector); }, 6000);
    return () => {
      document.removeEventListener("focusin",  handleEnter);
      document.removeEventListener("click",    handleEnter, true);
      document.removeEventListener("focusout", handleBlur);
      if (blurTimer) clearTimeout(blurTimer);
      clearInterval(heartbeat);
      send(null);
    };
  }, [channel, selfPeer]);

  // ── Remote: receive selector broadcasts ───────────────────────────────
  useEffect(() => {
    if (!channel) return;
    const sub = channel.on(
      "broadcast",
      { event: "field-focus" },
      ({ payload }: { payload?: { peerId?: string; selector?: string | null; at?: number; sectionId?: string | null } }) => {
        const p = payload ?? {};
        if (!p.peerId) return;
        if (selfPeer && p.peerId === selfPeer.id) return;
        // Back-compat: older clients still send sectionId. Convert to a
        // selector so old + new clients interop while the deploy rolls out.
        const incoming = (p.selector ?? (p.sectionId ? `#${cssEscape(p.sectionId)}` : null));
        setPeerFields(prev => ({
          ...prev,
          [p.peerId!]: { selector: incoming, at: p.at ?? Date.now() },
        }));
      },
    );
    return () => {
      void sub;
      setPeerFields({});
    };
  }, [channel, selfPeer]);

  // ── Position avatars by selector. rAF gated to skip work when no
  //    peer is anchored anywhere.
  useEffect(() => {
    const activePeers = peers.filter(
      p => !p.isSelf && peerFields[p.id] && peerFields[p.id]!.selector,
    );
    if (activePeers.length === 0) {
      setPositions({});
      return;
    }
    const update = () => {
      const next: Record<string, { x: number; y: number; cluster: number } | null> = {};
      // Group active peers by selector → enables side-by-side cluster
      // positioning when two people are on the same element.
      const bySelector = new Map<string, string[]>();
      const now = Date.now();
      for (const peer of activePeers) {
        const entry = peerFields[peer.id];
        if (!entry || !entry.selector || now - entry.at > STALE_MS) { next[peer.id] = null; continue; }
        const arr = bySelector.get(entry.selector) ?? [];
        arr.push(peer.id);
        bySelector.set(entry.selector, arr);
      }
      for (const [selector, peerIds] of bySelector.entries()) {
        let el: HTMLElement | null = null;
        try { el = document.querySelector<HTMLElement>(selector); } catch { el = null; }
        if (!el) {
          for (const id of peerIds) next[id] = null;
          continue;
        }
        const rect = el.getBoundingClientRect();
        // Anchor at the TOP-RIGHT of the box, half-overlapping the corner.
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
              zIndex: 1500,
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
                <span style={{
                  fontFamily: "var(--font-serif, Georgia, serif)",
                  fontWeight: 600,
                  fontSize: Math.round(ANON_SIZE * 0.55),
                  lineHeight: 1,
                  letterSpacing: "-0.02em",
                }}>B</span>
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
