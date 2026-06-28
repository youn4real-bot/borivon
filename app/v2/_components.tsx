"use client";

/**
 * Shared premium building blocks for the /v2 marketing site.
 * Motion lives on motion values (no per-frame re-render); every interaction
 * bails under prefers-reduced-motion and never runs on touch (no mouse events).
 */
import { useRef, useEffect, useState } from "react";
import Link from "next/link";
import {
  motion,
  animate,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useInView,
  type Variants,
  type MotionValue,
} from "motion/react";

export const EASE = [0.16, 1, 0.3, 1] as const;

// ── Scroll-progress bar — a gold line that fills as you scroll. scaleX only
// (GPU-composited, never `width`); a spring smooths fast wheels. Reduced-motion
// removes it entirely. Sits just under the nav. ──────────────────────────────
export function ScrollProgress() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  if (reduce) return null;
  return (
    <motion.div
      aria-hidden
      className="fixed left-0 top-0 z-[999] h-[2px] w-full"
      style={{ scaleX, transformOrigin: "0% 50%", background: "var(--gold-gradient)" }}
    />
  );
}

// ── Scroll reveal ─────────────────────────────────────────────────────────────
export function Up({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 30, scale: 0.985 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-90px" }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}
export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.11 } } };
export const item: Variants = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.62, ease: EASE } } };

// ── Card with a calm hover-lift. Lift = transform; gold glow = an overlay whose
// OPACITY animates (its shadow/border are static) → no var-shadow transition,
// no stale-paint, and the lift is gated to real-hover so it can't latch on touch.
export function TiltCard({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`bv-tilt ${className}`} style={style}>
      {children}
      <span aria-hidden className="bv-tilt-glow" />
    </div>
  );
}

