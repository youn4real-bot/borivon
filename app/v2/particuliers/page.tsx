"use client";

/** /v2/particuliers — the individual (B2C) career story. Secondary audience. */
import { useLang } from "@/components/LangContext";
import { motion } from "motion/react";
import { COPY, type Tri } from "../_copy";
import { Up, stagger, item, TiltCard, GlowField, SectionHead, PrimaryCTA, CheckCard } from "../_components";

export default function ParticuliersPage() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const C = COPY.ind;
  const H = COPY.home;
  const points = [C.p1, C.p2, C.p3, C.p4];
  const steps = [["01", H.step1], ["02", H.step2], ["03", H.step3], ["04", H.step4]] as const;

  return (
    <>
      <GlowField className="px-[6vw] pt-[150px] pb-24 sm:pt-[180px] sm:pb-28" strong>
        <div className="mx-auto max-w-[940px] text-center">
          <Up>
            <span className="bv-eyebrow">{T(C.eyebrow)}</span>
            <h1 className="mx-auto mt-5 max-w-[16ch] font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.4rem, 6vw, 4.1rem)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--w)" }}>
              {T(C.title)} <span style={{ color: "var(--gold)" }}>{T(C.accent)}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[560px]" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(1.05rem, 1.6vw, 1.22rem)", lineHeight: 1.65, color: "var(--w2)" }}>{T(C.body)}</p>
            <div className="mt-9 flex justify-center"><PrimaryCTA href="/portal" big>{T(C.cta)}</PrimaryCTA></div>
          </Up>
        </div>
      </GlowField>

      <section className="px-[6vw] py-24 sm:py-28">
        <div className="mx-auto max-w-[820px]">
          <motion.ul className="grid gap-4 sm:grid-cols-2" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
            {points.map((p) => (<motion.li key={T(p)} variants={item}><CheckCard>{T(p)}</CheckCard></motion.li>))}
          </motion.ul>
        </div>
      </section>

      <section className="px-[6vw] py-24 sm:py-28" style={{ background: "var(--bg2)" }}>
        <div className="mx-auto max-w-[1080px]">
          <SectionHead eyebrow={T(H.journeyEyebrow)} title={T(H.journeyTitle)} accent={T(H.journeyAccent)} sub={T(H.journeySub)} />
          <motion.div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} style={{ transformStyle: "preserve-3d" }}>
            {steps.map(([n, t]) => (
              <motion.div key={n} variants={item}>
                <TiltCard className="rounded-2xl p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="grid h-12 w-12 place-items-center rounded-full text-[1.1rem] font-bold" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>{n}</div>
                  <h3 className="mt-5" style={{ fontFamily: "var(--font-sans)", fontSize: "1.16rem", fontWeight: 500, lineHeight: 1.3, color: "var(--w)" }}>{T(t)}</h3>
                </TiltCard>
              </motion.div>
            ))}
          </motion.div>
          <Up className="mt-14 flex justify-center"><PrimaryCTA href="/portal" big>{T(C.cta)}</PrimaryCTA></Up>
        </div>
      </section>
    </>
  );
}
