"use client";

/** /v2/methode — the hybrid model (En ligne · Vor Ort · Hybride) + principles. */
import { useLang } from "@/components/LangContext";
import { motion } from "motion/react";
import { COPY, type Tri } from "../_copy";
import { Up, stagger, item, TiltCard, GlowField, SectionHead, PrimaryCTA } from "../_components";

export default function MethodePage() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const C = COPY.methode;
  const H = COPY.home;
  const modes = [
    { tag: H.modeOnlineTag, h: H.modeOnlineH, b: H.modeOnlineB, featured: false },
    { tag: H.modeHybridTag, h: H.modeHybridH, b: H.modeHybridB, featured: true },
    { tag: H.modeVorOrtTag, h: H.modeVorOrtH, b: H.modeVorOrtB, featured: false },
  ];
  const principles = [[C.pr1H, C.pr1B], [C.pr2H, C.pr2B], [C.pr3H, C.pr3B], [C.pr4H, C.pr4B]] as const;

  return (
    <>
      <GlowField className="px-[6vw] pt-[150px] pb-24 sm:pt-[180px] sm:pb-28" strong>
        <div className="mx-auto max-w-[940px] text-center">
          <Up>
            <span className="bv-eyebrow">{T(C.eyebrow)}</span>
            <h1 className="mx-auto mt-5 max-w-[16ch] font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.4rem, 6vw, 4.1rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--w)" }}>
              {T(C.title)} <span style={{ color: "var(--gold)" }}>{T(C.accent)}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[560px]" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.05rem, 1.6vw, 1.22rem)", lineHeight: 1.65, color: "var(--w2)" }}>{T(C.sub)}</p>
            <div className="mt-9 flex justify-center"><PrimaryCTA href="/v2/contact" big>{T(C.cta)}</PrimaryCTA></div>
          </Up>
        </div>
      </GlowField>

      {/* The three modes */}
      <section className="px-[6vw] py-24 sm:py-28">
        <div className="mx-auto max-w-[1140px]">
          <SectionHead eyebrow={T(H.modelEyebrow)} title={T(H.modelTitle)} accent={T(H.modelAccent)} sub={T(H.modelSub)} />
          <motion.div className="mt-16 grid gap-6 lg:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
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
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w3)" }}>{T(H.modelGloss)}</p>
          </Up>
        </div>
      </section>

      {/* Principles */}
      <section className="px-[6vw] py-24 sm:py-28" style={{ background: "var(--bg2)" }}>
        <div className="mx-auto max-w-[1080px]">
          <SectionHead eyebrow={T(C.pEyebrow)} title={T(C.pTitle)} />
          <motion.div className="mt-14 grid gap-5 sm:grid-cols-2" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            {principles.map(([h, b], i) => (
              <motion.div key={T(h)} variants={item}>
                <TiltCard className="flex h-full items-start gap-4 rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <span className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-[13px] font-bold" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 style={{ fontFamily: "var(--font-sans)", fontSize: "1.1rem", fontWeight: 600, lineHeight: 1.3, color: "var(--w)" }}>{T(h)}</h3>
                    <p className="mt-1.5" style={{ fontFamily: "var(--font-sans)", fontSize: "0.95rem", lineHeight: 1.55, color: "var(--w2)" }}>{T(b)}</p>
                  </div>
                </TiltCard>
              </motion.div>
            ))}
          </motion.div>
          <Up className="mt-14 flex justify-center"><PrimaryCTA href="/v2/contact" big>{T(C.cta)}</PrimaryCTA></Up>
        </div>
      </section>
    </>
  );
}
