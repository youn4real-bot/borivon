"use client";

/**
 * Lenis smooth-scroll, mounted ONLY in the /v2 layout (never the portal).
 *
 * Why it's safe with our Motion useScroll: Lenis animates the REAL native scroll
 * position (it does not transform a virtual wrapper), so Motion's useScroll —
 * which reads native scroll progress + tracks targets by layout position — keeps
 * reporting correctly. Sticky sections and the progress bar are unaffected.
 *
 * Single clock: we run Lenis off Motion's own frame loop (autoRaf:false) so there
 * is ONE rAF, never two dueling loops (the documented jitter cause).
 *
 * Reduced-motion + SSR: we render children plain on the server and first client
 * render, then enable Lenis after mount only if the user hasn't asked for reduced
 * motion. This avoids any hydration mismatch AND avoids initialising Lenis without
 * a rAF loop (which could otherwise swallow wheel events).
 */
import { ReactLenis } from "lenis/react";
import { frame, cancelFrame } from "motion/react";
import { useEffect, useRef, useState } from "react";

export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  // ref shape kept loose to stay version-agnostic across lenis/react releases.
  const lenisRef = useRef<{ lenis?: { raf: (t: number) => void } }>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setEnabled(!mql.matches); // enable Lenis unless reduced-motion (symmetric, live)
    const onChange = (e: MediaQueryListEvent) => setEnabled(!e.matches);
    mql.addEventListener?.("change", onChange);
    return () => { mql.removeEventListener?.("change", onChange); };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Motion's frame loop passes a FrameData object; feed its timestamp to Lenis
    // so both advance off ONE clock (no dueling rAF → no jitter).
    const tick = (data: { timestamp: number }) => { lenisRef.current?.lenis?.raf(data.timestamp); };
    frame.update(tick, true); // single shared loop, high priority
    return () => cancelFrame(tick);
  }, [enabled]);

  if (!enabled) return <>{children}</>;
  return (
    <ReactLenis root options={{ autoRaf: false, lerp: 0.1, smoothWheel: true }} ref={lenisRef as never}>
      {children}
    </ReactLenis>
  );
}
