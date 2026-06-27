"use client";

/** /v2/solutions — enterprise deep-dive. Who it's for + measurable outcomes. */
import { useLang } from "@/components/LangContext";
import { motion } from "motion/react";
import { COPY, type Tri } from "../_copy";
import { Up, stagger, item, TiltCard, GlowField, SectionHead, PrimaryCTA, Check } from "../_components";

export default function SolutionsPage() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const C = COPY.solutions;
  const segs = [[C.seg1H, C.seg1B], [C.seg2H, C.seg2B], [C.seg3H, C.seg3B]] as const;
  const outs = [[C.out1H, C.out1B], [C.out2H, C.out2B], [C.out3H, C.out3B], [C.out4H, C.out4B]] as const;

  return (
    <>
      <GlowField className="px-[6vw] pt-[150px] pb-24 sm:pt-[180px] sm:pb-28" strong>
        <div className="mx-auto max-w-[940px] text-center">
          <Up>
            <span className="bv-eyebrow">{T(C.eyebrow)}</span>
            <h1 className="mx-auto mt-5 max-w-[18ch] font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.4rem, 6vw, 4.1rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--w)" }}>
              {T(C.title)} <span style={{ color: "var(--gold)" }}>{T(C.accent)}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[560px]" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.05rem, 1.6vw, 1.22rem)", lineHeight: 1.65, color: "var(--w2)" }}>{T(C.sub)}</p>
            <div className="mt-9 flex justify-center"><PrimaryCTA href="/v2/contact" big>{T(C.cta)}</PrimaryCTA></div>
          </Up>
        </div>
      </GlowField>

      <section className="px-[6vw] py-24 sm:py-28">
        <div className="mx-auto max-w-[1080px]">
          <SectionHead eyebrow={T(C.forEyebrow)} title={T(C.forTitle)} />
          <motion.div className="mt-14 grid gap-5 sm:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            {segs.map(([h, b]) => (
              <motion.div key={T(h)} variants={item}>
                <TiltCard className="h-full rounded-2xl p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <h3 style={{ fontFamily: "var(--font-sans)", fontSize: "1.18rem", fontWeight: 600, lineHeight: 1.25, color: "var(--w)" }}>{T(h)}</h3>
                  <p className="mt-3" style={{ fontFamily: "var(--font-sans)", fontSize: "0.97rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(b)}</p>
                </TiltCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Deep B2B needs */}
      <section className="px-[6vw] py-24 sm:py-28" style={{ background: "var(--bg2)" }}>
        <div className="mx-auto max-w-[1080px]">
          <SectionHead eyebrow={T(C.needsEyebrow)} title={T(C.needsTitle)} />
          <motion.div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            {([[C.need1H, C.need1B], [C.need2H, C.need2B], [C.need3H, C.need3B], [C.need4H, C.need4B], [C.need5H, C.need5B]] as const).map(([h, b]) => (
              <motion.div key={T(h)} variants={item}>
                <TiltCard className="h-full rounded-2xl p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <h3 style={{ fontFamily: "var(--font-sans)", fontSize: "1.1rem", fontWeight: 600, lineHeight: 1.3, color: "var(--w)" }}>{T(h)}</h3>
                  <p className="mt-2.5" style={{ fontFamily: "var(--font-sans)", fontSize: "0.95rem", lineHeight: 1.55, color: "var(--w2)" }}>{T(b)}</p>
                </TiltCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="px-[6vw] py-24 sm:py-28">
        <div className="mx-auto max-w-[1080px]">
          <SectionHead eyebrow={T(C.outEyebrow)} title={T(C.outTitle)} />
          <motion.div className="mt-14 grid gap-5 sm:grid-cols-2" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            {outs.map(([h, b]) => (
              <motion.div key={T(h)} variants={item}>
                <TiltCard className="flex h-full items-start gap-4 rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <span className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}><Check size={14} /></span>
                  <div>
                    <h3 style={{ fontFamily: "var(--font-sans)", fontSize: "1.08rem", fontWeight: 600, lineHeight: 1.3, color: "var(--w)" }}>{T(h)}</h3>
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
