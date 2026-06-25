"use client";

/**
 * /v2 — Home (enterprise-first). The hybrid delivery model (En ligne · Vor Ort
 * · Hybride) is the centerpiece, framed as solving Germany's labour/language
 * problem. Individuals are a secondary section. Trilingual (FR/EN/DE) via
 * useLang. Premium interactive motion from ./_components; reduced-motion safe.
 */
import { useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useLang } from "@/components/LangContext";
import { COPY, type Tri } from "./_copy";
import {
  EASE, Up, stagger, item, TiltCard, GlowField, SectionHead,
  PrimaryCTA, GhostCTA, CheckCard, Check, Marquee, Parallax, RevealImage, CinematicStatement,
} from "./_components";

const C = COPY;

// Professional, on-message photos (each one is paired with text + scroll motion).
const IMG = {
  outcomes:  "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1200&q=72", // business meeting
  statement: "https://images.unsplash.com/photo-1600880292089-90a7e086ee0c?auto=format&fit=crop&w=2000&q=72", // colleagues in conversation
  ai:        "https://images.unsplash.com/photo-1531746790731-6c087fecd65a?auto=format&fit=crop&w=1200&q=72", // learning online
};

// One word, revealed by rising from behind a mask (overflow-hidden line).
function MaskWord({ children, delay, accent }: { children: React.ReactNode; delay: number; accent?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <span className="inline-block overflow-hidden align-bottom" style={{ marginRight: "0.24em", paddingBottom: "0.12em" }}>
      <motion.span
        className="inline-block"
        initial={reduce ? false : { y: "115%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.85, ease: EASE, delay }}
        style={accent ? { color: "var(--gold)" } : undefined}
      >
        {children}
      </motion.span>
    </span>
  );
}

function HomeHero() {
  const { lang } = useLang();
  const reduce = useReducedMotion();
  const T = (t: Tri) => t[lang];
  const words = T(C.home.heroTitle).split(" ");
  const { scrollY } = useScroll();
  const contentY = useTransform(scrollY, [0, 520], [0, -90]);
  const contentOp = useTransform(scrollY, [0, 420], [1, 0]);

  return (
    <GlowField className="px-[6vw] pt-[150px] pb-28 sm:pt-[185px] sm:pb-40" strong>
      {/* giant parallax watermark — depth, on-brand */}
      <Parallax distance={110} className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
        <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 700, fontSize: "clamp(9rem, 34vw, 30rem)", lineHeight: 1, color: "var(--w)", opacity: 0.035, whiteSpace: "nowrap", userSelect: "none" }}>Borivon</span>
      </Parallax>

      <motion.div className="relative z-[1] mx-auto max-w-[1180px]" style={reduce ? undefined : { y: contentY, opacity: contentOp }}>
        <div className="max-w-[840px]">
          <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
            <span className="bv-eyebrow" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", textTransform: "none", letterSpacing: "0", fontSize: "0.95rem" }}>{T(C.home.heroEyebrow)}</span>
          </motion.div>

          <h1 className="mt-6 max-w-[15ch] font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.8rem, 7.4vw, 6rem)", lineHeight: 1.0, letterSpacing: "-0.035em", color: "var(--w)" }}>
            {words.map((w, i) => (<MaskWord key={i} delay={0.15 + 0.08 * i}>{w}</MaskWord>))}
            <MaskWord delay={0.15 + 0.08 * words.length} accent>{T(C.home.heroAccent)}</MaskWord>
          </h1>

          <motion.p className="mt-7 max-w-[560px]" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.05rem, 1.6vw, 1.28rem)", lineHeight: 1.65, color: "var(--w2)" }}
            initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.6 }}>
            {T(C.home.heroSub)}
          </motion.p>

          <motion.div className="mt-11 flex flex-wrap items-center gap-4" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.75 }}>
            <PrimaryCTA href="/v2/contact" big>{T(C.home.heroCta1)}</PrimaryCTA>
            <GhostCTA href="/v2/methode" big>{T(C.home.heroCta2)}</GhostCTA>
          </motion.div>

          <motion.div className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-3" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: EASE, delay: 0.95 }}>
            {[T(C.home.chip1), T(C.home.chip2), T(C.home.chip3)].map((t) => (
              <span key={t} className="bv-small" style={{ fontSize: "0.82rem", color: "var(--w3)" }}>{t}</span>
            ))}
          </motion.div>
        </div>
      </motion.div>
    </GlowField>
  );
}

