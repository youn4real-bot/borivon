"use client";

/**
 * CvCollabPresence — top-right Google-Docs-style avatar row for the CV
 * builder. Lists every peer currently editing the same candidate's
 * draft via the `cv-collab-<candidateId>` Supabase Realtime channel.
 *
 * Anonymisation rule (per user 2026-05):
 *   - Viewer role === "candidate"  →  every non-self peer renders as the
 *     Borivon "B" disc with no name. The candidate must not learn
 *     anything about which admin is editing.
 *   - Viewer role === admin / sub_admin  →  real photo + display name for
 *     each non-self peer (admin peers from admin_profiles, candidate peer
 *     from candidate_profiles.profile_photo). Initials fallback when no
 *     photo configured yet.
 *
 * A subtle gold pulse runs on every peer dot while their `editing` flag
 * is on (presence payload bumps it for ~1500 ms after each broadcast),
 * mirroring the Google-Docs "currently typing" indicator the user asked
 * for.
 */

import { useMemo } from "react";

export type CollabPeer = {
  id:           string;
  role:         "admin" | "sub_admin" | "candidate";
  email:        string;
  displayName:  string;
  photo?:       string | null;
  editing?:     boolean;
  isSelf?:      boolean;
};

function BorivonB({ size }: { size: number }) {
  return (
    <div className="rounded-full flex items-center justify-center font-semibold select-none"
      style={{
        width: size, height: size,
        background: "var(--gdim)",
        border: "1px solid var(--border-gold)",
        color: "var(--gold)",
        fontFamily: "var(--font-serif, Georgia, serif)",
        fontSize: Math.round(size * 0.55),
        lineHeight: 1,
        letterSpacing: "-0.02em",
      }}
      aria-label="Borivon">
      B
    </div>
  );
}

function Initials({ name, size }: { name: string; size: number }) {
  const ch = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="rounded-full flex items-center justify-center font-semibold select-none"
      style={{
        width: size, height: size,
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        color: "var(--w)",
        fontSize: Math.round(size * 0.45),
        lineHeight: 1,
      }}>
      {ch}
    </div>
  );
}

function Dot({
  peer, size, viewerRole,
}: { peer: CollabPeer; size: number; viewerRole: CollabPeer["role"] }) {
  // Candidate-side view: every non-self peer is anonymised to a Borivon B.
  const anonymise = viewerRole === "candidate" && !peer.isSelf;
  const label = anonymise
    ? "Borivon"
    : (peer.displayName || peer.email || "—");

  const inner = anonymise
    ? <BorivonB size={size} />
    : peer.photo
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={peer.photo} alt={label}
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }} />
      : <Initials name={label} size={size} />;

  return (
    <div className="relative" title={label} aria-label={label}>
      {inner}
      {peer.editing && (
        <span aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 rounded-full"
          style={{
            width: Math.max(6, Math.round(size * 0.28)),
            height: Math.max(6, Math.round(size * 0.28)),
            background: "var(--gold)",
            border: "2px solid var(--card)",
            boxShadow: "0 0 0 0 var(--border-gold)",
            animation: "bvCollabPulse 1.4s ease-in-out infinite",
          }} />
      )}
    </div>
  );
}

export function CvCollabPresence({
  peers,
  viewerRole,
  size = 26,
  max = 4,
}: {
  peers: CollabPeer[];
  viewerRole: CollabPeer["role"];
  size?: number;
  max?: number;
}) {
  // Order: self last (so others crowd the left), then by displayName.
  const ordered = useMemo(() => {
    const others = peers.filter(p => !p.isSelf).sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
    const self   = peers.filter(p =>  p.isSelf);
    return [...others, ...self];
  }, [peers]);

  if (ordered.length === 0) return null;

  const visible = ordered.slice(0, max);
  const overflow = ordered.length - visible.length;

  return (
    <div className="flex items-center -space-x-2">
      <style>{`
        @keyframes bvCollabPulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--border-gold); }
          50%       { box-shadow: 0 0 0 4px transparent; }
        }
      `}</style>
      {visible.map(p => (
        <div key={p.id} style={{ zIndex: 1 }}>
          <Dot peer={p} size={size} viewerRole={viewerRole} />
        </div>
      ))}
      {overflow > 0 && (
        <div className="rounded-full flex items-center justify-center font-semibold"
          style={{
            width: size, height: size,
            background: "var(--bg2)",
            border: "1px solid var(--border)",
            color: "var(--w3)",
            fontSize: Math.round(size * 0.4),
          }}
          title={`+${overflow}`}>
          +{overflow}
        </div>
      )}
    </div>
  );
}
