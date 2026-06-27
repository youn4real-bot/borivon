"use client";

/**
 * /v2 — Home (ENTERPRISE ONLY). Professional German training for companies whose
 * teams work with German-speaking clients, partners and markets. Structure follows
 * the proven enterprise pattern (gofluent + peers): positioning -> trust strip ->
 * problem -> how it works -> outcomes -> statement -> AI -> proof stats -> on-site
 * -> credibility -> one repeated "book a needs audit" CTA. Trilingual; reduced-motion safe.
 */
import { Fragment, useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { useLang } from "@/components/LangContext";
import { COPY, type Tri } from "./_copy";
import {
  EASE, Up, stagger, item, TiltCard, GlowField, SectionHead,
  PrimaryCTA, GhostCTA, CheckCard, Check, RevealImage, CinematicStatement, CountUp, Marquee, RiseWords,
  GoldReveal, HorizontalPin, PanelPhoto,
} from "./_components";

const C = COPY;

// Professional, on-message photos (each one is paired with text + scroll motion).
const U = "https://images.unsplash.com/";
const IMG = {
  outcomes:  `${U}photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1100&q=72`, // team in a meeting, talking
  statement: `${U}photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1600&q=70`, // team talking in a meeting
  ai:        `${U}photo-1573164713988-8665fc963095?auto=format&fit=crop&w=1200&q=72`, // professional on a video call
};
// One scene per showcase panel (Meetings · Kundengespräch · Verhandlung · Präsentation · Vorstellungsgespräch).
const SHOWCASE_IMG = [
  `${U}photo-1543269865-cbf427effbad?auto=format&fit=crop&w=900&q=70`,   // team meeting
  `${U}photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=900&q=70`, // client conversation
  `${U}photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=900&q=70`,    // handshake / deal
  `${U}photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=900&q=70`, // presenting to a room
  `${U}photo-1552581234-26160f608093?auto=format&fit=crop&w=900&q=70`,    // one-on-one interview
];

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
  const wmY = useTransform(scrollY, [0, 600], [0, 90]);   // watermark counter-parallax
  const cueOp = useTransform(scrollY, [0, 120], [1, 0]);  // scroll cue fades on first scroll
  const chips = [T(C.home.chip1), T(C.home.chip2), T(C.home.chip3)];

  return (
    <GlowField className="px-[6vw] pt-[150px] pb-28 sm:pt-[185px] sm:pb-36" strong>
      {/* masked grid backdrop — quiet Linear/Vercel depth cue */}
      <div className="bv-hero-grid" />
      {/* giant watermark — slow counter-parallax for real depth */}
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden" style={reduce ? undefined : { y: wmY }}>
        <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 700, fontSize: "clamp(9rem, 34vw, 30rem)", lineHeight: 1, color: "var(--w)", opacity: 0.05, whiteSpace: "nowrap", userSelect: "none" }}>Borivon</span>
      </motion.div>

      <motion.div className="relative z-[1] mx-auto max-w-[1180px]" style={reduce ? undefined : { y: contentY, opacity: contentOp }}>
        <div className="max-w-[840px]">
          <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
            <span className="bv-eyebrow">{T(C.home.heroEyebrow)}</span>
          </motion.div>

          <h1 className="mt-6 max-w-[20ch] font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.5rem, 6.4vw, 5.2rem)", lineHeight: 1.02, letterSpacing: "-0.035em", color: "var(--w)" }}>
            {words.map((w, i) => (<MaskWord key={i} delay={0.15 + 0.07 * i}>{w}</MaskWord>))}
            <MaskWord delay={0.15 + 0.07 * words.length} accent>{T(C.home.heroAccent)}</MaskWord>
          </h1>

          <motion.p className="mt-7 bv-measure" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.15rem, 1.7vw, 1.42rem)", lineHeight: 1.6, color: "var(--w2)" }}
            initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.6 }}>
            {T(C.home.heroSub)}
          </motion.p>

          <motion.div className="mt-11 flex flex-wrap items-center gap-4" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.75 }}>
            <PrimaryCTA href="/v2/contact" big>{T(C.home.heroCta1)}</PrimaryCTA>
            <GhostCTA href="/v2/methode" big>{T(C.home.heroCta2)}</GhostCTA>
          </motion.div>

          {/* credential rail — top hairline + thin dividers between chips */}
          <motion.div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-3 pt-7" style={{ borderTop: "1px solid var(--border)" }} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: EASE, delay: 0.95 }}>
            {chips.map((t, i) => (
              <Fragment key={t}>
                {i > 0 && <span aria-hidden style={{ width: 1, height: 12, background: "var(--border2)" }} />}
                <span className="bv-small" style={{ fontSize: "0.82rem", letterSpacing: "0.01em", color: "var(--w3)" }}>{t}</span>
              </Fragment>
            ))}
          </motion.div>
        </div>
      </motion.div>

      {/* scroll cue — gold dot travels down a thin rail, fades on first scroll */}
      <motion.div aria-hidden className="pointer-events-none absolute bottom-7 left-1/2 hidden -translate-x-1/2 sm:block" style={{ opacity: reduce ? 0.5 : cueOp }}>
        <div className="h-10 w-[1.5px] overflow-hidden" style={{ background: "var(--border2)" }}>
          <motion.div className="h-3 w-full" style={{ background: "var(--gold)" }} animate={reduce ? undefined : { y: ["-100%", "330%"] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
        </div>
      </motion.div>
    </GlowField>
  );
}

