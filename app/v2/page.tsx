"use client";

/**
 * /v2 — Borivon landing (WIP, side-by-side; live homepage untouched).
 * Direction: MINIMAL + BIG + trustworthy (Mercury/Atlassian/Loom) WITH premium
 * interactive motion — cursor-following hero glow + aurora, word-by-word headline
 * reveal, magnetic buttons, 3D tilt cards with a mouse-tracking gold spotlight,
 * scroll-drawn progress line. All on motion values (no per-frame re-render) and
 * fully reduced-motion + touch safe.
 *
 * Copy rule: OUTCOME only — German made easy for your CAREER. No level jargon
 * (A1/A2/B1/B2). B2C = your career; B2B = your team's careers / your business.
 */
import { useRef } from "react";
import Link from "next/link";
import {
  motion,
  useReducedMotion,
  useMotionValue,
  useSpring,
  useScroll,
  useTransform,
  useMotionTemplate,
  type Variants,
} from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

// ── Scroll reveal ─────────────────────────────────────────────────────────────
function Up({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
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
const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09 } } };
const item: Variants = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } };

// ── Magnetic wrapper (CTAs lean toward the cursor) ────────────────────────────
function Magnetic({ children, strength = 0.4 }: { children: React.ReactNode; strength?: number }) {
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
function TiltCard({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
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

// ── Hero ──────────────────────────────────────────────────────────────────────
function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const gx = useMotionValue(50), gy = useMotionValue(28);
  const sgx = useSpring(gx, { stiffness: 60, damping: 20 }), sgy = useSpring(gy, { stiffness: 60, damping: 20 });
  const glow = useMotionTemplate`radial-gradient(680px circle at ${sgx}% ${sgy}%, color-mix(in oklab, var(--gold) 16%, transparent) 0%, transparent 60%)`;

  const headline = ["L'allemand", "qui", "fait", "décoller", "votre"];
  return (
    <section
      ref={ref}
      className="relative overflow-hidden px-[6vw] pt-[150px] pb-28 sm:pt-[185px] sm:pb-40"
      onMouseMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        gx.set(((e.clientX - r.left) / r.width) * 100);
        gy.set(((e.clientY - r.top) / r.height) * 100);
      }}
    >
      {/* cursor-following glow */}
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 -z-0" style={{ background: glow }} />
      {/* slow ambient aurora */}
      {!reduce && (
        <>
          <motion.div
            aria-hidden className="pointer-events-none absolute -z-0 h-[520px] w-[520px] rounded-full blur-[90px]"
            style={{ left: "8%", top: "2%", background: "radial-gradient(circle, color-mix(in oklab, var(--gold) 13%, transparent), transparent 70%)" }}
            animate={{ x: [0, 60, 0], y: [0, 30, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden className="pointer-events-none absolute right-0 -z-0 h-[460px] w-[460px] rounded-full blur-[100px]"
            style={{ right: "4%", top: "18%", background: "radial-gradient(circle, color-mix(in oklab, var(--gold) 9%, transparent), transparent 70%)" }}
            animate={{ x: [0, -50, 0], y: [0, 40, 0] }}
            transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      )}

      <div className="relative mx-auto max-w-[1080px] text-center">
        <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
          <span className="bv-eyebrow">Institut de langue allemande · Casablanca</span>
        </motion.div>

        <h1 className="mx-auto mt-7 max-w-[16ch] font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.7rem, 7.2vw, 5.7rem)", lineHeight: 1.02, letterSpacing: "-0.03em", color: "var(--w)" }}>
          {headline.map((w, i) => (
            <motion.span
              key={i}
              className="inline-block"
              style={{ marginRight: "0.24em" }}
              initial={reduce ? false : { opacity: 0, y: 24, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.06 * i }}
            >
              {w}
            </motion.span>
          ))}
          <motion.span
            className="inline-block"
            style={{ color: "var(--gold)" }}
            initial={reduce ? false : { opacity: 0, y: 24, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.06 * headline.length }}
          >
            carrière.
          </motion.span>
        </h1>

        <motion.p
          className="mx-auto mt-7 max-w-[560px]"
          style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.05rem, 1.6vw, 1.28rem)", lineHeight: 1.65, color: "var(--w2)" }}
          initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.5 }}
        >
          L'allemand rendu simple, humain, efficace. Pour vous — comme pour vos équipes.
        </motion.p>

        <motion.div className="mt-11 flex flex-wrap items-center justify-center gap-4" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.6 }}>
          <Magnetic>
            <Link href="#particuliers" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press" style={{ padding: "1rem 1.7rem", fontSize: "1rem" }}>Booster ma carrière</Link>
          </Magnetic>
          <Magnetic strength={0.25}>
            <Link href="#entreprises" className="bv-btn bv-press" style={{ background: "transparent", color: "var(--w)", border: "1px solid var(--border2)", padding: "1rem 1.7rem", borderRadius: "var(--r-lg)", fontSize: "1rem" }}>Solutions entreprise</Link>
          </Magnetic>
        </motion.div>

        <motion.div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: EASE, delay: 0.8 }}>
          {["Pas de jargon", "Pas de niveaux", "Juste des résultats"].map((t) => (
            <span key={t} className="bv-small" style={{ fontSize: "0.82rem", color: "var(--w3)" }}>{t}</span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── Outcome pillars ─────────────────────────────────────────────────────────────
function Pillars() {
  const pillars = [
    ["Décrocher", "Le poste ou l'Ausbildung que vous visez."],
    ["Évoluer", "Montez en compétence, prenez de l'avance."],
    ["Réussir", "Atteignez votre objectif, accompagné."],
  ];
  return (
    <section className="px-[6vw] py-24">
      <motion.div className="mx-auto grid max-w-[940px] gap-6 sm:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-70px" }}>
        {pillars.map(([n, l]) => (
          <motion.div key={n} variants={item} className="text-center">
            <div className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.9rem, 4.2vw, 2.7rem)", letterSpacing: "-0.03em", color: "var(--gold)" }}>{n}</div>
            <div className="mx-auto mt-3 max-w-[240px] bv-small" style={{ fontSize: "0.95rem", lineHeight: 1.55, color: "var(--w2)" }}>{l}</div>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

// ── Audience block ──────────────────────────────────────────────────────────────
function Audience({ id, eyebrow, title, accent, body, points, cta, reverse }: {
  id: string; eyebrow: string; title: string; accent: string; body: string; points: string[]; cta: string; reverse?: boolean;
}) {
  return (
    <section id={id} className="px-[6vw] py-24 sm:py-32">
      <div className={`mx-auto grid max-w-[1080px] items-center gap-12 lg:grid-cols-2 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <Up>
          <span className="bv-eyebrow">{eyebrow}</span>
          <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.2vw, 3.1rem)", lineHeight: 1.08, letterSpacing: "-0.025em", color: "var(--w)" }}>
            {title} <span style={{ color: "var(--gold)" }}>{accent}</span>
          </h2>
          <p className="mt-6 max-w-[460px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.08rem", lineHeight: 1.7, color: "var(--w2)" }}>{body}</p>
          <Magnetic>
            <Link href="/portal" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press mt-9" style={{ padding: "0.95rem 1.6rem", fontSize: "0.98rem" }}>{cta}</Link>
          </Magnetic>
        </Up>
        <Up delay={0.1}>
          <motion.ul className="space-y-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
            {points.map((p) => (
              <motion.li key={p} variants={item}>
                <TiltCard className="flex items-start gap-4 rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <span className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>✓</span>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.55, color: "var(--w)" }}>{p}</span>
                </TiltCard>
              </motion.li>
            ))}
          </motion.ul>
        </Up>
      </div>
    </section>
  );
}

// ── Journey — scroll-drawn line + tilt cards, NO level codes ──────────────────
function Journey() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.5"] });
  const lineW = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const steps = [
    ["01", "Vos premiers mots, en confiance"],
    ["02", "Vous tenez une vraie conversation"],
    ["03", "Vous gérez votre travail en allemand"],
    ["04", "Vous atteignez votre objectif"],
  ];
  return (
    <section className="px-[6vw] py-28 sm:py-36" style={{ background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[1080px]">
        <Up className="mx-auto max-w-[640px] text-center">
          <span className="bv-eyebrow">Votre progression</span>
          <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.5vw, 3.2rem)", lineHeight: 1.08, letterSpacing: "-0.025em", color: "var(--w)" }}>
            De zéro à <span style={{ color: "var(--gold)" }}>opérationnel</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-[480px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", lineHeight: 1.65, color: "var(--w2)" }}>
            Sans jargon, sans niveaux qui font peur — juste des étapes claires vers votre objectif.
          </p>
        </Up>

        <div ref={ref} className="relative mt-16">
          {/* scroll-drawn line (desktop) */}
          <div className="absolute left-0 right-0 top-[34px] hidden h-[2px] lg:block" style={{ background: "var(--border)" }}>
            <motion.div className="h-full" style={{ width: lineW, background: "var(--gold-gradient)" }} />
          </div>
          <motion.div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
            {steps.map(([n, t]) => (
              <motion.div key={n} variants={item}>
                <TiltCard className="rounded-2xl p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="grid h-12 w-12 place-items-center rounded-full text-[1.1rem] font-bold" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>{n}</div>
                  <h3 className="mt-5" style={{ fontFamily: "var(--font-sans)", fontSize: "1.16rem", fontWeight: 500, lineHeight: 1.3, color: "var(--w)" }}>{t}</h3>
                </TiltCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ── Final CTA ───────────────────────────────────────────────────────────────────
function FinalCTA() {
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden px-[6vw] py-32 sm:py-44 text-center">
      {!reduce && (
        <motion.div
          aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-[560px] w-[900px] max-w-[140vw] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px]"
          style={{ background: "radial-gradient(ellipse 50% 50% at 50% 50%, color-mix(in oklab, var(--gold) 13%, transparent) 0%, transparent 70%)" }}
          animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <Up className="relative mx-auto max-w-[780px]">
        <h2 className="mx-auto font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.3rem, 5.5vw, 4rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--w)" }}>
          Votre carrière, <span style={{ color: "var(--gold)" }}>en allemand</span>.
        </h2>
        <p className="mx-auto mt-6 max-w-[480px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.1rem", lineHeight: 1.65, color: "var(--w2)" }}>
          Faites le premier pas. On s'occupe du reste.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Magnetic>
            <Link href="/portal" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press" style={{ padding: "1rem 1.8rem", fontSize: "1rem" }}>Booster ma carrière</Link>
          </Magnetic>
          <Magnetic strength={0.25}>
            <Link href="/portal" className="bv-btn bv-press" style={{ background: "transparent", color: "var(--w)", border: "1px solid var(--border2)", padding: "1rem 1.8rem", borderRadius: "var(--r-lg)", fontSize: "1rem" }}>Solutions entreprise</Link>
          </Magnetic>
        </div>
      </Up>
    </section>
  );
}

export default function V2Page() {
  return (
    <main style={{ background: "var(--bg)", color: "var(--w)" }}>
      <Hero />
      <Pillars />
      <Audience
        id="particuliers"
        eyebrow="Pour vous"
        title="L'allemand simplifié pour"
        accent="votre carrière."
        body="Décrochez le poste, l'Ausbildung ou les études que vous visez. Une méthode claire qui vous fait progresser vite — sans vous noyer, sans jargon."
        points={["Décrochez un emploi qualifié", "Accédez à l'Ausbildung ou aux études", "Parlez avec confiance, plus vite que vous ne le pensez", "Accompagné jusqu'à votre objectif"]}
        cta="Booster ma carrière"
      />
      <Journey />
      <Audience
        id="entreprises"
        eyebrow="Pour votre entreprise"
        title="L'allemand qui fait avancer"
        accent="vos équipes."
        body="Des collaborateurs qui servent vos clients allemands, échangent avec vos partenaires — et montent en compétence. Un atout pour eux, un avantage pour vous."
        points={["Servez vos clients germanophones avec aisance", "Échangez avec vos partenaires, sans interprète", "Des équipes qui montent en compétence", "Une méthode simple, des résultats mesurables"]}
        cta="Former mes équipes"
        reverse
      />
      <FinalCTA />
    </main>
  );
}
