"use client";

/**
 * /v2 — new Borivon landing (WIP, side-by-side; live homepage untouched).
 * Direction: MINIMAL + BIG + trustworthy — Mercury / Atlassian / Loom.
 * Huge confident type, generous whitespace, restraint, calm subtle motion.
 * Two focuses: B2C (apprendre l'allemand) + B2B (former ses équipes).
 * Built on the Borivon design system (Lexend, gold #c9a240, dark+pearl).
 */
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

function Up({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-90px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.1 } } };
const item: Variants = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE } } };

// ── Hero ────────────────────────────────────────────────────────────────────
function Hero() {
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden px-[6vw] pt-[150px] pb-28 sm:pt-[190px] sm:pb-40">
      {/* soft gold wash — Mercury-style ambient, very restrained */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-0 h-[560px] w-[1100px] max-w-[140vw] -translate-x-1/2"
        style={{ background: "radial-gradient(ellipse 50% 60% at 50% 0%, color-mix(in oklab, var(--gold) 14%, transparent) 0%, transparent 70%)" }}
      />
      <div className="relative mx-auto max-w-[1080px] text-center">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <span className="bv-eyebrow">Institut de langue allemande · Casablanca</span>
        </motion.div>

        <motion.h1
          className="mx-auto mt-7 max-w-[15ch] font-medium"
          style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.7rem, 7.2vw, 5.7rem)", lineHeight: 1.02, letterSpacing: "-0.03em", color: "var(--w)" }}
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: EASE, delay: 0.05 }}
        >
          L'allemand qui ouvre{" "}
          <span style={{ color: "var(--gold)" }}>l'Allemagne</span>.
        </motion.h1>

        <motion.p
          className="mx-auto mt-7 max-w-[600px]"
          style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.05rem, 1.6vw, 1.28rem)", lineHeight: 1.65, color: "var(--w2)" }}
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: EASE, delay: 0.12 }}
        >
          Des cours d'allemand A1 à B2 pour les particuliers et les entreprises —
          en ligne et en présentiel, pensés pour réussir.
        </motion.p>

        <motion.div
          className="mt-11 flex flex-wrap items-center justify-center gap-3"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: EASE, delay: 0.2 }}
        >
          <Link href="#particuliers" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press" style={{ padding: "1rem 1.7rem", fontSize: "1rem" }}>
            Apprendre l'allemand
          </Link>
          <Link
            href="#entreprises"
            className="bv-btn bv-press"
            style={{ background: "transparent", color: "var(--w)", border: "1px solid var(--border2)", padding: "1rem 1.7rem", borderRadius: "var(--r-lg)", fontSize: "1rem" }}
          >
            Former mes équipes
          </Link>
        </motion.div>

        <motion.div
          className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.35 }}
        >
          {["A1 → B2", "En ligne & présentiel", "Ausbildung · Studium · Arbeit"].map((t) => (
            <span key={t} className="bv-small" style={{ fontSize: "0.82rem", color: "var(--w3)" }}>{t}</span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── A single big audience block (alternating) ──────────────────────────────────
function Audience({
  id, eyebrow, title, accent, body, points, cta, reverse,
}: {
  id: string; eyebrow: string; title: string; accent: string; body: string;
  points: string[]; cta: string; reverse?: boolean;
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
          <Link href="/portal" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press mt-9" style={{ padding: "0.95rem 1.6rem", fontSize: "0.98rem" }}>{cta}</Link>
        </Up>
        <Up delay={0.1}>
          <motion.ul className="space-y-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            {points.map((p) => (
              <motion.li
                key={p}
                variants={item}
                className="bv-card-lift flex items-start gap-4 rounded-2xl p-5"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <span className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>✓</span>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.55, color: "var(--w)" }}>{p}</span>
              </motion.li>
            ))}
          </motion.ul>
        </Up>
      </div>
    </section>
  );
}