// Thin credibility band right under the hero (enterprise trust strip).
function TrustStrip() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  return (
    <section className="px-[6vw] py-6" style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
      <Up className="mx-auto max-w-[1000px] text-center">
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(0.95rem, 1.4vw, 1.08rem)", lineHeight: 1.5, color: "var(--w2)" }}>{T(C.home.trustStrip)}</p>
      </Up>
    </section>
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
        <SectionHead index="01" eyebrow={T(C.home.problemEyebrow)} title={T(C.home.problemTitle)} accent={T(C.home.problemAccent)} sub={T(C.home.problemSub)} />
        <motion.div className="mt-14 grid gap-5 sm:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
          {cards.map(([t, d]) => (
            <motion.div key={T(t)} variants={item}>
              <TiltCard className="h-full rounded-2xl p-7 bv-surface">
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

// How it works — 4 program steps with a scroll-drawn connector line.
function Journey() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.5"] });
  const lineSXraw = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const lineSX = useSpring(lineSXraw, { stiffness: 120, damping: 30, restDelta: 0.001 });
  const steps = [["01", C.home.step1, C.home.step1B], ["02", C.home.step2, C.home.step2B], ["03", C.home.step3, C.home.step3B], ["04", C.home.step4, C.home.step4B]] as const;
  return (
    <section className="px-[6vw] py-24 sm:py-32" style={{ background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[1140px]">
        <SectionHead index="02" eyebrow={T(C.home.journeyEyebrow)} title={T(C.home.journeyTitle)} accent={T(C.home.journeyAccent)} sub={T(C.home.journeySub)} />
        <div ref={ref} className="relative mt-16">
          <div className="absolute left-0 right-0 top-[34px] hidden h-[2px] lg:block" style={{ background: "var(--border)" }}>
            <motion.div className="h-full w-full" style={{ scaleX: lineSX, transformOrigin: "0% 50%", background: "var(--gold-gradient)" }} />
          </div>
          <motion.div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            {steps.map(([n, t, b]) => (
              <motion.div key={n} variants={item}>
                <TiltCard className="h-full rounded-2xl p-7 bv-surface">
                  <div className="grid h-12 w-12 place-items-center rounded-full text-[1.1rem] font-bold" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>{n}</div>
                  <h3 className="mt-5" style={{ fontFamily: "var(--font-sans)", fontSize: "1.16rem", fontWeight: 600, lineHeight: 1.3, color: "var(--w)" }}>{T(t)}</h3>
                  <p className="mt-2.5" style={{ fontFamily: "var(--font-sans)", fontSize: "0.95rem", lineHeight: 1.55, color: "var(--w2)" }}>{T(b)}</p>
                </TiltCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// Outcomes — a meeting photo PINS on scroll while the four outcome points reveal.
function OutcomesSticky() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const E = C.ent;
  const points = [E.p1, E.p2, E.p3, E.p4];
  return (
    <section id="outcomes" className="px-[6vw] py-24 sm:py-32">
      <div className="mx-auto grid max-w-[1140px] items-start gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="lg:sticky lg:top-[92px] lg:self-start">
          <RevealImage src={IMG.outcomes} alt={lang === "de" ? "Meeting auf Deutsch" : lang === "fr" ? "Réunion en allemand" : "Meeting in German"} className="aspect-[4/5] rounded-[26px] sm:aspect-[16/10] lg:aspect-[4/5]" />
        </div>
        <div>
          <Up>
            <span className="bv-eyebrow">{T(E.eyebrow)}</span>
            <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2rem, 4.4vw, 3.2rem)", lineHeight: 1.07, letterSpacing: "-0.027em", color: "var(--w)" }}>
              {T(E.title)} <span style={{ color: "var(--gold)" }}>{T(E.accent)}</span>
            </h2>
            <p className="mt-6 max-w-[460px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.08rem", lineHeight: 1.7, color: "var(--w2)" }}>{T(E.body)}</p>
          </Up>
          <motion.ul className="mt-10 space-y-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            {points.map((p) => (<motion.li key={T(p)} variants={item}><CheckCard>{T(p)}</CheckCard></motion.li>))}
          </motion.ul>
          <Up delay={0.1} className="mt-9"><PrimaryCTA href="/v2/contact">{T(E.cta)}</PrimaryCTA></Up>
        </div>
      </div>
    </section>
  );
}

// AI — we teach WITH AI + teach teams to USE AI to learn faster.
function AISection() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const A = C.ai;
  const points = [[A.c1H, A.c1B], [A.c2H, A.c2B], [A.c3H, A.c3B]] as const;
  return (
    <section className="px-[6vw] py-24 sm:py-32" style={{ background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[1140px]">
        <SectionHead index="03" eyebrow={T(A.eyebrow)} title={T(A.title)} accent={T(A.accent)} sub={T(A.sub)} />
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

// Proof stats — three honest numbers that count up on scroll.
function StatsBand() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const A = C.about;
  const stats = [[A.stat1N, A.stat1L], [A.stat2N, A.stat2L], [A.stat3N, A.stat3L], [A.stat4N, A.stat4L]] as const;
  return (
    <section className="px-[6vw] py-16 sm:py-20" style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
      <Up className="mb-10 text-center"><span className="bv-eyebrow">{T(A.statsEyebrow)}</span></Up>
      <motion.div className="mx-auto grid max-w-[1000px] gap-10 text-center sm:grid-cols-2 lg:grid-cols-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
        {stats.map(([n, l]) => (
          <motion.div key={T(n)} variants={item}>
            <div className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.6rem, 6vw, 4rem)", letterSpacing: "-0.04em", lineHeight: 1, color: "var(--gold)" }}><CountUp value={T(n)} /></div>
            <div className="mt-2.5" style={{ fontFamily: "var(--font-sans)", fontSize: "0.95rem", color: "var(--w2)" }}>{T(l)}</div>
          </motion.div>
        ))}
      </motion.div>
      <Up delay={0.1} className="mt-9 text-center"><p className="bv-small" style={{ fontSize: "0.85rem", color: "var(--w3)" }}>{T(A.statsNote)}</p></Up>
    </section>
  );
}

// On-site (Vor Ort) — online by default, on-site on request.
function VorOrt() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const V = C.vorort;
  return (
    <section className="px-[6vw] py-20" style={{ background: "var(--bg2)" }}>
      <Up className="mx-auto max-w-[760px] text-center">
        <span className="bv-eyebrow">{T(V.eyebrow)}</span>
        <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.7rem, 4vw, 2.6rem)", lineHeight: 1.12, letterSpacing: "-0.025em", color: "var(--w)" }}>{T(V.title)}</h2>
        <p className="mx-auto mt-5 max-w-[560px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", lineHeight: 1.65, color: "var(--w2)" }}>{T(V.body)}</p>
        <div className="mt-8 flex justify-center"><PrimaryCTA href="/v2/contact" big>{T(V.cta)}</PrimaryCTA></div>
      </Up>
    </section>
  );
}

function Trust() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const items = [[C.home.trustA_h, C.home.trustA_b], [C.home.trustB_h, C.home.trustB_b], [C.home.trustC_h, C.home.trustC_b], [C.home.trustD_h, C.home.trustD_b]] as const;
  return (
    <section className="px-[6vw] py-24 sm:py-28">
      <Up className="mx-auto mb-12 max-w-[1000px] text-center"><span className="bv-eyebrow">{T(C.home.trustEyebrow)}</span></Up>
      <motion.div className="mx-auto grid max-w-[1080px] gap-8 sm:grid-cols-2 lg:grid-cols-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-70px" }}>
        {items.map(([t, d]) => (
          <motion.div key={T(t)} variants={item}>
            <div className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "1.18rem", letterSpacing: "-0.02em", color: "var(--gold)" }}>{T(t)}</div>
            <p className="mt-2.5" style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(d)}</p>
          </motion.div>
        ))}
      </motion.div>
      <Up delay={0.1} className="mt-10 text-center"><p className="bv-small" style={{ fontSize: "0.85rem", color: "var(--w3)" }}>{T(C.home.trustSince)}</p></Up>
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
          animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} />
      )}
      <Up className="relative mx-auto max-w-[820px]">
        <h2 className="mx-auto font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.3rem, 5.5vw, 4rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--w)" }}>
          <RiseWords text={T(C.home.finalTitle)} />{" "}
          <RiseWords text={T(C.home.finalAccent)} accent delay={0.12} />
        </h2>
        <p className="mx-auto mt-6 max-w-[540px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.1rem", lineHeight: 1.65, color: "var(--w2)" }}>{T(C.home.finalSub)}</p>
        <div className="mt-10 flex justify-center">
          <PrimaryCTA href="/v2/contact" big>{T(C.home.finalCta)}</PrimaryCTA>
        </div>
      </Up>
    </section>
  );
}