function Problem() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const cards = [
    [C.home.problem1Title, C.home.problem1Body],
    [C.home.problem2Title, C.home.problem2Body],
    [C.home.problem3Title, C.home.problem3Body],
  ] as const;
  return (
    <section className="px-[6vw] py-24 sm:py-28">
      <div className="mx-auto max-w-[1080px]">
        <SectionHead eyebrow={T(C.home.problemEyebrow)} title={T(C.home.problemTitle)} accent={T(C.home.problemAccent)} sub={T(C.home.problemSub)} />
        <motion.div className="mt-14 grid gap-5 sm:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
          {cards.map(([t, d]) => (
            <motion.div key={T(t)} variants={item}>
              <TiltCard className="h-full rounded-2xl p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <h3 style={{ fontFamily: "var(--font-sans)", fontSize: "1.12rem", fontWeight: 600, lineHeight: 1.3, color: "var(--w)" }}>{T(t)}</h3>
                <p className="mt-3" style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(d)}</p>
              </TiltCard>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function HybridModel() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const modes = [
    { tag: C.home.modeOnlineTag, h: C.home.modeOnlineH, b: C.home.modeOnlineB, featured: false },
    { tag: C.home.modeHybridTag, h: C.home.modeHybridH, b: C.home.modeHybridB, featured: true },
    { tag: C.home.modeVorOrtTag, h: C.home.modeVorOrtH, b: C.home.modeVorOrtB, featured: false },
  ];
  return (
    <section id="modele" className="px-[6vw] py-28 sm:py-36" style={{ background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[1140px]">
        <SectionHead eyebrow={T(C.home.modelEyebrow)} title={T(C.home.modelTitle)} accent={T(C.home.modelAccent)} sub={T(C.home.modelSub)} />
        <motion.div className="mt-16 grid gap-6 lg:grid-cols-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
          {modes.map((m) => (
            <motion.div key={T(m.tag)} variants={item} className={m.featured ? "lg:col-span-2" : ""}>
              <TiltCard className={`flex h-full flex-col rounded-[22px] ${m.featured ? "p-10" : "p-8"}`} style={{ background: m.featured ? "var(--gdim)" : "var(--card)", border: `1px solid ${m.featured ? "var(--border-gold)" : "var(--border)"}`, boxShadow: m.featured ? "var(--shadow-gold-sm)" : "none" }}>
                <span className="inline-flex w-fit items-center rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: m.featured ? "var(--gold)" : "var(--gdim)", color: m.featured ? "#131312" : "var(--gold)", border: m.featured ? "none" : "1px solid var(--border-gold)", letterSpacing: "-0.01em" }}>{T(m.tag)}</span>
                <h3 className="mt-5 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: m.featured ? "1.9rem" : "1.4rem", lineHeight: 1.15, letterSpacing: "-0.02em", color: "var(--w)" }}>{T(m.h)}</h3>
                <p className="mt-3 max-w-[42ch]" style={{ fontFamily: "var(--font-sans)", fontSize: m.featured ? "1.06rem" : "1rem", lineHeight: 1.62, color: "var(--w2)" }}>{T(m.b)}</p>
              </TiltCard>
            </motion.div>
          ))}
        </motion.div>
        <Up delay={0.1} className="mx-auto mt-12 max-w-[620px] text-center">
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w3)" }}>{T(C.home.modelGloss)}</p>
        </Up>
      </div>
    </section>
  );
}

function Audience({ id, eyebrow, title, accent, body, points, cta, ctaHref, reverse }: {
  id: string; eyebrow: string; title: string; accent: string; body: string; points: string[]; cta: string; ctaHref: string; reverse?: boolean;
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
          <div className="mt-9"><PrimaryCTA href={ctaHref}>{cta}</PrimaryCTA></div>
        </Up>
        <Up delay={0.1}>
          <motion.ul className="space-y-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
            {points.map((p) => (<motion.li key={p} variants={item}><CheckCard>{p}</CheckCard></motion.li>))}
          </motion.ul>
        </Up>
      </div>
    </section>
  );
}

function Journey() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.5"] });
  const lineW = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const steps = [["01", C.home.step1], ["02", C.home.step2], ["03", C.home.step3], ["04", C.home.step4]] as const;
  return (
    <section className="px-[6vw] py-28 sm:py-32">
      <div className="mx-auto max-w-[1080px]">
        <SectionHead title={T(C.home.journeyTitle)} accent={T(C.home.journeyAccent)} sub={T(C.home.journeySub)} />
        <div ref={ref} className="relative mt-16">
          <div className="absolute left-0 right-0 top-[34px] hidden h-[2px] lg:block" style={{ background: "var(--border)" }}>
            <motion.div className="h-full" style={{ width: lineW, background: "var(--gold-gradient)" }} />
          </div>
          <motion.div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
            {steps.map(([n, t]) => (
              <motion.div key={n} variants={item}>
                <TiltCard className="rounded-2xl p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="grid h-12 w-12 place-items-center rounded-full text-[1.1rem] font-bold" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>{n}</div>
                  <h3 className="mt-5" style={{ fontFamily: "var(--font-sans)", fontSize: "1.16rem", fontWeight: 500, lineHeight: 1.3, color: "var(--w)" }}>{T(t)}</h3>
                </TiltCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function Trust() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const items = [[C.home.trustA_h, C.home.trustA_b], [C.home.trustB_h, C.home.trustB_b], [C.home.trustC_h, C.home.trustC_b]] as const;
  return (
    <section className="px-[6vw] py-20" style={{ background: "var(--bg2)" }}>
      <motion.div className="mx-auto grid max-w-[1000px] gap-8 sm:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-70px" }}>
        {items.map(([t, d]) => (
          <motion.div key={T(t)} variants={item}>
            <div className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "1.18rem", letterSpacing: "-0.02em", color: "var(--gold)" }}>{T(t)}</div>
            <p className="mt-2.5" style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(d)}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

function FinalCTA() {
  const { lang } = useLang();
  const reduce = useReducedMotion();
  const T = (t: Tri) => t[lang];
  return (
    <section className="relative overflow-hidden px-[6vw] py-32 sm:py-44 text-center">
      {!reduce && (
        <motion.div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-[560px] w-[900px] max-w-[140vw] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px]"
          style={{ background: "radial-gradient(ellipse 50% 50% at 50% 50%, color-mix(in oklab, var(--gold) 13%, transparent) 0%, transparent 70%)" }}
          animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} />
      )}
      <Up className="relative mx-auto max-w-[820px]">
        <h2 className="mx-auto font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.3rem, 5.5vw, 4rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--w)" }}>
          {T(C.home.finalTitle)} <span style={{ color: "var(--gold)" }}>{T(C.home.finalAccent)}</span>
        </h2>
        <p className="mx-auto mt-6 max-w-[500px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.1rem", lineHeight: 1.65, color: "var(--w2)" }}>{T(C.home.finalSub)}</p>
        <div className="mt-10 flex justify-center">
          <PrimaryCTA href="/v2/contact" big>{T(C.home.finalCta)}</PrimaryCTA>
        </div>
      </Up>
    </section>
  );
}