// ── Ambient aurora backdrop (auto-animated; nothing follows the cursor) ───────
export function GlowField({ children, className = "", strong = false }: { children: React.ReactNode; className?: string; strong?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0" style={{ background: `radial-gradient(680px circle at 30% 22%, color-mix(in oklab, var(--gold) ${strong ? 15 : 10}%, transparent) 0%, transparent 60%)` }} />
      {!reduce && (
        <>
          {/* Translate-only on pre-rasterized blurs (no scale → no per-frame blur
              re-raster → smooth on mid-range Android). */}
          <motion.div
            aria-hidden className="pointer-events-none absolute -z-0 h-[520px] w-[520px] rounded-full blur-[90px]"
            style={{ left: "4%", top: "-4%", background: "radial-gradient(circle, color-mix(in oklab, var(--gold) 13%, transparent), transparent 70%)" }}
            animate={{ x: [0, 70, 0], y: [0, 36, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden className="pointer-events-none absolute right-0 -z-0 h-[460px] w-[460px] rounded-full blur-[100px]"
            style={{ right: "2%", top: "12%", background: "radial-gradient(circle, color-mix(in oklab, var(--gold2, var(--gold)) 10%, transparent), transparent 70%)" }}
            animate={{ x: [0, -56, 0], y: [0, 44, 0] }}
            transition={{ duration: 23, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden className="pointer-events-none absolute left-1/2 -z-0 hidden h-[600px] w-[600px] -translate-x-1/2 rounded-full blur-[120px] sm:block"
            style={{ bottom: "-30%", background: "radial-gradient(circle, color-mix(in oklab, var(--gold) 7%, transparent), transparent 70%)" }}
            animate={{ x: [-30, 40, -30] }}
            transition={{ duration: 27, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

// ── Section heading block ─────────────────────────────────────────────────────
export function SectionHead({ eyebrow, title, accent, sub, index, center = true, className = "" }: {
  eyebrow?: string; title: React.ReactNode; accent?: string; sub?: string; index?: string; center?: boolean; className?: string;
}) {
  return (
    <Up className={`${center ? "mx-auto text-center" : ""} max-w-[680px] ${className}`}>
      {eyebrow && (
        <span className={`inline-flex items-center gap-2.5 ${center ? "justify-center" : ""}`}>
          {index && <span style={{ fontFamily: "var(--font-sans)", fontVariantNumeric: "tabular-nums", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.06em", color: "var(--gold-muted)" }}>{index}</span>}
          {index && <span aria-hidden style={{ width: 18, height: 1, background: "var(--border-gold)" }} />}
          <span className="bv-eyebrow">{eyebrow}</span>
        </span>
      )}
      <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.6vw, 3.3rem)", lineHeight: 1.07, letterSpacing: "-0.028em", color: "var(--w)" }}>
        {title} {accent && <span style={{ color: "var(--gold)" }}>{accent}</span>}
      </h2>
      {sub && <p className={`mt-5 ${center ? "mx-auto" : ""} bv-measure-tight`} style={{ fontFamily: "var(--font-sans)", fontSize: "1.06rem", lineHeight: 1.65, color: "var(--w2)" }}>{sub}</p>}
    </Up>
  );
}

// ── CTA buttons (FIXED in place — no magnetic cursor movement; only a hover shine) ─
export function PrimaryCTA({ href, children, big = false }: { href: string; children: React.ReactNode; big?: boolean }) {
  return (
    <Link href={href} className="group bv-btn bv-btn-primary-lg bv-glow-gold bv-press relative overflow-hidden" style={{ padding: big ? "1rem 1.8rem" : "0.95rem 1.6rem", fontSize: big ? "1rem" : "0.98rem" }}>
      <span className="relative z-[1] inline-flex items-center gap-1.5">{children}</span>
      {/* shine sweep on hover (the button itself never moves) */}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 transition-[left] duration-700 ease-out group-hover:left-[150%]" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)" }} />
    </Link>
  );
}
export function GhostCTA({ href, children, big = false }: { href: string; children: React.ReactNode; big?: boolean }) {
  return (
    <Link href={href} className="bv-btn bv-press" style={{ background: "transparent", color: "var(--w)", border: "1px solid var(--border2)", padding: big ? "1rem 1.8rem" : "0.95rem 1.6rem", borderRadius: "var(--r-lg)", fontSize: big ? "1rem" : "0.98rem" }}>
      {children}
    </Link>
  );
}

// ── Drawn check (stroke draws on scroll-in) — replaces the emoji ✓ ────────────
export function Check({ size = 13, color = "var(--gold)" }: { size?: number; color?: string }) {
  const reduce = useReducedMotion();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: "block" }}>
      <motion.path
        d="M4 12.5 L9.5 18 L20 6.5" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0, opacity: 0 }}
        whileInView={{ pathLength: 1, opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.5, ease: EASE, delay: 0.1 }}
      />
    </svg>
  );
}

// ── Checklist card (used by audience / solutions point lists) ──────────────────
export function CheckCard({ children }: { children: React.ReactNode }) {
  return (
    <TiltCard className="flex items-start gap-4 rounded-2xl p-5 bv-surface">
      <span className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}><Check /></span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.55, color: "var(--w)" }}>{children}</span>
    </TiltCard>
  );
}

// ── Kinetic marquee — keywords scroll horizontally (pure motion, seamless loop) ─
export function Marquee({ items, duration = 32 }: { items: string[]; duration?: number }) {
  const reduce = useReducedMotion();
  // Reduced-motion: a single, centered, non-animated row (no doubled strip).
  const row = reduce ? items : [...items, ...items];
  return (
    <div className="relative overflow-hidden py-6" aria-hidden style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
      {/* edge fades (static var(--bg) — never animated) */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-24" style={{ background: "linear-gradient(90deg, var(--bg), transparent)" }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-24" style={{ background: "linear-gradient(270deg, var(--bg), transparent)" }} />
      <motion.div
        className={`flex gap-10 whitespace-nowrap ${reduce ? "flex-wrap justify-center px-6" : "w-max"}`}
        animate={reduce ? undefined : { x: ["0%", "-50%"] }}
        transition={{ duration, repeat: Infinity, ease: "linear" }}
      >
        {row.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-10" style={{ fontFamily: "var(--font-sans)", fontSize: "1.15rem", fontWeight: 500, letterSpacing: "-0.01em", color: "var(--w3)" }}>
            {t}
            <span style={{ color: "var(--gold)" }}>✦</span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

// ── Parallax wrapper (translates a layer on scroll for real depth) ────────────
export function Parallax({ children, distance = 80, className = "", style }: { children: React.ReactNode; distance?: number; className?: string; style?: React.CSSProperties }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  return (
    <div ref={ref} className={className} style={style}>
      <motion.div style={reduce ? undefined : { y }}>{children}</motion.div>
    </div>
  );
}

// ── Atmosphere: signature trailing cursor + film grain (sitewide, desktop) ────
export function Atmosphere() {
  // Film grain only. (Custom cursors are an accessibility/perf anti-pattern and
  // were removed per the taste rubric.)
  return <Grain />;
}

function Grain() {
  // A fixed, ultra-subtle film grain over everything — the single cheapest
  // "this is an expensive site" cue. SVG fractal noise, soft-light blend.
  const noise =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(#n)' opacity='0.5'/></svg>`,
    );
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]" style={{ backgroundImage: `url("${noise}")`, backgroundSize: "140px 140px", opacity: 0.035, mixBlendMode: "overlay" }} />
  );
}

// ── Count-up figure — animates from 0 when scrolled into view (Motion, no raf) ─
export function CountUp({ value, className = "", style }: { value: string; className?: string; style?: React.CSSProperties }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const m = /^(\d+)(.*)$/.exec(value.trim());
  const isNum = !!m;
  const target = m ? parseInt(m[1], 10) : 0;
  const suffix = m ? m[2] : "";
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!isNum) { el.textContent = value; return; }
    if (reduce) { el.textContent = `${target}${suffix}`; return; }
    if (!inView) return;
    const controls = animate(0, target, {
      duration: 1.4,
      ease: EASE,
      onUpdate: (v) => { el.textContent = `${Math.round(v)}${suffix}`; },
    });
    return () => controls.stop();
  }, [inView, reduce, isNum, target, suffix, value]);
  return <span ref={ref} className={className} style={style}>{isNum ? `0${suffix}` : value}</span>;
}

// ── Photo that reveals + gently parallaxes on scroll (the only "alive" images) ─
export function RevealImage({ src, alt, className = "", priority = false }: { src: string; alt: string; className?: string; priority?: boolean }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-8%", "8%"]);
  return (
    <motion.div
      ref={ref}
      className={`relative overflow-hidden ${className}`}
      initial={reduce ? false : { opacity: 0, y: 36 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, ease: EASE }}
      style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderTop: "1px solid var(--border-gold)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <motion.img src={src} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" className="h-full w-full object-cover"
        style={reduce ? { height: "100%", width: "100%" } : { y, scale: 1.15 }} />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, color-mix(in oklab, var(--bg) 6%, transparent), color-mix(in oklab, var(--bg) 72%, transparent))" }} />
    </motion.div>
  );
}

// ── Headline whose words rise from behind a mask when scrolled into view ───────
export function RiseWords({ text, className = "", style, accent = false, delay = 0 }: {
  text: string; className?: string; style?: React.CSSProperties; accent?: boolean; delay?: number;
}) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  return (
    <span className={className} style={style}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom" style={{ marginRight: "0.24em", paddingBottom: "0.1em" }}>
          <motion.span
            className="inline-block"
            initial={reduce ? false : { y: "112%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: delay + i * 0.07 }}
            style={accent ? { color: "var(--gold)" } : undefined}
          >
            {w}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

// ── Full-bleed cinematic image that carries a message ─────────────────────────
// The photo is never naked: it slow-zooms + parallaxes on scroll while an
// eyebrow + two-line headline (+ optional sub) rise over a legibility scrim.
export function CinematicStatement({ src, alt, eyebrow, line1, line2, sub }: {
  src: string; alt: string; eyebrow: string; line1: string; line2: string; sub?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-10%", "10%"]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.18, 1.04]);
  return (
    <section className="px-[5vw] py-12 sm:py-16">
      <div
        ref={ref}
        className="relative mx-auto h-[clamp(440px,74vh,780px)] max-w-[1320px] overflow-hidden rounded-[28px]"
        style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}
      >
        {/* image layer (parallax + slow zoom). Overscanned by 16% so the ±10%
            parallax translate never exposes the container edge. */}
        <motion.div aria-hidden className="absolute -inset-[16%] -z-0" style={reduce ? undefined : { y }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <motion.img src={src} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover" style={reduce ? undefined : { scale }} />
        </motion.div>
        {/* legibility scrims (static) — a diagonal wash + a guaranteed-dark bottom
            band so the overlaid text reads no matter how bright the photo is. */}
        <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(105deg, rgba(8,8,10,0.88) 0%, rgba(8,8,10,0.45) 45%, transparent 82%)" }} />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-3/4" style={{ background: "linear-gradient(0deg, rgba(8,8,10,0.94) 0%, rgba(8,8,10,0.45) 55%, transparent 100%)" }} />
        {/* text */}
        <div className="relative z-[1] flex h-full items-end p-7 sm:p-12 lg:p-16">
          <div className="max-w-[720px]">
            <Up><span className="bv-eyebrow" style={{ color: "var(--gold)" }}>{eyebrow}</span></Up>
            <Up delay={0.08}>
              <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.1rem, 5vw, 3.7rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "#fff" }}>
                {line1} <span style={{ color: "var(--gold)" }}>{line2}</span>
              </h2>
            </Up>
            {sub && (
              <Up delay={0.16}>
                <p className="mt-5 max-w-[480px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.1rem", lineHeight: 1.6, color: "rgba(255,255,255,0.9)" }}>{sub}</p>
              </Up>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Scrollytelling: a line whose words sweep from muted to gold as you scroll
// through it. Two layers per word (muted base + gold overlay swept by opacity) so
// color stays theme-safe and ONLY opacity animates; inline-block keeps the wrap
// identical to a static paragraph (no line-break shift). Reduced-motion → static
// gold line. ─────────────────────────────────────────────────────────────────
export function GoldReveal({ text, className = "" }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.82", "end 0.5"] });
  if (reduce) return <p className={className} style={{ color: "var(--gold)" }}>{text}</p>;
  const words = text.split(" ");
  return (
    <p ref={ref} className={className}>
      {words.map((w, i) => {
        const start = i / words.length;
        const end = Math.min(1, (i + 1.6) / words.length); // overlap → sweep, not step
        return <GoldWord key={i} progress={scrollYProgress} range={[start, end]} word={w} />;
      })}
    </p>
  );
}
function GoldWord({ progress, range, word }: { progress: MotionValue<number>; range: [number, number]; word: string }) {
  const opacity = useTransform(progress, range, [0, 1]);
  return (
    <span className="relative mr-[0.28em] inline-block" style={{ color: "var(--w3)" }}>
      {word}
      <motion.span aria-hidden className="absolute left-0 top-0" style={{ color: "var(--gold)", opacity }}>{word}</motion.span>
    </span>
  );
}

// ── Horizontal pinned scroll. Desktop: the section pins one screen and a wide row
// pans left as you scroll down (the rare "$10k" beat). Touch / reduced-motion: a
// native snap carousel (pinned-horizontal feels broken on phones). Pan distance is
// MEASURED (track − viewport, re-measured on resize) so the last panel always lands
// flush; x is transform-only (no CLS). 100svh sticky height dodges the iOS toolbar
// re-pin. The page passes already-styled panels (shrink-0 + width + snap-align). ──
export function HorizontalPin({ children, heightVh = 320 }: { children: React.ReactNode; heightVh?: number }) {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dist, setDist] = useState(0);

  useEffect(() => {
    const measure = () => {
      const track = trackRef.current, vp = viewportRef.current;
      if (!track || !vp) return;
      setDist(Math.max(0, track.scrollWidth - vp.clientWidth));
    };
    measure();
    window.addEventListener("resize", measure);
    // Re-measure once webfonts swap in (panel widths are vw-fixed, but be safe).
    if (document.fonts?.ready) document.fonts.ready.then(() => measure()).catch(() => {});
    return () => window.removeEventListener("resize", measure);
  }, []);

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end end"] });
  const xRaw = useTransform(scrollYProgress, [0, 1], [0, -dist]);
  const x = useSpring(xRaw, { stiffness: 120, damping: 30, restDelta: 0.01 });

  const carousel = (
    <div className="flex gap-6 overflow-x-auto px-[6vw] pb-3" style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none" }}>
      {children}
    </div>
  );
  if (reduce) return carousel;
  return (
    <>
      <div className="md:hidden">{carousel}</div>
      <div ref={sectionRef} className="relative hidden md:block" style={{ height: `${heightVh}vh` }}>
        <div ref={viewportRef} className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
          <motion.div ref={trackRef} className="flex gap-8 px-[6vw] will-change-transform" style={{ x }}>
            {children}
          </motion.div>
        </div>
      </div>
    </>
  );
}

// ── Background photo for a card/panel: object-cover image + a static bottom-heavy
// scrim (for legible white text) + a faint gold top edge. Parent must be
// position:relative + overflow-hidden + a reserved height. Lazy + async decode. ─
export function PanelPhoto({ src, alt }: { src: string; alt: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, color-mix(in oklab, var(--bg) 12%, transparent) 0%, color-mix(in oklab, var(--bg) 55%, transparent) 50%, color-mix(in oklab, var(--bg) 88%, transparent) 100%)", borderTop: "1px solid var(--border-gold)" }} />
    </>
  );
}
