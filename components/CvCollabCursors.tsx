"use client";

/**
 * CvCollabCursors — Google-Docs-style "who is editing where" floating
 * avatar bubble.
 *
 * Sits on top of the cv-builder DOM and renders one absolute-positioned
 * disc per remote peer, anchored to the input/section that peer is
 * currently focused in. Anonymises to a Borivon "B" disc when the local
 * viewer is the candidate (same rule as the static top-right avatar row
 * in components/CvCollabPresence).
 *
 * Transport: Supabase Realtime broadcast — MIT-licensed, the same pub/sub
 * primitive Liveblocks / PartyKit / supabase-presence-react wrap. We use
 * it directly so there is one transport across CV save, presence row, and
 * field focus.
 *
 * Mechanism:
 *   - The local tab listens to `focusin` at the document level (bubbles
 *     up from every native input / textarea / contenteditable). When a
 *     new element is focused, it walks up to the nearest ancestor with a
 *     stable `id` (every SectionCard already has one) and broadcasts
 *     `{ peerId, sectionId }` to channel cv-collab-<candidateId>.
 *   - Remote tabs receive `field-focus` broadcasts, store `peerFields:
 *     Map<peerId, sectionId|null>`, and on every animation tick they
 *     resolve `sectionId -> getBoundingClientRect()` and render a small
 *     disc at the section's top-right.
 *   - DOM mutation (section open / close), scroll, and resize trigger a
 *     reposition pass — same as how Google Docs keeps its cursor avatars
 *     glued to paragraphs while you scroll.
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

const ANON_SIZE = 28;
const STALE_MS  = 8000;

export function CvCollabCursors({ channel, selfPeer, peers, viewerRole }: Props) {
  // Map peerId -> { sectionId, at }
  const [peerFields, setPeerFields] = useState<Record<string, { sectionId: string | null; at: number }>>({});
  // Recomputed every reposition tick.
  const [positions, setPositions] = useState<Record<string, { x: number; y: number } | null>>({});

  // ── Local: focusin/focusout -> broadcast our active section ───────────
  useEffect(() => {
    if (!channel || !selfPeer) return;
    let currentSection: string | null = null;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;

    const send = (sectionId: string | null) => {
      try {
        void channel.send({
          type:    "broadcast",
          event:   "field-focus",
          payload: { peerId: selfPeer.id, sectionId, at: Date.now() },
        });
      } catch { /* not yet subscribed */ }
    };

    const sectionFromTarget = (target: EventTarget | null): string | null => {
      if (!(target instanceof HTMLElement)) return null;
      // Prefer the input's own id when it has one; otherwise walk up to
      // the nearest id-bearing ancestor. SectionCard renders id="<key>-section".
      return target.id || target.closest<HTMLElement>("[id]")?.id || null;
    };

    const onFocusIn = (e: FocusEvent) => {
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      const id = sectionFromTarget(e.target);
      if (id !== currentSection) { currentSection = id; send(id); }
    };
    const onFocusOut = () => {
      // Re-focus on the same section is common during clicks; debounce so
      // we only clear when the user genuinely leaves the form.
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) {
          if (currentSection !== null) { currentSection = null; send(null); }
        }
      }, 250);
    };

    document.addEventListener("focusin",  onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    // Heartbeat — re-broadcast the current section every 6 s so a tab that
    // joined late still learns where we are.
    const heartbeat = setInterval(() => { if (currentSection) send(currentSection); }, 6000);
    return () => {
      document.removeEventListener("focusin",  onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      if (blurTimer) clearTimeout(blurTimer);
      clearInterval(heartbeat);
      send(null);
    };
  }, [channel, selfPeer]);

  // ── Remote: subscribe to field-focus broadcasts ───────────────────────
  useEffect(() => {
    if (!channel) return;
    const sub = channel.on(
      "broadcast",
      { event: "field-focus" },
      ({ payload }: { payload?: { peerId?: string; sectionId?: string | null; at?: number } }) => {
        const p = payload ?? {};
        if (!p.peerId) return;
        if (selfPeer && p.peerId === selfPeer.id) return;
        setPeerFields(prev => ({
          ...prev,
          [p.peerId!]: { sectionId: p.sectionId ?? null, at: p.at ?? Date.now() },
        }));
      },
    );
    return () => {
      // supabase-js v2 has no per-handler off — when the parent removes
      // the channel the handlers go with it. We just drop our state.
      void sub;
      setPeerFields({});
    };
  }, [channel, selfPeer]);

  // ── Position avatars by section id ────────────────────────────────────
  // Only runs the requestAnimationFrame loop when there's at least one
  // remote peer with an active sectionId — otherwise we'd burn 60fps of
  // getBoundingClientRect() calls (battery + scroll jank) on every open
  // tab even when nobody is collaborating. Scroll + resize listeners are
  // also conditional so an idle tab stays idle.
  useEffect(() => {
    const hasActivePeer = peers.some(
      p => !p.isSelf && peerFields[p.id] && peerFields[p.id]!.sectionId,
    );
    if (!hasActivePeer) {
      setPositions({});
      return;
    }
    const update = () => {
      const next: Record<string, { x: number; y: number } | null> = {};
      const now = Date.now();
      for (const peer of peers) {
        if (peer.isSelf) continue;
        const entry = peerFields[peer.id];
        if (!entry || !entry.sectionId || now - entry.at > STALE_MS) {
          next[peer.id] = null; continue;
        }
        // Try the section id first; if not found, try the field id directly.
        const el = document.getElementById(entry.sectionId);
        if (!el) { next[peer.id] = null; continue; }
        const rect = el.getBoundingClientRect();
        // Clamp into viewport so a section scrolled off-screen doesn't
        // park the avatar at -300px / +9000px.
        const x = Math.max(20, Math.min(window.innerWidth  - 20, rect.right - 14));
        const y = Math.max(20, Math.min(window.innerHeight - 20, rect.top   + 14));
        next[peer.id] = { x, y };
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
            title={label}
            aria-label={label}
            style={{
              left: pos.x,
              top:  pos.y,
              width: ANON_SIZE, height: ANON_SIZE,
              zIndex: 1500,
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
            {/* Subtle ring pulse so the avatar reads as a "live" presence */}
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
