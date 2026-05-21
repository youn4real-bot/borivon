"use client";

/**
 * LetterCollabCaret — Google-Docs-style remote caret for the cover-letter
 * contentEditable body.
 *
 * Two things draw per remote peer:
 *   1. A thin VERTICAL LINE at the exact caret coordinates (where the
 *      remote user is currently typing or last clicked). Glows with a
 *      gold halo + the classic Google-Docs blink so you can spot where
 *      the other party is even when they aren't actively typing.
 *   2. A small AVATAR CHIP anchored to that caret position on the same
 *      line. Tracks horizontally as the remote user types.
 *
 * Anonymisation rule mirrors CvCollabPresence / CvCollabCursors:
 *   • viewerRole === "candidate" → every peer renders as the Borivon B
 *     (favicon image disc). Candidate never sees admin photo/name.
 *   • viewerRole === admin / sub_admin → real photo + name.
 *
 * Transport: Supabase Realtime broadcast on the same channel the letter
 * page already uses. New event `letter-caret` keeps it separate from
 * the body's `letter-update` broadcast so the receiver can react to
 * caret moves WITHOUT applying an HTML patch.
 *
 * Coordinate frame: sender publishes coords in EDITOR-LOCAL pixels
 * (rect minus editor's getBoundingClientRect + scroll offsets). Receiver
 * re-applies its own editor's offset on render so the caret lands on
 * the right line even if the two viewers have different viewport sizes.
 */

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { CollabPeer } from "./CvCollabPresence";

type CaretPos = {
  x:     number; // editor-local px from left
  y:     number; // editor-local px from top
  h:     number; // caret height (line height-ish)
  at:    number; // ms timestamp — staleness gate
};

type RemoteMap = Record<string, CaretPos>;

const STALE_MS         = 8000;
const BROADCAST_THROT  = 80;     // ms — cap selection-change emit rate
const AVATAR_SIZE      = 22;     // px, slightly smaller than presence chip
const AVATAR_GAP_RIGHT = 8;      // px from editor's right edge
const AVATAR_CLUSTER   = 6;      // px overlap when multiple peers share a line
const CARET_WIDTH      = 2;      // px

