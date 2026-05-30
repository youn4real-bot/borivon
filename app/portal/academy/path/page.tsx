"use client";

/**
 * ACADEMY — Level path (the north-star map). LIVE.
 *
 * Everything else (streak, points, homework) is the daily pull; THIS screen is
 * the "why" — a single climb A1 → A2 → B1 → B2 where B2 is drawn as the prize
 * because B2 = job-ready (employers can hire). Reads the candidate's REAL
 * current level from /api/portal/academy/me. Trilingual per LAW #19.
 */
import { useEffect, useState } from "react";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { PageLoader } from "@/components/ui/states";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, Lock, Crown } from "lucide-react";

const ALL = ["A1", "A2", "B1", "B2"];

export default function AcademyPathPage() {
  const { lang } = useLang();
  const router = useRouter();

  const TT = {
    en: {
      path: "Your path", goal: "Goal", here: "You are here",
      done: "Done", locked: "Locked", jobReady: "Job-ready", percent: "complete",
      reach: "Reach B2 → employers can hire you",
      sub: { A1: "Beginner", A2: "Elementary", B1: "Intermediate", B2: "Work level" } as Record<string, string>,
    },
    fr: {
      path: "Ton parcours", goal: "Objectif", here: "Tu es ici",
      done: "Fait", locked: "Verrouillé", jobReady: "Prêt à travailler", percent: "terminé",
      reach: "Atteins le B2 → les employeurs peuvent t'embaucher",
      sub: { A1: "Débutant", A2: "Élémentaire", B1: "Intermédiaire", B2: "Niveau travail" } as Record<string, string>,
    },
    de: {
      path: "Dein Weg", goal: "Ziel", here: "Du bist hier",
      done: "Fertig", locked: "Gesperrt", jobReady: "Arbeitsbereit", percent: "geschafft",
      reach: "Erreiche B2 → Arbeitgeber können dich einstellen",
      sub: { A1: "Anfänger", A2: "Grundstufe", B1: "Mittelstufe", B2: "Arbeitsniveau" } as Record<string, string>,
    },
  };
  const L = TT[lang] ?? TT.en;

  const [level, setLevel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      const r = await fetch("/api/portal/academy/me", { headers: { Authorization: `Bearer ${tk}` } });
      const j = await r.json().catch(() => null);
      setLevel(typeof j?.level === "string" ? j.level : "A1");
      setLoading(false);
    });
  }, [router]);

  // Top → bottom = goal first (the climb). Derive each node from the real level.
  type State = "goal" | "locked" | "current" | "done";
  const curIdx = ALL.indexOf(level ?? "A1");
  const LEVELS: { key: string; state: State; pct?: number }[] = ["B2", "B1", "A2", "A1"].map(key => {
    const idx = ALL.indexOf(key);
    let state: State;
    if (key === "B2") state = curIdx >= 3 ? "done" : "goal";
    else if (idx < curIdx) state = "done";
    else if (idx === curIdx) state = "current";
    else state = "locked";
    return { key, state };
  });

  if (loading) return <PageLoader />;

  const node = (state: State) => {
    const base: React.CSSProperties = {
      width: 64, height: 64, borderRadius: 99, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 24, fontWeight: 800,
    };
    if (state === "goal")    return { ...base, background: "var(--gold)", color: "#131312", boxShadow: "0 0 0 5px var(--gdim)" };
    if (state === "current") return { ...base, background: "var(--gdim)", color: "var(--gold)", border: "3px solid var(--gold)" };
    if (state === "done")    return { ...base, background: "rgba(22,163,74,0.15)", color: "#16a34a", border: "2px solid rgba(22,163,74,0.5)" };
    return { ...base, background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)", opacity: 0.6 }; // locked
  };

  return (
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="max-w-[460px] mx-auto px-4 pt-5 pb-28">

        {/* back + title */}
        <div className="flex items-center gap-2 mb-1">
          <button onClick={() => router.push("/portal/academy")}
            className="flex items-center justify-center rounded-full"
            style={{ width: 34, height: 34, background: "var(--bg2)", border: "1px solid var(--border)", cursor: "pointer", flexShrink: 0 }}
            aria-label={L.path}>
            <ChevronLeft size={20} strokeWidth={2.2} style={{ color: "var(--w2)" }} />
          </button>
          <span className="text-[20px] font-extrabold" style={{ color: "var(--w)" }}>{L.path}</span>
        </div>

        {/* the climb */}
        <div className="mt-5">
          {LEVELS.map((lv, i) => {
            const last = i === LEVELS.length - 1;
            return (
              <div key={lv.key} className="flex gap-4">
                {/* node + connector rail */}
                <div className="flex flex-col items-center">
                  <div style={node(lv.state)}>
                    {lv.state === "goal" ? <Crown size={26} strokeWidth={2} fill="#131312" />
                      : lv.state === "done" ? <Check size={28} strokeWidth={3} />
                      : lv.state === "locked" ? <Lock size={22} strokeWidth={2.2} />
                      : lv.key}
                  </div>
                  {!last && <div style={{ width: 3, flex: 1, minHeight: 36, background: "var(--border)", marginTop: 4, marginBottom: 4 }} />}
                </div>

                {/* label card */}
                <div className="flex-1 pb-6">
                  <div className="p-4 rounded-2xl" style={{
                    background: "var(--card)",
                    border: lv.state === "goal" || lv.state === "current" ? "1px solid var(--border-gold)" : "1px solid var(--border)",
                    opacity: lv.state === "locked" ? 0.6 : 1,
                  }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[20px] font-extrabold" style={{ color: "var(--w)" }}>{lv.key}</span>
                      <span className="text-[13px]" style={{ color: "var(--w3)" }}>{L.sub[lv.key]}</span>
                      {lv.state === "goal" && (
                        <span className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: "var(--gold)", color: "#131312" }}>
                          {L.jobReady}
                        </span>
                      )}
                      {lv.state === "current" && (
                        <span className="ml-auto text-[11px] font-bold" style={{ color: "var(--gold)" }}>{L.here}</span>
                      )}
                      {lv.state === "done" && (
                        <span className="ml-auto text-[11px] font-bold" style={{ color: "#16a34a" }}>{L.done}</span>
                      )}
                      {lv.state === "locked" && <Lock size={14} className="ml-auto" style={{ color: "var(--w3)" }} />}
                    </div>

                    {/* progress bar for the current level only (when we have a pct) */}
                    {lv.state === "current" && lv.pct != null && (
                      <div className="mt-3">
                        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg2)" }}>
                          <div className="h-full rounded-full" style={{ width: `${lv.pct}%`, background: "var(--gold)" }} />
                        </div>
                        <div className="text-[11px] mt-1.5 font-semibold" style={{ color: "var(--w3)" }}>{lv.pct}% {L.percent}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* the line that ties the climb to the job */}
        <div className="text-[13px] font-semibold mt-1 px-4 py-3 rounded-2xl text-center"
          style={{ background: "var(--gdim)", color: "var(--gold)" }}>
          {L.reach}
        </div>

      </div>
    </main>
  );
}
