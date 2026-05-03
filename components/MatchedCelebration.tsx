"use client";

/**
 * MatchedCelebration
 *
 * Full-screen celebration overlay shown ONCE the first time the candidate is
 * placed with a partner organization (status="approved" appears on
 * candidate_organizations). Re-uses the confetti / fade / card-rise look of
 * VerifiedCelebration so the visual language stays consistent.
 *
 * "Seen" state is persisted per (user, orgId) in localStorage so it only fires
 * once per match:
 *   key = "bv-celebrated-orgs-<userId>"
 *   value = JSON array of orgIds the user has already celebrated.
 *
 * Renders above every other overlay (z-[2000]).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PIECES = Array.from({ length: 40 }, (_, i) => {
  const colours = ["#c9a240", "#d4af37", "#fff", "#e8cc6e", "#a07830", "#f0dfa0", "#fffbe6", "#c9a240"];
  const shapes  = ["circle", "rect", "rect"];
  return {
    id: i,
    color:  colours[i % colours.length],
    shape:  shapes[i % shapes.length],
    left:   `${(i * 2.5 + 1) % 100}%`,
    size:   6 + (i % 5) * 2,
    delay:  `${(i * 0.07) % 1.4}s`,
    dur:    `${2.4 + (i % 7) * 0.3}s`,
    rotate: `${(i * 37) % 360}deg`,
    swing:  (i % 2 === 0 ? 1 : -1) * (20 + (i % 4) * 15),
  };
});

type Props = {
  userId: string;
  orgId: string;
  orgName: string;
  lang: "fr" | "en" | "de";
  onDismiss: () => void;
};

const T = {
  fr: {
    title:   "Bravo 🎉",
    matched: "Vous avez été associé à",
    body:    "Votre organisation partenaire vous attend en Allemagne. Continuez à téléverser vos documents pour avancer.",
    btn:     "Continuer",
  },
  en: {
    title:   "Congrats 🎉",
    matched: "You've been matched with",
    body:    "Your partner organization is waiting for you in Germany. Keep uploading your documents to move forward.",
    btn:     "Let's go",
  },
  de: {
    title:   "Glückwunsch 🎉",
    matched: "Sie wurden zugeordnet zu",
    body:    "Ihre Partner-Einrichtung wartet in Deutschland auf Sie. Laden Sie weiter Ihre Dokumente hoch, um fortzufahren.",
    btn:     "Weiter",
  },
} as const;

function CelebrationPortal({ userId, orgId, orgName, lang, onDismiss }: Props) {
  const t = T[lang] ?? T.en;
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Mark as seen immediately so a second mount (hot-reload, refetch) doesn't
    // re-show this celebration. We store an array of orgIds for the user so
    // multiple matches each get exactly one celebration.
    try {
      const key = `bv-celebrated-orgs-${userId}`;
      const seen = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
      if (!seen.includes(orgId)) {
        seen.push(orgId);
        localStorage.setItem(key, JSON.stringify(seen));
      }
    } catch { /* private mode */ }
    timerRef.current = setTimeout(() => setVisible(false), 8_000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [userId, orgId]);

  function handleAnimationEnd(e: React.AnimationEvent) {
    if (e.animationName === "bvCelebFadeOut") onDismiss();
  }

  if (typeof document === "undefined") return null;

  const node = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 2000,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
        animation: visible
          ? "bvCelebFadeIn 0.35s var(--ease-out) forwards"
          : "bvCelebFadeOut 0.6s var(--ease-out) forwards",
        cursor: "pointer",
      }}
      onClick={() => setVisible(false)}
      onAnimationEnd={handleAnimationEnd}
    >
      <style>{`
        @keyframes bvCelebFadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes bvCelebFadeOut { from { opacity:1 } to { opacity:0 } }
        @keyframes bvConfettiFall {
          0%   { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
        @keyframes bvConfettiSwingL {
          0%, 100% { margin-left: 0 }
          50%       { margin-left: -30px }
        }
        @keyframes bvConfettiSwingR {
          0%, 100% { margin-left: 0 }
          50%       { margin-left: 30px }
        }
        @keyframes bvCardRise {
          from { opacity:0; transform: translateY(28px) scale(0.94); }
          to   { opacity:1; transform: translateY(0)    scale(1);    }
        }
        @keyframes bvBuildPop {
          0%   { transform: scale(0)   rotate(-15deg); opacity:0; }
          60%  { transform: scale(1.2) rotate(4deg);  opacity:1; }
          80%  { transform: scale(0.92) rotate(-2deg); }
          100% { transform: scale(1)   rotate(0deg); opacity:1; }
        }
        @keyframes bvShimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
      `}</style>

      {/* Confetti */}
      {PIECES.map(p => (
        <div
          key={p.id}
          style={{
            position: "fixed",
            top: "-40px",
            left: p.left,
            width:  p.shape === "circle" ? p.size : p.size * 0.6,
            height: p.shape === "circle" ? p.size : p.size * 1.4,
            borderRadius: p.shape === "circle" ? "50%" : "2px",
            background: p.color,
            pointerEvents: "none",
            animationName: `bvConfettiFall, ${p.swing > 0 ? "bvConfettiSwingR" : "bvConfettiSwingL"}`,
            animationDuration: `${p.dur}, ${parseFloat(p.dur) * 0.6}s`,
            animationDelay: p.delay,
            animationTimingFunction: "linear, ease-in-out",
            animationIterationCount: "infinite, infinite",
            transform: `rotate(${p.rotate})`,
          }}
        />
      ))}

      {/* Card */}
      <div
        className="w-full max-w-sm text-center px-8 py-10 rounded-3xl relative"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border-gold)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px var(--gdim)",
          animation: "bvCardRise 0.55s 0.1s var(--ease-out) both",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Building icon in gold circle */}
        <div
          className="mx-auto mb-5 w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: "var(--gdim)",
            border: "2px solid var(--border-gold)",
            animation: "bvBuildPop 0.6s 0.3s var(--ease-out) both",
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
            <path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/>
          </svg>
        </div>

        {/* Title with gold shimmer */}
        <h2
          className="text-[22px] font-semibold mb-3 tracking-tight"
          style={{
            background: "linear-gradient(90deg, #c9a240 0%, #f0dfa0 40%, #c9a240 60%, #a07830 100%)",
            backgroundSize: "200% auto",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            animation: "bvShimmer 2.5s 0.5s linear infinite",
          }}
        >
          {t.title}
        </h2>

        <p className="text-[14px] leading-relaxed mb-1" style={{ color: "var(--w)" }}>
          {t.matched}
        </p>
        <p className="text-[18px] font-bold mb-4 tracking-tight" style={{ color: "var(--gold)" }}>
          {orgName}
        </p>
        <p className="text-[12.5px] leading-relaxed mb-8" style={{ color: "var(--w3)" }}>
          {t.body}
        </p>

        <button
          onClick={() => setVisible(false)}
          className="w-full py-3.5 text-[14px] font-semibold rounded-xl transition-all hover:opacity-90 active:scale-[0.98]"
          style={{
            background: "var(--gold)",
            color: "#131312",
            border: "none",
            boxShadow: "0 4px 14px var(--border-gold)",
          }}
        >
          {t.btn}
        </button>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

export function MatchedCelebration({ userId, orgId, orgName, lang, onDismiss }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return <CelebrationPortal userId={userId} orgId={orgId} orgName={orgName} lang={lang} onDismiss={onDismiss} />;
}
