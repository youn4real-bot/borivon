"use client";

/**
 * /v2 — Borivon landing (WIP, side-by-side; live homepage untouched).
 *
 * Direction: MINIMAL + BIG + trustworthy (Mercury/Atlassian/Loom) WITH premium
 * interactive motion — cursor-following hero glow + aurora, word-by-word headline
 * reveal, magnetic buttons, 3D tilt cards with a mouse-tracking gold spotlight,
 * scroll-drawn progress line. All on motion values (no per-frame re-render) and
 * fully reduced-motion + touch safe.
 *
 * POSITIONING (per founder): ENTERPRISE-FIRST. The hero is the hybrid delivery
 * model — En ligne · Vor Ort · Hybride — framed as the thing that solves
 * Germany's labour/language problem (Fachkräftemangel + integration). Companies
 * lead; individuals are a secondary section.
 *
 * Copy rule: OUTCOME only. No level jargon (A1/A2/B1/B2). German for the German
 * labour market, made operational — fast.
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

// ── Hero (enterprise-first; hybrid model + "solves Germany") ──────────────────
function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const gx = useMotionValue(50), gy = useMotionValue(28);
  const sgx = useSpring(gx, { stiffness: 60, damping: 20 }), sgy = useSpring(gy, { stiffness: 60, damping: 20 });
  const glow = useMotionTemplate`radial-gradient(680px circle at ${sgx}% ${sgy}%, color-mix(in oklab, var(--gold) 16%, transparent) 0%, transparent 60%)`;

  const headline = ["Vos", "talents,", "opérationnels", "en"];
  return (
    <section
      ref={ref}
      className="relative overflow-hidden px-[6vw] pt-[150px] pb-28 sm:pt-[185px] sm:pb-36"
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
          <span className="bv-eyebrow">L&apos;allemand pour le marché du travail allemand</span>
        </motion.div>

        <h1 className="mx-auto mt-7 max-w-[15ch] font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.7rem, 7.2vw, 5.7rem)", lineHeight: 1.02, letterSpacing: "-0.03em", color: "var(--w)" }}>
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
            allemand.
          </motion.span>
        </h1>

        <motion.p
          className="mx-auto mt-7 max-w-[600px]"
          style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.05rem, 1.6vw, 1.28rem)", lineHeight: 1.65, color: "var(--w2)" }}
          initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.5 }}
        >
          Un modèle hybride — <strong style={{ color: "var(--w)", fontWeight: 600 }}>en ligne</strong> et <strong style={{ color: "var(--w)", fontWeight: 600 }}>vor Ort</strong> — qui prépare vos collaborateurs internationaux au marché allemand. Plus vite, et pour de bon.
        </motion.p>

        <motion.div className="mt-11 flex flex-wrap items-center justify-center gap-4" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.6 }}>
          <Magnetic>
            <Link href="#entreprises" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press" style={{ padding: "1rem 1.7rem", fontSize: "1rem" }}>Parler à un expert</Link>
          </Magnetic>
          <Magnetic strength={0.25}>
            <Link href="#modele" className="bv-btn bv-press" style={{ background: "transparent", color: "var(--w)", border: "1px solid var(--border2)", padding: "1rem 1.7rem", borderRadius: "var(--r-lg)", fontSize: "1rem" }}>Découvrir le modèle</Link>
          </Magnetic>
        </motion.div>

        <motion.div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: EASE, delay: 0.8 }}>
          {["En ligne & vor Ort", "Sans jargon ni niveaux", "Orienté résultats"].map((t) => (
            <span key={t} className="bv-small" style={{ fontSize: "0.82rem", color: "var(--w3)" }}>{t}</span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── The problem (gofluent-style business framing, no fabricated stats) ────────
function Problem() {
  const points = [
    ["Le talent n'est pas le frein.", "La langue l'est. Sans allemand, même les meilleurs profils restent bloqués."],
    ["L'intégration qui traîne coûte cher.", "Chaque mois sans allemand opérationnel, c'est de la productivité — et des talents — perdus."],
    ["La reconnaissance exige l'allemand.", "Pas d'Anerkennung, pas de poste qualifié. La langue est la clé du dossier."],
  ];
  return (
    <section className="px-[6vw] py-24 sm:py-28">
      <div className="mx-auto max-w-[1080px]">
        <Up className="mx-auto max-w-[680px] text-center">
          <span className="bv-eyebrow">Le défi allemand</span>
          <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.5vw, 3.2rem)", lineHeight: 1.08, letterSpacing: "-0.025em", color: "var(--w)" }}>
            L&apos;Allemagne a besoin de talents. <span style={{ color: "var(--gold)" }}>Vos talents ont besoin d&apos;allemand.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-[560px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", lineHeight: 1.65, color: "var(--w2)" }}>
            La pénurie de main-d&apos;œuvre freine les entreprises allemandes. Le vrai obstacle n&apos;est pas de recruter — c&apos;est la langue.
          </p>
        </Up>

        <motion.div className="mt-14 grid gap-5 sm:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
          {points.map(([t, d]) => (
            <motion.div key={t} variants={item}>
              <TiltCard className="h-full rounded-2xl p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <h3 style={{ fontFamily: "var(--font-sans)", fontSize: "1.12rem", fontWeight: 600, lineHeight: 1.3, color: "var(--w)" }}>{t}</h3>
                <p className="mt-3" style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w2)" }}>{d}</p>
              </TiltCard>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── THE HYBRID MODEL — the centerpiece (En ligne · Vor Ort · Hybride) ─────────
function HybridModel() {
  const modes = [
    {
      tag: "En ligne",
      title: "Flexible, partout.",
      body: "Vos collaborateurs apprennent sans quitter leur poste, à leur rythme — avec un accompagnement humain, jamais une vidéo de plus.",
      featured: false,
    },
    {
      tag: "Hybride",
      title: "Le meilleur des deux.",
      body: "La flexibilité de l'en ligne, l'ancrage du présentiel. Le modèle qui fait tenir l'allemand dans la durée — et passer à l'action.",
      featured: true,
    },
    {
      tag: "Vor Ort",
      title: "L'immersion qui ancre.",
      body: "En présentiel, sur place. L'allemand qui s'installe par la pratique, le contact réel et le terrain — pas par cœur.",
      featured: false,
    },
  ];
  return (
    <section id="modele" className="px-[6vw] py-28 sm:py-36" style={{ background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[1140px]">
        <Up className="mx-auto max-w-[680px] text-center">
          <span className="bv-eyebrow">Notre modèle</span>
          <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.1rem, 5vw, 3.4rem)", lineHeight: 1.06, letterSpacing: "-0.03em", color: "var(--w)" }}>
            En ligne. Vor Ort. <span style={{ color: "var(--gold)" }}>Hybride.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-[540px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.07rem", lineHeight: 1.65, color: "var(--w2)" }}>
            Un seul objectif — l&apos;allemand opérationnel — par le chemin qui convient à vos équipes. Choisissez. Ou combinez.
          </p>
        </Up>

        <motion.div className="mt-16 grid gap-6 lg:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
          {modes.map((m) => (
            <motion.div key={m.tag} variants={item} className={m.featured ? "lg:-mt-4 lg:mb-4" : ""}>
              <TiltCard
                className="flex h-full flex-col rounded-[22px] p-8"
                style={{
                  background: m.featured ? "var(--gdim)" : "var(--card)",
                  border: `1px solid ${m.featured ? "var(--border-gold)" : "var(--border)"}`,
                  boxShadow: m.featured ? "var(--shadow-gold-sm)" : "none",
                }}
              >
                <span
                  className="inline-flex w-fit items-center rounded-full px-3 py-1 text-[12px] font-semibold"
                  style={{
                    background: m.featured ? "var(--gold)" : "var(--gdim)",
                    color: m.featured ? "#131312" : "var(--gold)",
                    border: m.featured ? "none" : "1px solid var(--border-gold)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {m.tag}
                </span>
                <h3 className="mt-5 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "1.5rem", lineHeight: 1.2, letterSpacing: "-0.02em", color: "var(--w)" }}>{m.title}</h3>
                <p className="mt-3" style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.62, color: "var(--w2)" }}>{m.body}</p>
              </TiltCard>
            </motion.div>
          ))}
        </motion.div>

        <Up delay={0.1} className="mx-auto mt-12 max-w-[620px] text-center">
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w3)" }}>
            <span style={{ color: "var(--gold)" }}>Vor Ort</span> = sur place, en présentiel. Le mot que les Allemands emploient pour « là où ça se passe vraiment ».
          </p>
        </Up>
      </div>
    </section>
  );
}

// ── Audience block (reusable) ─────────────────────────────────────────────────
function Audience({ id, eyebrow, title, accent, body, points, cta, ctaHref = "/portal", reverse }: {
  id: string; eyebrow: string; title: string; accent: string; body: string; points: string[]; cta: string; ctaHref?: string; reverse?: boolean;
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
            <Link href={ctaHref} className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press mt-9" style={{ padding: "0.95rem 1.6rem", fontSize: "0.98rem" }}>{cta}</Link>
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
    ["01", "Les premiers mots, en confiance"],
    ["02", "Une vraie conversation, au travail"],
    ["03", "Le métier géré en allemand"],
    ["04", "Opérationnel sur le marché allemand"],
  ];
  return (
    <section className="px-[6vw] py-28 sm:py-32">
      <div className="mx-auto max-w-[1080px]">
        <Up className="mx-auto max-w-[640px] text-center">
          <span className="bv-eyebrow">La progression</span>
          <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.5vw, 3.2rem)", lineHeight: 1.08, letterSpacing: "-0.025em", color: "var(--w)" }}>
            De zéro à <span style={{ color: "var(--gold)" }}>opérationnel</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-[480px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", lineHeight: 1.65, color: "var(--w2)" }}>
            Sans jargon, sans niveaux qui font peur — juste des étapes claires vers un objectif clair.
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

// ── Trust band (no fabricated numbers — qualitative proof) ────────────────────
function Trust() {
  const items = [
    ["Institut dédié", "Une école d'allemand à Casablanca, tournée vers l'Allemagne."],
    ["Méthode orientée résultats", "On vise l'allemand qui travaille, pas les diplômes pour la vitrine."],
    ["Accompagnement de bout en bout", "De la langue jusqu'à l'intégration — un humain à chaque étape."],
  ];
  return (
    <section className="px-[6vw] py-20" style={{ background: "var(--bg2)" }}>
      <motion.div className="mx-auto grid max-w-[1000px] gap-8 sm:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-70px" }}>
        {items.map(([t, d]) => (
          <motion.div key={t} variants={item}>
            <div className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "1.18rem", letterSpacing: "-0.02em", color: "var(--gold)" }}>{t}</div>
            <p className="mt-2.5" style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w2)" }}>{d}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

// ── Final CTA (enterprise-led) ────────────────────────────────────────────────
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
      <Up className="relative mx-auto max-w-[820px]">
        <h2 className="mx-auto font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.3rem, 5.5vw, 4rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--w)" }}>
          Préparez vos talents au <span style={{ color: "var(--gold)" }}>marché allemand</span>.
        </h2>
        <p className="mx-auto mt-6 max-w-[500px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.1rem", lineHeight: 1.65, color: "var(--w2)" }}>
          Parlons de vos équipes. On construit le parcours — en ligne, vor Ort, ou les deux.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Magnetic>
            <Link href="#entreprises" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press" style={{ padding: "1rem 1.8rem", fontSize: "1rem" }}>Parler à un expert</Link>
          </Magnetic>
          <Magnetic strength={0.25}>
            <Link href="#particuliers" className="bv-btn bv-press" style={{ background: "transparent", color: "var(--w)", border: "1px solid var(--border2)", padding: "1rem 1.8rem", borderRadius: "var(--r-lg)", fontSize: "1rem" }}>Pour les particuliers</Link>
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
      <Problem />
      <HybridModel />
      <Audience
        id="entreprises"
        eyebrow="Pour les entreprises"
        title="L'allemand qui fait avancer"
        accent="vos équipes."
        body="Vos collaborateurs internationaux opérationnels en allemand — plus vite. Une intégration qui ne traîne plus, des dossiers de reconnaissance qui avancent, des équipes qui restent."
        points={[
          "Des collaborateurs opérationnels, plus vite",
          "Une intégration qui ne traîne plus",
          "La reconnaissance des diplômes débloquée (Anerkennung)",
          "Des équipes qui restent — et montent en compétence",
        ]}
        cta="Parler à un expert"
        ctaHref="/portal"
      />
      <Journey />
      <Audience
        id="particuliers"
        eyebrow="Pour les particuliers"
        title="L'allemand simplifié pour"
        accent="votre carrière."
        body="Décrochez le poste, l'Ausbildung ou les études que vous visez en Allemagne. Une méthode claire qui vous fait progresser vite — sans vous noyer, sans jargon."
        points={[
          "Décrochez un emploi qualifié en Allemagne",
          "Accédez à l'Ausbildung ou aux études",
          "Parlez avec confiance, plus vite que prévu",
          "Accompagné jusqu'à votre objectif",
        ]}
        cta="Booster ma carrière"
        ctaHref="/portal"
        reverse
      />
      <Trust />
      <FinalCTA />
    </main>
  );
}