// Scrollytelling manifesto — words sweep muted → gold as you scroll through.
function Manifesto() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  return (
    <section className="px-[6vw] py-28 sm:py-36">
      <div className="mx-auto max-w-[1000px]">
        <GoldReveal text={T(C.home.manifesto)} className="text-center font-medium tracking-tight text-[clamp(1.5rem,3.4vw,2.6rem)] leading-[1.4]" />
      </div>
    </section>
  );
}

// Horizontal pinned showcase — the work situations where teams will speak German.
function Showcase() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const S = C.showcase;
  const panels = [
    [S.p1Tag, S.p1H], [S.p2Tag, S.p2H], [S.p3Tag, S.p3H], [S.p4Tag, S.p4H], [S.p5Tag, S.p5H],
  ] as const;
  return (
    <section className="py-16 sm:py-24" style={{ background: "var(--bg2)" }}>
      <div className="px-[6vw]">
        <SectionHead eyebrow={T(S.eyebrow)} title={T(S.title)} accent={T(S.accent)} center={false} />
      </div>
      <div className="mt-12">
        <HorizontalPin heightVh={300}>
          {panels.map(([tag, h], i) => (
            <article key={tag} className="w-[78vw] shrink-0 sm:w-[58vw] md:w-[44vw] lg:w-[34vw]" style={{ scrollSnapAlign: "center" }}>
              <div className="bv-surface relative flex h-[clamp(340px,60vh,540px)] flex-col justify-end overflow-hidden rounded-[28px] p-9">
                <PanelPhoto src={SHOWCASE_IMG[i]} alt={tag} />
                <div className="relative z-[1]">
                  <span className="block" style={{ fontFamily: "var(--font-sans)", fontVariantNumeric: "tabular-nums", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.08em", color: "var(--gold)" }}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="mt-3 block font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.9rem, 3vw, 2.9rem)", lineHeight: 1.04, letterSpacing: "-0.03em", color: "#fff" }}>{tag}</span>
                  <span className="mt-3 block" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", lineHeight: 1.5, color: "rgba(255,255,255,0.85)" }}>{T(h)}</span>
                </div>
              </div>
            </article>
          ))}
        </HorizontalPin>
      </div>
    </section>
  );
}

