"use client";

/**
 * Shared premium building blocks for the /v2 marketing site.
 * Motion lives on motion values (no per-frame re-render); every interaction
 * bails under prefers-reduced-motion and never runs on touch (no mouse events).
 */
import { useRef, useEffect } from "react";
import Link from "next/link";
import {
  motion,
  animate,
  useReducedMotion,
  useScroll,
  useTransform,
  useInView,
  type Variants,
} from "motion/react";

export const EASE = [0.16, 1, 0.3, 1] as const;

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
export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09 } } };
export const item: Variants = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } };

// ── Card with a calm hover-lift (NO cursor tracking — nothing follows the mouse) ─
export function TiltCard({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`overflow-hidden transition-[transform,border-color,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:[border-color:var(--border-gold)] hover:shadow-[0_22px_55px_-22px_rgba(201,162,64,0.32)] ${className}`}
      style={style}
    >
      {children}
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
          <motion.div
            aria-hidden className="pointer-events-none absolute -z-0 h-[520px] w-[520px] rounded-full blur-[90px]"
            style={{ left: "4%", top: "-4%", background: "radial-gradient(circle, color-mix(in oklab, var(--gold) 13%, transparent), transparent 70%)" }}
            animate={{ x: [0, 70, 0], y: [0, 36, 0], scale: [1, 1.12, 1] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden className="pointer-events-none absolute right-0 -z-0 h-[460px] w-[460px] rounded-full blur-[100px]"
            style={{ right: "2%", top: "12%", background: "radial-gradient(circle, color-mix(in oklab, var(--gold2, var(--gold)) 10%, transparent), transparent 70%)" }}
            animate={{ x: [0, -56, 0], y: [0, 44, 0], scale: [1.1, 1, 1.1] }}
            transition={{ duration: 23, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden className="pointer-events-none absolute left-1/2 -z-0 h-[600px] w-[600px] -translate-x-1/2 rounded-full blur-[120px]"
            style={{ bottom: "-30%", background: "radial-gradient(circle, color-mix(in oklab, var(--gold) 7%, transparent), transparent 70%)" }}
            animate={{ x: [-30, 40, -30], scale: [1, 1.15, 1] }}
            transition={{ duration: 27, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

// ── Section heading block ─────────────────────────────────────────────────────
export function SectionHead({ eyebrow, title, accent, sub, center = true, className = "" }: {
  eyebrow?: string; title: React.ReactNode; accent?: string; sub?: string; center?: boolean; className?: string;
}) {
  return (
    <Up className={`${center ? "mx-auto text-center" : ""} max-w-[680px] ${className}`}>
      {eyebrow && <span className="bv-eyebrow">{eyebrow}</span>}
      <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.6vw, 3.3rem)", lineHeight: 1.07, letterSpacing: "-0.028em", color: "var(--w)" }}>
        {title} {accent && <span style={{ color: "var(--gold)" }}>{accent}</span>}
      </h2>
      {sub && <p className={`mt-5 ${center ? "mx-auto" : ""} max-w-[560px]`} style={{ fontFamily: "var(--font-sans)", fontSize: "1.06rem", lineHeight: 1.65, color: "var(--w2)" }}>{sub}</p>}
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
    <TiltCard className="flex items-start gap-4 rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <span className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}><Check /></span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.55, color: "var(--w)" }}>{children}</span>
    </TiltCard>
  );
}

// ── Kinetic marquee — keywords scroll horizontally (pure motion, seamless loop) ─
export function Marquee({ items, duration = 32 }: { items: string[]; duration?: number }) {
  const reduce = useReducedMotion();
  const row = [...items, ...items];
  return (
    <div className="relative overflow-hidden py-6" aria-hidden style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-24" style={{ background: "linear-gradient(90deg, var(--bg), transparent)" }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-24" style={{ background: "linear-gradient(270deg, var(--bg), transparent)" }} />
      <motion.div
        className="flex w-max gap-10 whitespace-nowrap"
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
      style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <motion.img src={src} alt={alt} loading={priority ? "eager" : "lazy"} className="h-full w-full object-cover"
        style={reduce ? { height: "100%", width: "100%" } : { y, scale: 1.15 }} />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, color-mix(in oklab, var(--bg) 8%, transparent), color-mix(in oklab, var(--bg) 60%, transparent))" }} />
    </motion.div>
  );
}
