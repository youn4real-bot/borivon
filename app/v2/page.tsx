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
  EASE, Up, stagger, item, Magnetic, TiltCard, GlowField, SectionHead,
  PrimaryCTA, GhostCTA, CheckCard,
} from "./_components";

const C = COPY;

function HomeHero() {
  const { lang } = useLang();
  const reduce = useReducedMotion();
  const T = (t: Tri) => t[lang];
  const words = T(C.home.heroTitle).split(" ");
  return (
    <GlowField className="px-[6vw] pt-[150px] pb-28 sm:pt-[180px] sm:pb-36" strong>
      <div className="mx-auto max-w-[1080px] text-center">
        <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
          <span className="bv-eyebrow">{T(C.home.heroEyebrow)}</span>
        </motion.div>

        <h1 className="mx-auto mt-7 max-w-[15ch] font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.7rem, 7.2vw, 5.7rem)", lineHeight: 1.02, letterSpacing: "-0.03em", color: "var(--w)" }}>
          {words.map((w, i) => (
            <motion.span key={i} className="inline-block" style={{ marginRight: "0.24em" }}
              initial={reduce ? false : { opacity: 0, y: 24, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.06 * i }}>
              {w}
            </motion.span>
          ))}
          <motion.span className="inline-block" style={{ color: "var(--gold)" }}
            initial={reduce ? false : { opacity: 0, y: 24, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.06 * words.length }}>
            {T(C.home.heroAccent)}
          </motion.span>
        </h1>

        <motion.p className="mx-auto mt-7 max-w-[600px]" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.05rem, 1.6vw, 1.28rem)", lineHeight: 1.65, color: "var(--w2)" }}
          initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.5 }}>
          {T(C.home.heroSub)}
        </motion.p>

        <motion.div className="mt-11 flex flex-wrap items-center justify-center gap-4" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.6 }}>
          <PrimaryCTA href="/v2/contact" big>{T(C.home.heroCta1)}</PrimaryCTA>
          <GhostCTA href="/v2/methode" big>{T(C.home.heroCta2)}</GhostCTA>
        </motion.div>

        <motion.div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: EASE, delay: 0.8 }}>
          {[T(C.home.chip1), T(C.home.chip2), T(C.home.chip3)].map((t) => (
            <span key={t} className="bv-small" style={{ fontSize: "0.82rem", color: "var(--w3)" }}>{t}</span>
          ))}
        </motion.div>
      </div>
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
        <motion.div className="mt-16 grid gap-6 lg:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
          {modes.map((m) => (
            <motion.div key={T(m.tag)} variants={item} className={m.featured ? "lg:-mt-4 lg:mb-4" : ""}>
              <TiltCard className="flex h-full flex-col rounded-[22px] p-8" style={{ background: m.featured ? "var(--gdim)" : "var(--card)", border: `1px solid ${m.featured ? "var(--border-gold)" : "var(--border)"}`, boxShadow: m.featured ? "var(--shadow-gold-sm)" : "none" }}>
                <span className="inline-flex w-fit items-center rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: m.featured ? "var(--gold)" : "var(--gdim)", color: m.featured ? "#131312" : "var(--gold)", border: m.featured ? "none" : "1px solid var(--border-gold)", letterSpacing: "-0.01em" }}>{T(m.tag)}</span>
                <h3 className="mt-5 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "1.5rem", lineHeight: 1.2, letterSpacing: "-0.02em", color: "var(--w)" }}>{T(m.h)}</h3>
                <p className="mt-3" style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.62, color: "var(--w2)" }}>{T(m.b)}</p>
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
        <SectionHead eyebrow={T(C.home.journeyEyebrow)} title={T(C.home.journeyTitle)} accent={T(C.home.journeyAccent)} sub={T(C.home.journeySub)} />
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
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <PrimaryCTA href="/v2/contact" big>{T(C.home.heroCta1)}</PrimaryCTA>
          <GhostCTA href="/v2/methode" big>{T(C.home.heroCta2)}</GhostCTA>
        </div>
      </Up>
    </section>
  );
}

// Two-paths bridge — the merged front sends each party to its deep page.
function Paths() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const P = C.paths;
  const cards = [
    { h: P.entH, b: P.entB, href: "/v2/solutions" },
    { h: P.indH, b: P.indB, href: "/v2/particuliers" },
  ];
  return (
    <section className="px-[6vw] py-24 sm:py-32">
      <div className="mx-auto max-w-[1080px]">
        <SectionHead eyebrow={T(P.eyebrow)} title={T(P.title)} accent={T(P.accent)} sub={T(P.sub)} />
        <motion.div className="mt-14 grid gap-6 sm:grid-cols-2" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
          {cards.map((c) => (
            <motion.div key={T(c.h)} variants={item}>
              <Link href={c.href} className="block h-full">
                <TiltCard className="flex h-full flex-col rounded-[22px] p-8" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <h3 className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "1.55rem", letterSpacing: "-0.02em", color: "var(--w)" }}>{T(c.h)}</h3>
                  <p className="mt-3 flex-1" style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(c.b)}</p>
                  <span className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-semibold" style={{ color: "var(--gold)" }}>{T(P.more)} <span aria-hidden>→</span></span>
                </TiltCard>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

export default function V2Home() {
  return (
    <>
      <HomeHero />
      <Problem />
      <HybridModel />
      <Paths />
      <Journey />
      <Trust />
      <FinalCTA />
    </>
  );
}