// ── Journey A1 → B2 → Allemagne (big, minimal) ────────────────────────────────
function Journey() {
  const steps = [
    { lv: "A1 · A2", t: "Les fondations" },
    { lv: "B1", t: "L'autonomie" },
    { lv: "B2", t: "Le palier décisif" },
    { lv: "🇩🇪", t: "L'Allemagne" },
  ];
  return (
    <section className="px-[6vw] py-28 sm:py-36" style={{ background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[1080px]">
        <Up className="mx-auto max-w-[620px] text-center">
          <span className="bv-eyebrow">Le parcours</span>
          <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.5vw, 3.2rem)", lineHeight: 1.08, letterSpacing: "-0.025em", color: "var(--w)" }}>
            De zéro à <span style={{ color: "var(--gold)" }}>B2</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-[440px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", lineHeight: 1.65, color: "var(--w2)" }}>
            Le niveau qui débloque l'Ausbildung, les études et le travail en Allemagne.
          </p>
        </Up>
        <motion.div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
          {steps.map((s, i) => (
            <motion.div key={s.t} variants={item} className="bv-card-lift rounded-2xl p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-[2.4rem] font-medium" style={{ fontFamily: "var(--font-sans)", color: "var(--gold)", letterSpacing: "-0.03em" }}>{s.lv}</div>
              <div className="mt-3 bv-small" style={{ color: "var(--w3)" }}>Étape {i + 1}</div>
              <h3 className="mt-1" style={{ fontFamily: "var(--font-sans)", fontSize: "1.1rem", fontWeight: 500, color: "var(--w)" }}>{s.t}</h3>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── Trust / proof — minimal stat band ──────────────────────────────────────────
function Proof() {
  const stats = [
    ["A1 → B2", "Tous les niveaux"],
    ["1 : 1", "Suivi humain"],
    ["100%", "Orienté résultat"],
  ];
  return (
    <section className="px-[6vw] py-24">
      <Up className="mx-auto grid max-w-[900px] gap-10 text-center sm:grid-cols-3">
        {stats.map(([n, l]) => (
          <div key={l}>
            <div className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.4rem, 5vw, 3.4rem)", letterSpacing: "-0.03em", color: "var(--w)" }}>{n}</div>
            <div className="mt-2 bv-small" style={{ fontSize: "0.92rem", color: "var(--w3)" }}>{l}</div>
          </div>
        ))}
      </Up>
    </section>
  );
}

// ── Final CTA — big ─────────────────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section className="relative overflow-hidden px-[6vw] py-32 sm:py-44 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-[500px] w-[900px] max-w-[140vw] -translate-x-1/2 -translate-y-1/2"
        style={{ background: "radial-gradient(ellipse 50% 50% at 50% 50%, color-mix(in oklab, var(--gold) 12%, transparent) 0%, transparent 70%)" }}
      />
      <Up className="relative mx-auto max-w-[760px]">
        <h2 className="mx-auto font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.3rem, 5.5vw, 4rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--w)" }}>
          Commencez l'allemand <span style={{ color: "var(--gold)" }}>aujourd'hui</span>.
        </h2>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href="/portal" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press" style={{ padding: "1rem 1.8rem", fontSize: "1rem" }}>Particuliers</Link>
          <Link href="/portal" className="bv-btn bv-press" style={{ background: "transparent", color: "var(--w)", border: "1px solid var(--border2)", padding: "1rem 1.8rem", borderRadius: "var(--r-lg)", fontSize: "1rem" }}>Entreprises</Link>
        </div>
      </Up>
    </section>
  );
}

export default function V2Page() {
  return (
    <main style={{ background: "var(--bg)", color: "var(--w)" }}>
      <Hero />
      <Proof />
      <Audience
        id="particuliers"
        eyebrow="Pour vous"
        title="Apprenez l'allemand pour"
        accent="votre avenir."
        body="Partez de zéro et atteignez le niveau B2, accompagné par de vrais professeurs — jusqu'à votre Ausbildung, vos études ou votre carrière en Allemagne."
        points={["Cours en ligne et en présentiel", "Préparation Goethe / telc", "Test de niveau gratuit", "Accompagnement jusqu'au visa"]}
        cta="Démarrer mon parcours"
      />
      <Journey />
      <Audience
        id="entreprises"
        eyebrow="Pour votre entreprise"
        title="Formez"
        accent="vos équipes."
        body="Des programmes d'allemand sur mesure pour vos collaborateurs, avec une progression mesurable et un rapport clair — en entreprise, en ligne, ou dans vos locaux."
        points={["Parcours adaptés à vos métiers", "Cohortes en entreprise ou à distance", "Suivi et rapports mesurables", "Facturation entreprise"]}
        cta="Demander une démo"
        reverse
      />
      <FinalCTA />
    </main>
  );
}
