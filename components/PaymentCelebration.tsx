"use client";

/**
 * PaymentCelebration
 *
 * Full-screen celebration shown ONCE after a successful Stripe payment
 * (Premium plan). Same confetti / card-rise look as
 * VerifiedCelebration and MatchedCelebration.
 *
 * "Seen" state is persisted per (user, plan) in localStorage:
 *   key = "bv-payment-celebrated-<userId>-<plan>"
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, RefreshCcw } from "lucide-react";

const PIECES = Array.from({ length: 40 }, (_, i) => {
  const colours = ["#c9a240", "#d4af37", "#fff", "#e8cc6e", "#a07830", "#f0dfa0", "#fffbe6"];
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

const T = {
  de: {
    title:    "Zahlung bestätigt",
    premium: "Premium-Plan aktiviert",
    body:     "Ihr vollständiger Karriereweg ist jetzt freigeschaltet. Wir begleiten Sie bis nach Deutschland!",
    refund:   "Und ja — weiterhin erstattungsfähig, sobald Sie mit uns in Deutschland ankommen",
    btn:      "Los geht's",
  },
  en: {
    title:    "Payment confirmed",
    premium: "Premium Plan activated",
    body:     "Your full career journey is now unlocked. We'll walk with you all the way to Germany!",
    refund:   "And yes — it's still refundable once you land in Germany with us",
    btn:      "Let's go",
  },
  fr: {
    title:    "Paiement confirmé",
    premium: "Plan Premium activé",
    body:     "Votre parcours complet est maintenant débloqué. Nous vous accompagnons jusqu'en Allemagne !",
    refund:   "Et oui — toujours remboursable dès votre arrivée en Allemagne avec nous",
    btn:      "C'est parti",
  },
} as const;

type Props = {
  userId: string;
  plan: string;
  lang: "fr" | "en" | "de";
  onDismiss: () => void;
};

function CelebrationPortal({ userId, plan, lang, onDismiss }: Props) {
  const t = T[lang] ?? T.en;
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => setVisible(false), 8_000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [userId, plan]);

  function handleAnimationEnd(e: React.AnimationEvent) {
    if (e.animationName === "bvCelebFadeOut") onDismiss();
  }

  if (typeof document === "undefined") return null;

  const node = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 2100,
        background: "rgba(0,0,0,0.75)",
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
        @keyframes bvConfettiSwingL { 0%,100%{margin-left:0} 50%{margin-left:-30px} }
        @keyframes bvConfettiSwingR { 0%,100%{margin-left:0} 50%{margin-left:30px} }
        @keyframes bvCardRise {
          from { opacity:0; transform: translateY(28px) scale(0.94); }
          to   { opacity:1; transform: translateY(0) scale(1); }
        }
        @keyframes bvBuildPop {
          0%   { transform: scale(0) rotate(-15deg); opacity:0; }
          60%  { transform: scale(1.2) rotate(4deg); opacity:1; }
          80%  { transform: scale(0.92) rotate(-2deg); }
          100% { transform: scale(1) rotate(0deg); opacity:1; }
        }
        @keyframes bvShimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        @keyframes bvWave {
          0%,100% { background-position: 0% 50%; }
          50%     { background-position: 100% 50%; }
        }
      `}</style>

      {/* Confetti */}
      {PIECES.map(p => (
        <div key={p.id} style={{
          position: "fixed", top: "-40px", left: p.left,
          width:  p.shape === "circle" ? p.size : p.size * 0.6,
          height: p.shape === "circle" ? p.size : p.size * 1.4,
          borderRadius: p.shape === "circle" ? "50%" : "2px",
          background: p.color, pointerEvents: "none",
          animationName: `bvConfettiFall, ${p.swing > 0 ? "bvConfettiSwingR" : "bvConfettiSwingL"}`,
          animationDuration: `${p.dur}, ${parseFloat(p.dur) * 0.6}s`,
          animationDelay: p.delay,
          animationTimingFunction: "linear, ease-in-out",
          animationIterationCount: "infinite, infinite",
          transform: `rotate(${p.rotate})`,
        }} />
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
        {/* Badge icon */}
        <div className="mx-auto mb-5 w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: "var(--gdim)",
            border: "2px solid var(--border-gold)",
            animation: "bvBuildPop 0.6s 0.3s var(--ease-out) both",
          }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="11" fill="var(--gold)"/>
            <path d="M7 12.5l3.5 3.5 6.5-7" stroke="#131312" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* Title shimmer */}
        <h2 className="text-[22px] font-semibold mb-2 tracking-tight"
          style={{
            background: "linear-gradient(90deg,#c9a240 0%,#f0dfa0 40%,#c9a240 60%,#a07830 100%)",
            backgroundSize: "200% auto",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            animation: "bvShimmer 2.5s 0.5s linear infinite",
          }}>
          {t.title}
        </h2>

        {/* Plan name */}
        <p className="text-[15px] font-bold mb-3" style={{ color: "var(--gold)" }}>
          {t.premium}
        </p>

        <p className="text-[12.5px] leading-relaxed mb-4" style={{ color: "var(--w3)" }}>
          {t.body}
        </p>

        {/* Refund line — single sentence (was two redundant lines) */}
        <div className="rounded-xl px-3 py-2 mb-6"
          style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
          <p className="text-[11.5px] font-semibold inline-flex items-start gap-1.5 text-left"
            style={{
              background: "linear-gradient(90deg,var(--gold),#f0dfa0,#c9a240)",
              backgroundSize: "200% auto",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              animation: "bvWave 2.5s linear infinite",
            }}>
            <RefreshCcw size={11} strokeWidth={2.2} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 2 }} />
            <span>{t.refund}</span>
          </p>
        </div>

        <button
          onClick={() => setVisible(false)}
          className="w-full py-3.5 text-[14px] font-semibold rounded-xl transition-all hover:opacity-90 active:scale-[0.98]"
          style={{ background: "var(--gold)", color: "#131312", border: "none", boxShadow: "0 4px 14px var(--border-gold)" }}>
          {t.btn}
        </button>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

export function PaymentCelebration({ userId, plan, lang, onDismiss }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return <CelebrationPortal userId={userId} plan={plan} lang={lang} onDismiss={onDismiss} />;
}