// Same German, two framings — B2C + B2B, each linking to its deep page.
function Who() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const W = C.who;
  const cards = [
    { h: W.indH, b: W.indB, href: "/v2/particuliers" },
    { h: W.entH, b: W.entB, href: "/v2/solutions" },
  ];
  return (
    <section className="px-[6vw] py-24 sm:py-32">
      <div className="mx-auto max-w-[1080px]">
        <SectionHead eyebrow={T(W.eyebrow)} title={T(W.title)} accent={T(W.accent)} sub={T(W.sub)} />
        <motion.div className="mt-14 grid gap-6 sm:grid-cols-2" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
          {cards.map((c) => (
            <motion.div key={T(c.h)} variants={item}>
              <Link href={c.href} className="block h-full">
                <TiltCard className="flex h-full flex-col rounded-[22px] p-8" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <h3 className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "1.5rem", letterSpacing: "-0.02em", color: "var(--w)" }}>{T(c.h)}</h3>
                  <p className="mt-3 flex-1" style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(c.b)}</p>
                  <span className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-semibold" style={{ color: "var(--gold)" }}>{T(W.more)} <span aria-hidden>→</span></span>
                </TiltCard>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// Vor Ort (in-person) — offered on request only, behind the contact form.
function VorOrt() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const V = C.vorort;
  return (
    <section className="px-[6vw] py-20" style={{ background: "var(--bg2)" }}>
      <Up className="mx-auto max-w-[760px] text-center">
        <h2 className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.7rem, 4vw, 2.6rem)", lineHeight: 1.12, letterSpacing: "-0.025em", color: "var(--w)" }}>{T(V.title)}</h2>
        <p className="mx-auto mt-5 max-w-[560px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", lineHeight: 1.65, color: "var(--w2)" }}>{T(V.body)}</p>
        <div className="mt-8 flex justify-center"><PrimaryCTA href="/v2/contact" big>{T(V.cta)}</PrimaryCTA></div>
      </Up>
    </section>
  );
}

