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
  useReducedMotion,
  useMotionValue,
  useSpring,
  useMotionTemplate,
  useScroll,
  useTransform,
  type Variants,
} from "motion/react";

export const EASE = [0.16, 1, 0.3, 1] as const;

// ── Scroll reveal ─────────────────────────────────────────────────────────────
export function Up({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-90px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}
export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09 } } };
export const item: Variants = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } };

// ── Magnetic wrapper (CTAs lean toward the cursor) ────────────────────────────
export function Magnetic({ children, strength = 0.4 }: { children: React.ReactNode; strength?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0), y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 250, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 250, damping: 18, mass: 0.4 });
  return (
    <motion.div
      ref={ref}
      style={{ x: sx, y: sy, display: "inline-block" }}
      onMouseMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onMouseLeave={() => { x.set(0); y.set(0); }}
    >
      {children}
    </motion.div>
  );
}

// ── 3D tilt + mouse-tracking gold spotlight card ──────────────────────────────
export function TiltCard({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(50), my = useMotionValue(50), op = useMotionValue(0);
  const rxRaw = useMotionValue(0), ryRaw = useMotionValue(0);
  const rx = useSpring(rxRaw, { stiffness: 150, damping: 16, mass: 0.3 });
  const ry = useSpring(ryRaw, { stiffness: 150, damping: 16, mass: 0.3 });
  const glow = useMotionTemplate`radial-gradient(420px circle at ${mx}% ${my}%, color-mix(in oklab, var(--gold) 18%, transparent), transparent 45%)`;
  return (
    <motion.div
      ref={ref}
      className={`relative overflow-hidden ${className}`}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1100, ...style }}
      onMouseMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        mx.set(px * 100); my.set(py * 100); op.set(1);
        ryRaw.set((px - 0.5) * 9); rxRaw.set(-(py - 0.5) * 9);
      }}
      onMouseLeave={() => { rxRaw.set(0); ryRaw.set(0); op.set(0); }}
    >
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: glow, opacity: op }} />
      <div className="relative" style={{ transform: "translateZ(40px)" }}>{children}</div>
    </motion.div>
  );
}

// ── Cursor-following glow + ambient aurora backdrop (for heroes / CTAs) ────────
export function GlowField({ children, className = "", strong = false }: { children: React.ReactNode; className?: string; strong?: boolean }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const gx = useMotionValue(50), gy = useMotionValue(30);
  const sgx = useSpring(gx, { stiffness: 60, damping: 20 }), sgy = useSpring(gy, { stiffness: 60, damping: 20 });
  const glow = useMotionTemplate`radial-gradient(680px circle at ${sgx}% ${sgy}%, color-mix(in oklab, var(--gold) ${strong ? 16 : 11}%, transparent) 0%, transparent 60%)`;
  return (
    <div
      ref={ref}
      className={`relative overflow-hidden ${className}`}
      onMouseMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        gx.set(((e.clientX - r.left) / r.width) * 100);
        gy.set(((e.clientY - r.top) / r.height) * 100);
      }}
    >
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 -z-0" style={{ background: glow }} />
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

// ── CTA buttons (magnetic) ────────────────────────────────────────────────────
export function PrimaryCTA({ href, children, big = false }: { href: string; children: React.ReactNode; big?: boolean }) {
  return (
    <Magnetic>
      <Link href={href} className="group bv-btn bv-btn-primary-lg bv-glow-gold bv-press relative overflow-hidden" style={{ padding: big ? "1rem 1.8rem" : "0.95rem 1.6rem", fontSize: big ? "1rem" : "0.98rem" }}>
        <span className="relative z-[1] inline-flex items-center gap-1.5">{children}</span>
        {/* shine sweep on hover */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 transition-[left] duration-700 ease-out group-hover:left-[150%]" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)" }} />
      </Link>
    </Magnetic>
  );
}
export function GhostCTA({ href, children, big = false }: { href: string; children: React.ReactNode; big?: boolean }) {
  return (
    <Magnetic strength={0.25}>
      <Link href={href} className="bv-btn bv-press" style={{ background: "transparent", color: "var(--w)", border: "1px solid var(--border2)", padding: big ? "1rem 1.8rem" : "0.95rem 1.6rem", borderRadius: "var(--r-lg)", fontSize: big ? "1rem" : "0.98rem" }}>
        {children}
      </Link>
    </Magnetic>
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
  return (
    <>
      <Grain />
      <Cursor />
    </>
  );
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

function Cursor() {
  const reduce = useReducedMotion();
  const [enabled, setEnabled] = useState(false);
  const [hot, setHot] = useState(false);
  const x = useMotionValue(-200), y = useMotionValue(-200);
  const rx = useSpring(x, { stiffness: 170, damping: 18, mass: 0.5 });
  const ry = useSpring(y, { stiffness: 170, damping: 18, mass: 0.5 });

  useEffect(() => {
    if (reduce) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: fine)").matches) return; // desktop / mouse only
    setEnabled(true);
    const move = (e: MouseEvent) => { x.set(e.clientX); y.set(e.clientY); };
    const over = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      setHot(!!el?.closest("a, button, [role='button'], input, textarea, select, label"));
    };
    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("mouseover", over, { passive: true });
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseover", over); };
  }, [reduce, x, y]);

  if (!enabled) return null;
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[9998] rounded-full"
      style={{ x: rx, y: ry, translateX: "-50%", translateY: "-50%", mixBlendMode: "screen", border: "1.5px solid var(--gold)" }}
      animate={{ width: hot ? 56 : 30, height: hot ? 56 : 30, opacity: hot ? 0.95 : 0.55, backgroundColor: hot ? "color-mix(in oklab, var(--gold) 14%, transparent)" : "rgba(0,0,0,0)" }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
    />
  );
}
