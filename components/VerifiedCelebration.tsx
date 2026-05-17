"use client";

/**
 * VerifiedCelebration
 *
 * Full-screen celebration overlay shown ONCE the first time the candidate's
 * profile is verified (manually_verified = true on candidate_profiles).
 * Dismissed automatically after 7 s or on tap/click.
 * "Seen" state is persisted in localStorage so it never shows again:
 *   key = "bv-verified-celebrated-<userId>"
 *
 * Renders above every other overlay (z-[2000]).
 * Pure CSS confetti — no external libraries.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 40 confetti pieces with deterministic colours / sizes / positions so SSR
// doesn't flicker. Each piece has its own animation-delay / duration / path.
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
  lang: "fr" | "en" | "de";
  onDismiss: () => void;
};

const T = {
  fr: {
    title:  "Félicitations 🎉",
    body:   "Vous êtes maintenant sur le plan Borivon Premium.",
    sub:    "Accès complet à toutes les fonctionnalités débloqué.",
    btn:    "Continuer",
  },
  en: {
    title:  "Congratulations 🎉",
    body:   "You're now on the Borivon Premium plan.",
    sub:    "Full access to every feature is unlocked.",
    btn:    "Continue",
  },
  de: {
    title:  "Herzlichen Glückwunsch 🎉",
    body:   "Sie sind jetzt im Borivon-Premium-Plan.",
    sub:    "Voller Zugang zu allen Funktionen ist freigeschaltet.",
    btn:    "Weiter",
  },
} as const;

function CelebrationPortal({ userId, lang, onDismiss }: Props) {
  const t = T[lang] ?? T.fr;
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mark as seen immediately so a second mount (hot-reload etc.) doesn't
  // show it again, and auto-dismiss after 7 s.
  useEffect(() => {
    try { localStorage.setItem(`bv-verified-celebrated-${userId}`, "1"); } catch { /* private mode */ }
    timerRef.current = setTimeout(() => setVisible(false), 7_000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [userId]);

  // After fade-out animation completes call onDismiss so React unmounts us.
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
        @keyframes bvCheckPop {
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

      {/* ── Confetti ── */}
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

      {/* ── Card ── */}
      <div
        className="w-full max-w-sm text-center px-8 py-10 rounded-3xl relative"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border-gold)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px var(--gdim)",
          animation: "bvCardRise 0.55s 0.1s var(--ease-out) both",
        }}
        // Stop backdrop click from closing when tapping the card itself
        onClick={e => e.stopPropagation()}
      >
        {/* Gold starburst badge */}
        <div
          className="mx-auto mb-5 flex items-center justify-center"
          style={{ animation: "bvCheckPop 0.6s 0.3s var(--ease-out) both" }}
        >
          <svg width="80" height="80" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v6.355h6.234L14.638 40l5.36-3.094L25.358 40l2.978-5.149h6.227v-6.355L40 25.359 36.905 20 40 14.64l-5.438-3.135V5.15h-6.227L25.358 0l-5.36 3.094Z"
              fill="var(--gold)"
            />
            <path
              d="m13 19.5 4.5 4 7-7"
              stroke="#FFFFFF"
              strokeWidth="3.2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
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

        <p className="text-[14.5px] leading-relaxed mb-2" style={{ color: "var(--w)" }}>
          {t.body}
        </p>
        <p className="text-[12.5px] mb-8" style={{ color: "var(--w3)" }}>
          {t.sub}
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

export function VerifiedCelebration({ userId, lang, onDismiss }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return <CelebrationPortal userId={userId} lang={lang} onDismiss={onDismiss} />;
}