// Method-as-proof: the usual course vs the Borivon method (positioning, no fake metrics).
function MethodContrast() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const X = C.contrast;
  const olds = [X.old1, X.old2, X.old3, X.old4, X.old5];
  const news = [X.new1, X.new2, X.new3, X.new4, X.new5];
  return (
    <section className="px-[6vw] py-24 sm:py-28">
      <div className="mx-auto max-w-[1080px]">
        <SectionHead eyebrow={T(X.eyebrow)} title={T(X.title)} accent={T(X.accent)} />
        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[22px] p-8" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
            <div className="bv-eyebrow" style={{ color: "var(--w3)" }}>{T(X.oldH)}</div>
            <ul className="mt-6 space-y-4">
              {olds.map((o) => (
                <li key={T(o)} className="flex items-start gap-3">
                  <span className="mt-1.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full" style={{ border: "1px solid var(--border2)" }}><span style={{ width: 8, height: 1.5, background: "var(--w3)", display: "block" }} /></span>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.5, color: "var(--w3)" }}>{T(o)}</span>
                </li>
              ))}
            </ul>
          </div>
          <TiltCard className="rounded-[22px] p-8 bv-surface" style={{ borderColor: "var(--border-gold)" }}>
            <div className="bv-eyebrow" style={{ color: "var(--gold)" }}>{T(X.newH)}</div>
            <ul className="mt-6 space-y-4">
              {news.map((n) => (
                <li key={T(n)} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}><Check size={13} /></span>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.5, color: "var(--w)" }}>{T(n)}</span>
                </li>
              ))}
            </ul>
          </TiltCard>
        </div>
      </div>
    </section>
  );
}