export function LetterCollabCaret({
  channel,
  selfPeer,
  peers,
  viewerRole,
  editorRef,
}: {
  channel:    RealtimeChannel | null;
  selfPeer:   CollabPeer | null;
  peers:      CollabPeer[];
  viewerRole: CollabPeer["role"];
  editorRef:  React.RefObject<HTMLDivElement | null>;
}) {
  const [remote, setRemote] = useState<RemoteMap>({});
  const lastSentAt = useRef(0);
  const lastSig    = useRef("");
  // Bump on every scroll / resize / new remote caret so the absolute-
  // positioned overlay re-resolves coordinates against the live editor
  // rect (the editor itself can scroll inside the page).
  const [tick, setTick] = useState(0);
  const bumpTick = () => setTick(t => (t + 1) | 0);

  // ── Sender ────────────────────────────────────────────────────────────────
  // Compute the caret's coordinates in EDITOR-LOCAL pixels every time the
  // user's selection changes inside our editor, and broadcast it (throttled).
  useEffect(() => {
    if (!channel || !selfPeer || !editorRef.current) return;
    const editor = editorRef.current;

    const send = (payload: { x: number; y: number; h: number } | null) => {
      lastSentAt.current = Date.now();
      try {
        void channel.send({
          type:  "broadcast",
          event: "letter-caret",
          payload: { peerId: selfPeer.id, pos: payload, at: Date.now() },
        });
      } catch { /* channel not yet subscribed */ }
    };

    const compute = (): { x: number; y: number; h: number } | null => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      // Only emit when the selection lives INSIDE our editor.
      if (!editor.contains(range.commonAncestorContainer)) return null;
      // For a collapsed selection at the very end of an empty line, the
      // bounding rect can come back as 0,0,0,0. Insert a zero-width span
      // temporarily? Too invasive. Instead, fall back to a synthetic rect
      // using the editor's caret position via a tiny clone range.
      let rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        // Try expanding the range by one character backwards to capture
        // a usable rect, then collapse the rect to its right edge.
        const probe = range.cloneRange();
        try {
          if (probe.startOffset > 0 && probe.startContainer.nodeType === Node.TEXT_NODE) {
            probe.setStart(probe.startContainer, probe.startOffset - 1);
            const r2 = probe.getBoundingClientRect();
            if (r2.width || r2.height) {
              rect = new DOMRect(r2.right, r2.top, 0, r2.height);
            }
          }
        } catch { /* probe failed — fall back to editor top */ }
      }
      const eRect = editor.getBoundingClientRect();
      // Reject obvious junk (still all-zero after the probe).
      if (!rect.height) return null;
      const x = rect.left - eRect.left + editor.scrollLeft;
      const y = rect.top  - eRect.top  + editor.scrollTop;
      const h = Math.max(14, rect.height);
      return { x, y, h };
    };

    const emit = (force = false) => {
      const now = Date.now();
      if (!force && now - lastSentAt.current < BROADCAST_THROT) return;
      const pos = compute();
      const sig = pos ? `${Math.round(pos.x)}|${Math.round(pos.y)}` : "null";
      if (!force && sig === lastSig.current) return;
      lastSig.current = sig;
      send(pos);
    };

    // selectionchange is the cleanest signal — fires on cursor move /
    // typing / mouse click placing caret / arrow keys etc. Throttled.
    const onSel = () => emit();
    // Heartbeat so peers don't decay our caret to stale while we sit idle.
    const heartbeat = setInterval(() => {
      if (document.activeElement && editor.contains(document.activeElement as Node)) {
        emit(true);
      }
    }, 3500);
    document.addEventListener("selectionchange", onSel);
    editor.addEventListener("input", onSel);
    editor.addEventListener("focus", () => emit(true));
    return () => {
      document.removeEventListener("selectionchange", onSel);
      editor.removeEventListener("input", onSel);
      clearInterval(heartbeat);
      // Send a null on unmount so peers can drop our caret immediately.
      send(null);
    };
  }, [channel, selfPeer, editorRef]);

  // ── Receiver ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!channel) return;
    const sub = channel.on(
      "broadcast",
      { event: "letter-caret" },
      ({ payload }: { payload?: { peerId?: string; pos?: { x: number; y: number; h: number } | null; at?: number } }) => {
        const p = payload ?? {};
        if (!p.peerId) return;
        if (selfPeer && p.peerId === selfPeer.id) return;
        setRemote(prev => {
          const next = { ...prev };
          if (!p.pos) {
            delete next[p.peerId!];
            return next;
          }
          next[p.peerId!] = { x: p.pos.x, y: p.pos.y, h: p.pos.h, at: p.at ?? Date.now() };
          return next;
        });
        bumpTick();
      },
    );
    return () => { void sub; setRemote({}); };
  }, [channel, selfPeer]);

  // ── Decay stale carets ───────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setRemote(prev => {
        let changed = false;
        const next: RemoteMap = {};
        for (const [id, c] of Object.entries(prev)) {
          if (now - c.at < STALE_MS) next[id] = c;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1500);
    return () => clearInterval(t);
  }, []);

  // ── Keep absolute-positioned overlay aligned on scroll / resize.
  // The overlay sits inside the editor's offset parent, so a viewport
  // scroll doesn't break it — but the editor itself can scroll, and the
  // page can re-layout (mobile keyboard open, sidebar collapse) and the
  // rect changes. Bumping `tick` triggers a re-read of editor rect.
  useEffect(() => {
    const onMove = () => bumpTick();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, []);

  const editor = editorRef.current;
  if (!editor) return null;
  // Build the absolute screen-position for each remote caret by
  // adding the editor's live offset to the editor-local coords.
  const eRect = editor.getBoundingClientRect();
  const activePeers = peers.filter(p => !p.isSelf && remote[p.id]);
  if (activePeers.length === 0) return null;
  // Suppress reference-only react warning for `tick`.
  void tick;

  // Bucket peers by the LINE they sit on (caret y rounded to the
  // line's vertical band). Multiple peers on the same line get
  // clustered on the right edge — each one shifts slightly left so
  // their avatars don't overlap.
  const lineBuckets = new Map<number, typeof activePeers>();
  for (const p of activePeers) {
    const c = remote[p.id]!;
    const band = Math.round(c.y / Math.max(8, c.h));
    const arr = lineBuckets.get(band) ?? [];
    arr.push(p);
    lineBuckets.set(band, arr);
  }
  // Stable order within a bucket — by peer id — so the cluster
  // doesn't reshuffle on every state tick.
  for (const arr of lineBuckets.values()) {
    arr.sort((a, b) => a.id.localeCompare(b.id));
  }
  const clusterIndex = new Map<string, number>();
  for (const arr of lineBuckets.values()) {
    arr.forEach((p, i) => clusterIndex.set(p.id, i));
  }

  return (
    <>
      <style>{`
        @keyframes bvLetterCaretBlink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.35; }
        }
      `}</style>
      {activePeers.map(peer => {
        const c = remote[peer.id]!;
        const caretLeft = eRect.left + c.x;
        const caretTop  = eRect.top  + c.y;
        const peerIsAdmin = peer.role === "admin" || peer.role === "sub_admin";
        const anonymise = viewerRole === "candidate";
        const label = anonymise ? "Borivon" : (peer.displayName || peer.email || "—");

        // Caret line color:
        //   • admin / sub-admin peer  → var(--w) (white in dark, black in
        //                                light) — Borivon brand neutral
        //   • candidate peer          → var(--gold) — always gold
        // Glow halo matches the line color at low alpha.
        const caretColor = peerIsAdmin ? "var(--w)" : "var(--gold)";
        const caretGlow  = peerIsAdmin
          ? "0 0 10px 1px var(--w), 0 0 3px 0 rgba(255,255,255,0.6)"
          : "0 0 10px 1px rgba(201,162,64,0.85), 0 0 3px 0 rgba(255,215,140,0.55)";

        // Avatar is PERMANENT on the right edge of the editor — only its
        // vertical position changes (follows the caret line). Multiple
        // peers on the same line cluster a few pixels apart so each is
        // identifiable.
        const idx = clusterIndex.get(peer.id) ?? 0;
        const avatarRight = (window.innerWidth - eRect.right) + AVATAR_GAP_RIGHT;
        const avatarTop   = caretTop + (c.h / 2) - (AVATAR_SIZE / 2);

        // Avatar ring color matches the caret color so a glance at the
        // ring tells you which line that avatar belongs to.
        const ringColor = peerIsAdmin ? "var(--w)" : "var(--gold)";

        return (
          <div key={peer.id}
            className="fixed pointer-events-none"
            data-bv-collab-ignore="1"
            aria-hidden="true"
            style={{ left: 0, top: 0, zIndex: 1090 }}>
            {/* Vertical caret line — Borivon (admin) is white/black per
                theme; candidate is always gold. Glow + blink. */}
            <div
              style={{
                position: "fixed",
                left:   caretLeft,
                top:    caretTop,
                width:  CARET_WIDTH,
                height: c.h,
                background: caretColor,
                boxShadow:  caretGlow,
                borderRadius: 1,
                animation: "bvLetterCaretBlink 1.0s steps(2, start) infinite",
              }}
            />
            {/* Avatar chip — anchored PERMANENTLY to the right edge of
                the editor, tracking only the caret's vertical position.
                Multiple peers on the same line cluster horizontally
                (each one shifted left a few px so they don't overlap). */}
            <div
              title={label}
              style={{
                position: "fixed",
                right: avatarRight + idx * (AVATAR_SIZE + AVATAR_CLUSTER),
                top:   avatarTop,
                width:  AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: "50%",
                background: "var(--gdim)",
                border: `2px solid ${ringColor}`,
                boxShadow: peerIsAdmin
                  ? "0 4px 12px rgba(255,255,255,0.35)"
                  : "0 4px 12px rgba(201,162,64,0.45)",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "top 120ms var(--ease-out, ease-out), right 120ms var(--ease-out, ease-out)",
              }}>
              {anonymise ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/favicon.png" alt=""
                  draggable={false}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />
              ) : peer.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={peer.photo} alt={label}
                  style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 11, fontWeight: 700, color: ringColor }}>
                  {(label || "?").trim().charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
