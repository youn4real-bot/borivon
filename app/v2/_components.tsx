"use client";

/**
 * Shared premium building blocks for the /v2 marketing site.
 * Motion lives on motion values (no per-frame re-render); every interaction
 * bails under prefers-reduced-motion and never runs on touch (no mouse events).
 */
import { useRef } from "react";
import Link from "next/link";
import {
  motion,
  useReducedMotion,
  useMotionValue,
  useSpring,
  useMotionTemplate,
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
            style={{ left: "6%", top: "0%", background: "radial-gradient(circle, color-mix(in oklab, var(--gold) 12%, transparent), transparent 70%)" }}
            animate={{ x: [0, 60, 0], y: [0, 30, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden className="pointer-events-none absolute right-0 -z-0 h-[460px] w-[460px] rounded-full blur-[100px]"
            style={{ right: "3%", top: "16%", background: "radial-gradient(circle, color-mix(in oklab, var(--gold) 8%, transparent), transparent 70%)" }}
            animate={{ x: [0, -50, 0], y: [0, 40, 0] }}
            transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
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
      <Link href={href} className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press" style={{ padding: big ? "1rem 1.8rem" : "0.95rem 1.6rem", fontSize: big ? "1rem" : "0.98rem" }}>
        {children}
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

// ── Checklist card (used by audience / solutions point lists) ──────────────────
export function CheckCard({ children }: { children: React.ReactNode }) {
  return (
    <TiltCard className="flex items-start gap-4 rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <span className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>✓</span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.55, color: "var(--w)" }}>{children}</span>
    </TiltCard>
  );
}