// Commitment / honest risk-reversal (free audit, 1-day proposal, one partner, visibility).
function Commitment() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const M = C.commit;
  const items = [M.c1, M.c2, M.c3, M.c4];
  return (
    <section className="px-[6vw] py-24 sm:py-28" style={{ background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[760px]">
        <div className="bv-surface rounded-[26px] p-8 sm:p-12">
          <Up className="text-center">
            <span className="bv-eyebrow">{T(M.eyebrow)}</span>
            <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.7rem, 3.6vw, 2.5rem)", lineHeight: 1.12, letterSpacing: "-0.025em", color: "var(--w)" }}>{T(M.title)} <span style={{ color: "var(--gold)" }}>{T(M.accent)}</span></h2>
            <p className="mx-auto mt-5 max-w-[520px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(M.sub)}</p>
          </Up>
          <motion.ul className="mx-auto mt-9 grid max-w-[600px] gap-3 sm:grid-cols-2" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            {items.map((c) => (
              <motion.li key={T(c)} variants={item} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}><Check size={13} /></span>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.45, color: "var(--w)" }}>{T(c)}</span>
              </motion.li>
            ))}
          </motion.ul>
          <Up delay={0.1} className="mt-9 flex justify-center"><PrimaryCTA href="/v2/contact" big>{T(M.cta)}</PrimaryCTA></Up>
        </div>
      </div>
    </section>
  );
}

