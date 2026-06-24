"use client";

/**
 * /v2 — new premium Borivon landing page (WIP, side-by-side preview; the live
 * homepage at app/page.tsx is untouched). Two focuses only: B2C (individuals
 * learning German A1→B2) + B2B (companies training teams). Built on the Borivon
 * design system (Lexend, gold #c9a240, dark+pearl, calm premium motion) with
 * motion/react. Renders under the global glass navbar + flag strip.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useReducedMotion,
  type Variants,
} from "motion/react";

// ── Shared motion ─────────────────────────────────────────────────────────────
const EASE = [0.16, 1, 0.3, 1] as const;

const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : "hidden"}
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE, delay } } }}
    >
      {children}
    </motion.div>
  );
}

// ── Audience copy (B2C / B2B) ─────────────────────────────────────────────────
type Aud = "b2c" | "b2b";
const AUD = {
  b2c: {
    pill: "Pour vous",
    accent: "votre avenir",
    sub: "Des cours d'allemand A1 → B2 pensés pour réussir votre Ausbildung, vos études ou votre carrière en Allemagne. En ligne ou en présentiel, à votre rythme.",
    ctaPrimary: "Commencer maintenant",
    ctaSecondary: "Faire le test de niveau",
    stats: [
      { n: "A1–B2", l: "Tous les niveaux" },
      { n: "1:1", l: "Suivi personnalisé" },
      { n: "100%", l: "Orienté objectif" },
    ],
  },
  b2b: {
    pill: "Pour votre entreprise",
    accent: "vos équipes",
    sub: "Formez vos collaborateurs en allemand avec des parcours sur mesure, un suivi mesurable et des formateurs experts — en entreprise ou à distance.",
    ctaPrimary: "Demander une démo",
    ctaSecondary: "Parler à un expert",
    stats: [
      { n: "Sur mesure", l: "Parcours dédiés" },
      { n: "Mesurable", l: "Progrès suivi" },
      { n: "On-site", l: "& à distance" },
    ],
  },
} as const;

// ── Hero ──────────────────────────────────────────────────────────────────────
function Hero() {
  const [aud, setAud] = useState<Aud>("b2c");
  const reduce = useReducedMotion();
  const a = AUD[aud];

  return (
    <section className="relative overflow-hidden px-[6vw] pt-[120px] pb-20 sm:pt-[150px] sm:pb-28">
      {/* ambient gold glow + giant watermark B */}
      <div className="bv-ambient-glow" aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-[8vw] top-1/2 -translate-y-1/2 select-none"
        style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "44vw", lineHeight: 1, color: "color-mix(in oklab, var(--gold) 6%, transparent)" }}
      >
        B
      </div>

      <div className="relative mx-auto grid max-w-[1180px] items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        {/* left — copy */}
        <div>
          {/* segmented audience switch */}
          <div className="mb-7 inline-flex rounded-full border p-1" style={{ borderColor: "var(--border2)", background: "var(--bg2)" }}>
            {(["b2c", "b2b"] as Aud[]).map((k) => (
              <button
                key={k}
                onClick={() => setAud(k)}
                className="relative rounded-full px-4 py-2 text-[13px] font-semibold transition-colors"
                style={{ color: aud === k ? "#131312" : "var(--w2)" }}
              >
                {aud === k && (
                  <motion.span
                    layoutId="audPill"
                    className="absolute inset-0 rounded-full"
                    style={{ background: "var(--gold)" }}
                    transition={{ duration: 0.4, ease: EASE }}
                  />
                )}
                <span className="relative z-10">{AUD[k].pill}</span>
              </button>
            ))}
          </div>

          <h1 className="bv-hero" style={{ fontSize: "clamp(2.4rem,5.2vw,4rem)", lineHeight: 1.04 }}>
            Maîtrisez l'allemand,
            <br />
            ouvrez{" "}
            <AnimatePresence mode="wait" initial={false}>
              <motion.em
                key={a.accent}
                initial={reduce ? false : { opacity: 0, y: 16, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduce ? undefined : { opacity: 0, y: -16, filter: "blur(6px)" }}
                transition={{ duration: 0.4, ease: EASE }}
                style={{ display: "inline-block" }}
              >
                {a.accent}
              </motion.em>
            </AnimatePresence>
            .
          </h1>

          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={aud}
              className="bv-body-lg mt-6 max-w-[520px]"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              {a.sub}
            </motion.p>
          </AnimatePresence>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/portal" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press">{a.ctaPrimary}</Link>
            <Link
              href="#parcours"
              className="bv-btn bv-press"
              style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border2)", padding: "0.85rem 1.3rem", borderRadius: "var(--r-lg)", fontSize: "0.92rem" }}
            >
              {a.ctaSecondary}
            </Link>
          </div>

          {/* morphing mini-stats */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={aud}
              className="mt-10 flex flex-wrap gap-x-9 gap-y-4"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {a.stats.map((s) => (
                <div key={s.l}>
                  <div className="bv-num text-[1.4rem]" style={{ color: "var(--gold)" }}>{s.n}</div>
                  <div className="bv-small">{s.l}</div>
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* right — animated visual card that morphs per audience */}
        <div className="relative">
          <AnimatePresence mode="wait" initial={false}>
            {aud === "b2c" ? (
              <motion.div key="b2c-card" {...cardAnim(reduce)}>
                <LearnerCard />
              </motion.div>
            ) : (
              <motion.div key="b2b-card" {...cardAnim(reduce)}>
                <TeamCard />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function cardAnim(reduce: boolean | null) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24, rotateX: 6 },
    animate: { opacity: 1, y: 0, rotateX: 0 },
    exit: reduce ? undefined : { opacity: 0, y: -24, rotateX: -6 },
    transition: { duration: 0.5, ease: EASE },
  } as const;
}

// B2C visual — a learner level-journey card with an animated A1→B2 fill
function LearnerCard() {
  const levels = ["A1", "A2", "B1", "B2"];
  return (
    <div className="bv-card relative p-6" style={{ borderRadius: "var(--r-2xl)" }}>
      <div className="bv-gold-accent" />
      <div className="flex items-center justify-between">
        <span className="bv-eyebrow">Votre parcours</span>
        <span className="bv-chip bv-chip-gold">Objectif&nbsp;B2</span>
      </div>
      <div className="mt-5 space-y-3">
        {levels.map((lv, i) => (
          <div key={lv} className="flex items-center gap-3">
            <span className="bv-num w-7 text-[13px]" style={{ color: i < 3 ? "var(--gold)" : "var(--w3)" }}>{lv}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--bg2)" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: "var(--gold-gradient)" }}
                initial={{ width: 0 }}
                animate={{ width: i < 3 ? "100%" : "62%" }}
                transition={{ duration: 0.9, ease: EASE, delay: 0.2 + i * 0.15 }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-3 rounded-xl p-3" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
        <WordFlipper />
      </div>
    </div>
  );
}

// B2B visual — a team cohort progress card
function TeamCard() {
  const team = [
    { name: "Service Export", pct: 82 },
    { name: "Ingénierie", pct: 64 },
    { name: "Support client", pct: 91 },
  ];
  return (
    <div className="bv-card relative p-6" style={{ borderRadius: "var(--r-2xl)" }}>
      <div className="bv-gold-accent" />
      <div className="flex items-center justify-between">
        <span className="bv-eyebrow">Tableau d'équipe</span>
        <span className="bv-chip bv-chip-success">+18% ce trimestre</span>
      </div>
      <div className="mt-5 space-y-4">
        {team.map((t, i) => (
          <div key={t.name}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="bv-body text-[0.85rem]" style={{ color: "var(--w)" }}>{t.name}</span>
              <span className="bv-num text-[0.85rem]" style={{ color: "var(--gold)" }}>{t.pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--bg2)" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: "var(--gold-gradient)" }}
                initial={{ width: 0 }}
                animate={{ width: `${t.pct}%` }}
                transition={{ duration: 0.9, ease: EASE, delay: 0.2 + i * 0.15 }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2 text-center">
        {[["12", "cohortes"], ["95%", "assiduité"], ["B2", "cible"]].map(([n, l]) => (
          <div key={l} className="rounded-xl py-3" style={{ background: "var(--bg2)" }}>
            <div className="bv-num text-[1.1rem]" style={{ color: "var(--w)" }}>{n}</div>
            <div className="bv-small">{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// EN/FR → DE word flipper (interactive: cycles, click to advance)
const WORDS: [string, string][] = [
  ["Bonjour", "Hallo"],
  ["Merci", "Danke"],
  ["Le travail", "Die Arbeit"],
  ["Réussir", "Schaffen"],
  ["Bienvenue", "Willkommen"],
];
function WordFlipper() {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((x) => (x + 1) % WORDS.length), 2400);
    return () => clearInterval(t);
  }, [reduce]);
  const [fr, de] = WORDS[i];
  return (
    <button onClick={() => setI((x) => (x + 1) % WORDS.length)} className="flex w-full items-center justify-between text-left">
      <span className="bv-small" style={{ color: "var(--w2)" }}>{fr}</span>
      <span style={{ color: "var(--w3)" }}>→</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={de}
          className="bv-num text-[0.95rem]"
          style={{ color: "var(--gold)" }}
          initial={reduce ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduce ? undefined : { opacity: 0, y: -8, filter: "blur(4px)" }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          {de}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

// ── Trust marquee ──────────────────────────────────────────────────────────────
function TrustStrip() {
  const items = ["Ausbildung", "Studium", "Arbeit", "Visa", "Pflege", "Ingénierie", "A1 → B2", "Casablanca", "En ligne", "En présentiel"];
  return (
    <div className="relative overflow-hidden border-y py-4" style={{ borderColor: "var(--border)" }}>
      <div className="flex w-max animate-[bvMarquee_32s_linear_infinite] gap-10 pr-10">
        {[...items, ...items].map((t, i) => (
          <span key={i} className="bv-eyebrow-muted whitespace-nowrap" style={{ fontSize: "0.8rem" }}>{t}</span>
        ))}
      </div>
      <style>{`@keyframes bvMarquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
    </div>
  );
}

// ── Dual path cards ─────────────────────────────────────────────────────────────
function Paths() {
  const cards = [
    {
      tag: "Particuliers",
      title: "Apprenez pour vous",
      desc: "Un parcours A1 → B2 clair, avec un suivi humain, pour atteindre votre objectif allemand — études, Ausbildung, ou carrière.",
      bullets: ["Cours en ligne & en présentiel", "Préparation Goethe / telc", "Test de niveau gratuit", "Accompagnement jusqu'au visa"],
      cta: "Découvrir les cours",
      href: "/portal",
    },
    {
      tag: "Entreprises",
      title: "Formez vos équipes",
      desc: "Des programmes d'allemand sur mesure pour vos collaborateurs, avec reporting de progression et formateurs dédiés.",
      bullets: ["Parcours adaptés à vos métiers", "Sessions en entreprise ou à distance", "Suivi & rapports mesurables", "Facturation entreprise"],
      cta: "Demander une démo",
      href: "/portal",
    },
  ];
  return (
    <section id="parcours" className="px-[6vw] py-24">
      <div className="mx-auto max-w-[1180px]">
        <Reveal className="mb-12 text-center">
          <span className="bv-eyebrow">Deux façons d'avancer</span>
          <h2 className="bv-h1 mx-auto mt-3 max-w-[640px]">Un seul institut, <em style={{ fontStyle: "normal", color: "var(--gold)" }}>deux chemins</em> vers l'allemand.</h2>
        </Reveal>
        <motion.div
          className="grid gap-6 md:grid-cols-2"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {cards.map((c) => (
            <motion.div key={c.title} variants={rise} className="bv-card bv-card-lift relative p-8" style={{ borderRadius: "var(--r-2xl)" }}>
              <div className="bv-gold-accent" />
              <span className="bv-chip bv-chip-gold">{c.tag}</span>
              <h3 className="bv-h2 mt-4">{c.title}</h3>
              <p className="bv-body mt-3">{c.desc}</p>
              <ul className="mt-6 space-y-2.5">
                {c.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 bv-body" style={{ fontSize: "0.88rem" }}>
                    <span style={{ color: "var(--gold)" }}>✓</span>
                    {b}
                  </li>
                ))}
              </ul>
              <Link href={c.href} className="bv-choice mt-7">
                <span>{c.cta}</span>
                <span className="bv-choice-arrow">→</span>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── Journey rail (scroll-driven A1→B2) ──────────────────────────────────────────
function Journey() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.4"] });
  const fill = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const steps = [
    { lv: "A1 · A2", t: "Les fondations", d: "Prononciation, premières phrases, confiance dès la première semaine." },
    { lv: "B1", t: "L'autonomie", d: "Conversations réelles, grammaire solide, vie quotidienne en allemand." },
    { lv: "B2", t: "Le palier décisif", d: "Le niveau qui débloque l'Ausbildung, les études et le travail en Allemagne." },
    { lv: "🇩🇪", t: "L'Allemagne", d: "Prêt pour le visa, l'emploi et une nouvelle vie — accompagné de bout en bout." },
  ];
  return (
    <section ref={ref} className="px-[6vw] py-24" style={{ background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[900px]">
        <Reveal className="mb-14 text-center">
          <span className="bv-eyebrow">Le parcours</span>
          <h2 className="bv-h1 mt-3">De zéro à <em style={{ fontStyle: "normal", color: "var(--gold)" }}>B2</em> — étape par étape.</h2>
        </Reveal>
        <div className="relative pl-10">
          {/* rail */}
          <div className="absolute left-[14px] top-2 bottom-2 w-[2px] overflow-hidden rounded" style={{ background: "var(--border)" }}>
            <motion.div className="w-full" style={{ height: fill, background: "var(--gold-gradient)" }} />
          </div>
          <div className="space-y-10">
            {steps.map((s, i) => (
              <Reveal key={s.t} delay={i * 0.05}>
                <div className="relative">
                  <span className="absolute -left-10 top-1 grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold" style={{ background: "var(--card)", border: "1px solid var(--border-gold)", color: "var(--gold)" }}>{i + 1}</span>
                  <div className="bv-eyebrow" style={{ color: "var(--gold)" }}>{s.lv}</div>
                  <h3 className="bv-h3 mt-1">{s.t}</h3>
                  <p className="bv-body mt-1.5 max-w-[560px]">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Feature bento ───────────────────────────────────────────────────────────────
function Features() {
  const feats = [
    { t: "Formateurs experts", d: "Des professeurs qui connaissent le chemin vers l'Allemagne — pas juste la grammaire.", span: "md:col-span-2" },
    { t: "En ligne & présentiel", d: "Apprenez où vous voulez, au rythme qui vous convient.", span: "" },
    { t: "Suivi humain", d: "Un accompagnement réel, pas une appli impersonnelle.", span: "" },
    { t: "Objectif B2", d: "Tout est conçu autour du niveau qui change tout.", span: "md:col-span-2" },
  ];
  return (
    <section className="px-[6vw] py-24">
      <div className="mx-auto max-w-[1180px]">
        <Reveal className="mb-12">
          <span className="bv-eyebrow">Pourquoi Borivon</span>
          <h2 className="bv-h1 mt-3 max-w-[620px]">Une école pensée pour <em style={{ fontStyle: "normal", color: "var(--gold)" }}>réussir</em>, pas juste pour apprendre.</h2>
        </Reveal>
        <motion.div className="grid gap-5 md:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
          {feats.map((f) => (
            <motion.div key={f.t} variants={rise} className={`bv-card bv-card-lift p-7 ${f.span}`} style={{ borderRadius: "var(--r-xl)" }}>
              <h3 className="bv-h3">{f.t}</h3>
              <p className="bv-body mt-2">{f.d}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── Final CTA ───────────────────────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section className="relative overflow-hidden px-[6vw] py-28">
      <div className="bv-ambient-glow" aria-hidden />
      <Reveal className="relative mx-auto max-w-[760px] text-center">
        <h2 className="bv-hero" style={{ fontSize: "clamp(2rem,4.5vw,3.2rem)" }}>
          Prêt à parler <em style={{ fontStyle: "normal", color: "var(--gold)" }}>allemand</em> ?
        </h2>
        <p className="bv-body-lg mx-auto mt-5 max-w-[520px]">Que vous appreniez pour vous ou pour vos équipes, votre parcours commence aujourd'hui.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/portal" className="bv-btn bv-btn-primary-lg bv-glow-gold bv-press">Commencer — particulier</Link>
          <Link href="/portal" className="bv-btn bv-press" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border2)", padding: "0.85rem 1.3rem", borderRadius: "var(--r-lg)", fontSize: "0.92rem" }}>Solutions entreprise</Link>
        </div>
      </Reveal>
    </section>
  );
}

export default function V2Page() {
  return (
    <main style={{ background: "var(--bg)", color: "var(--w)" }}>
      <Hero />
      <TrustStrip />
      <Paths />
      <Journey />
      <Features />
      <FinalCTA />
    </main>
  );
}
