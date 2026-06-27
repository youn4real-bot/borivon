"use client";

/** /v2/a-propos — about: mission, story, values. */
import { useLang } from "@/components/LangContext";
import { motion } from "motion/react";
import { COPY, type Tri } from "../_copy";
import { Up, stagger, item, TiltCard, GlowField, SectionHead, PrimaryCTA, CountUp } from "../_components";

export default function AboutPage() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const C = COPY.about;
  const values = [[C.v1H, C.v1B], [C.v2H, C.v2B], [C.v3H, C.v3B]] as const;

  return (
    <>
      <GlowField className="px-[6vw] pt-[150px] pb-24 sm:pt-[180px] sm:pb-28" strong>
        <div className="mx-auto max-w-[940px] text-center">
          <Up>
            <span className="bv-eyebrow">{T(C.eyebrow)}</span>
            <h1 className="mx-auto mt-5 max-w-[18ch] font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.4rem, 6vw, 4.1rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--w)" }}>
              {T(C.title)} <span style={{ color: "var(--gold)" }}>{T(C.accent)}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[600px]" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.05rem, 1.6vw, 1.22rem)", lineHeight: 1.65, color: "var(--w2)" }}>{T(C.sub)}</p>
          </Up>
        </div>
      </GlowField>

      {/* Social proof — honest, founder-supplied numbers */}
      <section className="px-[6vw] py-16 sm:py-20" style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <motion.div className="mx-auto grid max-w-[900px] gap-10 text-center sm:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
          {([[C.stat1N, C.stat1L], [C.stat2N, C.stat2L], [C.stat3N, C.stat3L]] as const).map(([n, l]) => (
            <motion.div key={T(n)} variants={item}>
              <div className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.6rem, 6vw, 4rem)", letterSpacing: "-0.04em", lineHeight: 1, color: "var(--gold)" }}><CountUp value={T(n)} /></div>
              <div className="mt-2.5" style={{ fontFamily: "var(--font-sans)", fontSize: "0.95rem", color: "var(--w2)" }}>{T(l)}</div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section className="px-[6vw] py-24 sm:py-28">
        <div className="mx-auto grid max-w-[1000px] items-start gap-12 lg:grid-cols-2">
          <Up>
            <span className="bv-eyebrow">{T(C.storyEyebrow)}</span>
            <h2 className="mt-4 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.9rem, 3.8vw, 2.7rem)", lineHeight: 1.12, letterSpacing: "-0.025em", color: "var(--w)" }}>{T(C.storyTitle)}</h2>
          </Up>
          <Up delay={0.1}>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "1.08rem", lineHeight: 1.75, color: "var(--w2)" }}>{T(C.storyP1)}</p>
            <p className="mt-5" style={{ fontFamily: "var(--font-sans)", fontSize: "1.08rem", lineHeight: 1.75, color: "var(--w2)" }}>{T(C.storyP2)}</p>
          </Up>
        </div>
      </section>

      <section className="px-[6vw] py-24 sm:py-28" style={{ background: "var(--bg2)" }}>
        <div className="mx-auto max-w-[1080px]">
          <motion.div className="grid gap-5 sm:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            {values.map(([h, b]) => (
              <motion.div key={T(h)} variants={item}>
                <TiltCard className="h-full rounded-2xl p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <h3 className="font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "1.2rem", letterSpacing: "-0.02em", color: "var(--gold)" }}>{T(h)}</h3>
                  <p className="mt-3" style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(b)}</p>
                </TiltCard>
              </motion.div>
            ))}
          </motion.div>
          <Up className="mt-14 flex justify-center"><PrimaryCTA href="/v2/contact" big>{T(COPY.nav.contact)}</PrimaryCTA></Up>
        </div>
      </section>
    </>
  );
}