// Procurement FAQ — native <details> (no JS, accessible, reduced-motion safe).
function FAQ() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const F = C.faq;
  const qa = [[F.q1, F.a1], [F.q2, F.a2], [F.q3, F.a3], [F.q4, F.a4], [F.q5, F.a5]] as const;
  return (
    <section className="px-[6vw] py-24 sm:py-28">
      <div className="mx-auto max-w-[820px]">
        <SectionHead eyebrow={T(F.eyebrow)} title={T(F.title)} />
        <div className="mt-12 space-y-3">
          {qa.map(([q, a]) => (
            <details key={T(q)} className="bv-surface rounded-[16px] px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", fontWeight: 600, color: "var(--w)" }}>
                {T(q)}
                <span aria-hidden className="bv-faq-mark" style={{ color: "var(--gold)", fontSize: "1.5rem", lineHeight: 1 }}>+</span>
              </summary>
              <p className="mt-3" style={{ fontFamily: "var(--font-sans)", fontSize: "0.98rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(a)}</p>
            </details>
          ))}
        </div>
        <Up delay={0.1} className="mt-10 flex justify-center"><GhostCTA href="/v2/contact">{T(F.cta)}</GhostCTA></Up>
      </div>
    </section>
  );
}

// Client logo wall — GATED: renders only when real, consented logos exist.
function LogoWall() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  if (!C.logos.items.length) return null;
  return (
    <section className="px-[6vw] py-16" style={{ background: "var(--bg2)" }}>
      <Up className="mb-9 text-center"><span className="bv-eyebrow">{T(C.logos.eyebrow)}</span></Up>
      <div className="mx-auto flex max-w-[1000px] flex-wrap items-center justify-center gap-x-12 gap-y-8">
        {C.logos.items.map((l) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={l.name} src={l.src} alt={l.name} loading="lazy" decoding="async" className="h-8 w-auto opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0" />
        ))}
      </div>
    </section>
  );
}

// Named testimonials — GATED: renders only when real, consented quotes exist.
function Testimonials() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  if (!C.testimonials.items.length) return null;
  return (
    <section className="px-[6vw] py-24 sm:py-28">
      <div className="mx-auto max-w-[1080px]">
        <SectionHead eyebrow={T(C.testimonials.eyebrow)} title={T(C.testimonials.title)} />
        <motion.div className="mt-14 grid gap-6 md:grid-cols-2" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
          {C.testimonials.items.map((t, i) => (
            <motion.div key={i} variants={item}>
              <TiltCard className="h-full rounded-[22px] p-8 bv-surface">
                <div aria-hidden style={{ color: "var(--gold)", letterSpacing: "0.14em", fontSize: "0.95rem" }}>{"★".repeat(t.rating ?? 5)}</div>
                <p className="mt-4" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "1.18rem", lineHeight: 1.5, color: "var(--w)" }}>&ldquo;{T(t.quote)}&rdquo;</p>
                <div className="mt-5" style={{ fontFamily: "var(--font-sans)", fontSize: "0.9rem", color: "var(--w3)" }}>{t.name} · {T(t.role)} · {t.company}</div>
              </TiltCard>
            </motion.div>
          ))}
        </motion.div>
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
      <TrustStrip />
      <Marquee items={["Meetings", "Kundengespräch", "Verhandlung", "Vertrieb", "Telefonate", "Präsentation", "Verträge", "Kundenbetreuung"]} duration={34} />
      <StatsBand />
      <Problem />
      <Manifesto />
      <MethodContrast />
      <Journey />
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
      <Showcase />
      <LogoWall />
      <Testimonials />
      <VorOrt />
      <Commitment />
      <Trust />
      <FAQ />
      <FinalCTA />
    </>
  );
}