// Outcomes — a professional photo that PINS on scroll (desktop) while the four
// outcome points reveal one by one beside it. The image always carries the text:
// you scroll, the meeting photo stays, the promises stack up next to it.
function OutcomesSticky() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const E = C.ent;
  const points = [E.p1, E.p2, E.p3, E.p4];
  return (
    <section id="outcomes" className="px-[6vw] py-24 sm:py-32">
      <div className="mx-auto grid max-w-[1140px] items-start gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Pinned image (sticky on desktop; below the nav). On mobile it just stacks. */}
        <div className="lg:sticky lg:top-[92px] lg:self-start">
          <RevealImage src={IMG.outcomes} alt={lang === "de" ? "Meeting auf Deutsch" : lang === "fr" ? "Réunion en allemand" : "Meeting in German"} className="aspect-[4/5] rounded-[26px] sm:aspect-[16/10] lg:aspect-[4/5]" priority />
        </div>
        {/* Scrolling text + revealing points */}
        <div>
          <Up>
            <span className="bv-eyebrow">{T(E.eyebrow)}</span>
            <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.4vw, 3.2rem)", lineHeight: 1.07, letterSpacing: "-0.027em", color: "var(--w)" }}>
              {T(E.title)} <span style={{ color: "var(--gold)" }}>{T(E.accent)}</span>
            </h2>
            <p className="mt-6 max-w-[460px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.08rem", lineHeight: 1.7, color: "var(--w2)" }}>{T(E.body)}</p>
          </Up>
          <motion.ul className="mt-10 space-y-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
            {points.map((p) => (<motion.li key={T(p)} variants={item}><CheckCard>{T(p)}</CheckCard></motion.li>))}
          </motion.ul>
          <Up delay={0.1} className="mt-9"><PrimaryCTA href="/v2/contact">{T(E.cta)}</PrimaryCTA></Up>
        </div>
      </div>
    </section>
  );
}

// AI — we teach WITH AI + teach you to USE AI to learn faster.
function AISection() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const A = C.ai;
  const points = [[A.c1H, A.c1B], [A.c2H, A.c2B], [A.c3H, A.c3B]] as const;
  return (
    <section className="px-[6vw] py-24 sm:py-32" style={{ background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[1140px]">
        <SectionHead eyebrow={T(A.eyebrow)} title={T(A.title)} accent={T(A.accent)} sub={T(A.sub)} />
        <div className="mt-14 grid items-center gap-12 lg:grid-cols-2">
          <Up><RevealImage src={IMG.ai} alt={lang === "de" ? "Deutsch online lernen mit KI" : lang === "fr" ? "Apprendre l'allemand en ligne avec l'IA" : "Learning German online with AI"} className="aspect-[4/3] rounded-[24px]" /></Up>
          <Up delay={0.1}>
            <div className="space-y-7">
              {points.map(([h, b]) => (
                <div key={T(h)} className="flex gap-4">
                  <span className="mt-1 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}><Check size={14} /></span>
                  <div>
                    <h3 style={{ fontFamily: "var(--font-sans)", fontSize: "1.15rem", fontWeight: 600, lineHeight: 1.25, color: "var(--w)" }}>{T(h)}</h3>
                    <p className="mt-1.5" style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(b)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Up>
        </div>
      </div>
    </section>
  );
}

export default function V2Home() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  return (
    <>
      <HomeHero />
      <Marquee items={["Meetings", "Kundengespräch", "Vorstellungsgespräch", "Verhandlung", "Telefonate", "Präsentation", "Karriere", "Online"]} />
      <OutcomesSticky />
      <CinematicStatement
        src={IMG.statement}
        alt={lang === "de" ? "Gespräch unter Kollegen auf Deutsch" : lang === "fr" ? "Échange entre collègues en allemand" : "Colleagues talking in German"}
        eyebrow={T(C.statement.eyebrow)}
        line1={T(C.statement.line1)}
        line2={T(C.statement.line2)}
        sub={T(C.statement.sub)}
      />
      <AISection />
      <HybridModel />
      <VorOrt />
      <Journey />
      <Trust />
      <FinalCTA />
    </>
  );
}
