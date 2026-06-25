"use client";

/**
 * /v2 — new Borivon landing (WIP, side-by-side; live homepage untouched).
 * Direction: MINIMAL + BIG + trustworthy — Mercury / Atlassian / Loom.
 * Copy rule: sell the OUTCOME (a life/career in Germany), never the mechanics
 * (no "cours A1-B2 / prép telc / en ligne"). The beach, not the flight.
 * Two focuses: B2C (your future in Germany) + B2B (open the German market).
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
          Votre avenir vous attend{" "}
          <span style={{ color: "var(--gold)" }}>en Allemagne</span>.
        </motion.h1>

        <motion.p
          className="mx-auto mt-7 max-w-[580px]"
          style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.05rem, 1.6vw, 1.28rem)", lineHeight: 1.65, color: "var(--w2)" }}
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: EASE, delay: 0.12 }}
        >
          Y travailler, y étudier, y construire une nouvelle vie.
          Nous vous y emmenons — accompagné de bout en bout.
        </motion.p>

        <motion.div
          className="mt-11 flex flex-wrap items-center justify-center gap-3"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: EASE, delay: 0.2 }}
        >
          <Link href="#particuliers" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press" style={{ padding: "1rem 1.7rem", fontSize: "1rem" }}>
            Commencer mon avenir
          </Link>
          <Link
            href="#entreprises"
            className="bv-btn bv-press"
            style={{ background: "transparent", color: "var(--w)", border: "1px solid var(--border2)", padding: "1rem 1.7rem", borderRadius: "var(--r-lg)", fontSize: "1rem" }}
          >
            Solutions entreprise
          </Link>
        </motion.div>

        <motion.div
          className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.35 }}
        >
          {["Travailler en Allemagne", "Étudier en Allemagne", "Y refaire sa vie"].map((t) => (
            <span key={t} className="bv-small" style={{ fontSize: "0.82rem", color: "var(--w3)" }}>{t}</span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── Outcome pillars (replaces the stat band) ───────────────────────────────────
function Pillars() {
  const pillars = [
    ["Travailler", "Un métier qualifié qui recrute là-bas."],
    ["Étudier", "Des études reconnues, un diplôme qui compte."],
    ["Vivre", "Une nouvelle vie — la vôtre, à votre rythme."],
  ];
  return (
    <section className="px-[6vw] py-24">
      <Up className="mx-auto grid max-w-[920px] gap-10 text-center sm:grid-cols-3">
        {pillars.map(([n, l]) => (
          <div key={n}>
            <div className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.4vw, 2.9rem)", letterSpacing: "-0.03em", color: "var(--w)" }}>{n}</div>
            <div className="mx-auto mt-3 max-w-[220px] bv-small" style={{ fontSize: "0.92rem", lineHeight: 1.55, color: "var(--w3)" }}>{l}</div>
          </div>
        ))}
      </Up>
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

// ── Journey — outcome-led (level codes are just quiet markers) ─────────────────
function Journey() {
  const steps = [
    { lv: "A1 · A2", t: "Vous osez parler" },
    { lv: "B1", t: "Vous vivez en allemand" },
    { lv: "B2", t: "Vous êtes prêt à partir" },
    { lv: "🇩🇪", t: "Votre nouvelle vie commence" },
  ];
  return (
    <section className="px-[6vw] py-28 sm:py-36" style={{ background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[1080px]">
        <Up className="mx-auto max-w-[640px] text-center">
          <span className="bv-eyebrow">Votre destination</span>
          <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.5vw, 3.2rem)", lineHeight: 1.08, letterSpacing: "-0.025em", color: "var(--w)" }}>
            De votre première phrase à <span style={{ color: "var(--gold)" }}>l'Allemagne</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-[460px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", lineHeight: 1.65, color: "var(--w2)" }}>
            Chaque étape vous rapproche du jour où tout devient possible : un emploi, des études, une vie là-bas.
          </p>
        </Up>
        <motion.div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
          {steps.map((s) => (
            <motion.div key={s.t} variants={item} className="bv-card-lift rounded-2xl p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-[1.6rem] font-medium" style={{ fontFamily: "var(--font-sans)", color: "var(--gold)", letterSpacing: "-0.02em" }}>{s.lv}</div>
              <h3 className="mt-3" style={{ fontFamily: "var(--font-sans)", fontSize: "1.18rem", fontWeight: 500, lineHeight: 1.25, color: "var(--w)" }}>{s.t}</h3>
            </motion.div>
          ))}
        </motion.div>
      </div>
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
      <Up className="relative mx-auto max-w-[780px]">
        <h2 className="mx-auto font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.3rem, 5.5vw, 4rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--w)" }}>
          Votre nouvelle vie commence <span style={{ color: "var(--gold)" }}>aujourd'hui</span>.
        </h2>
        <p className="mx-auto mt-6 max-w-[480px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.1rem", lineHeight: 1.65, color: "var(--w2)" }}>
          Faites le premier pas. On s'occupe du reste.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href="/portal" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press" style={{ padding: "1rem 1.8rem", fontSize: "1rem" }}>Commencer mon avenir</Link>
          <Link href="/portal" className="bv-btn bv-press" style={{ background: "transparent", color: "var(--w)", border: "1px solid var(--border2)", padding: "1rem 1.8rem", borderRadius: "var(--r-lg)", fontSize: "1rem" }}>Solutions entreprise</Link>
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
        title="Construisez votre vie"
        accent="en Allemagne."
        body="Un métier qui recrute, des études reconnues, une vie meilleure. Vous arrivez prêt : confiant, autonome, à votre place dès le premier jour."
        points={["Décrochez une Ausbildung ou un emploi qualifié", "Accédez aux universités allemandes", "Obtenez votre visa, accompagné jusqu'au bout", "Sentez-vous chez vous dès l'arrivée"]}
        cta="Commencer mon avenir"
      />
      <Journey />
      <Audience
        id="entreprises"
        eyebrow="Pour votre entreprise"
        title="Ouvrez le marché"
        accent="allemand."
        body="Des équipes qui négocient, vendent et collaborent en allemand. Plus de marchés, plus de clients, moins de barrières."
        points={["Gagnez des clients germanophones", "Développez-vous sur le marché allemand", "Des équipes autonomes, sans interprète", "Des résultats que vous pouvez mesurer"]}
        cta="Préparer mes équipes"
        reverse
      />
      <FinalCTA />
    </main>
  );
}
