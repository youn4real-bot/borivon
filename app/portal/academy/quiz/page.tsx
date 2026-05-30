"use client";

/**
 * ACADEMY — quiz/homework taker. LIVE (wired to /api/portal/academy/quiz).
 *
 * Loads a real published quiz by ?id, runs the phone-first one-question-per-
 * screen flow, and submits for SERVER-authoritative grading. Homework/quiz get
 * instant green/red feedback (answer key sent); mock_exam hides correctness
 * until the results recap (key never leaves the server). Points are awarded
 * server-side and surface on the home/leaderboard via realtime. Trilingual.
 */
import { useEffect, useState, Suspense } from "react";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { PageLoader } from "@/components/ui/states";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import { X, Check, Flame, ChevronRight, RotateCcw, Trophy, GraduationCap } from "lucide-react";

type Q = {
  id: string; prompt: string; options: string[];
  correct?: number[]; points: number;
  hint?: { en?: string; fr?: string; de?: string } | null;
};
type Quiz = {
  id: string; title: string; kind: string; level: string;
  passScore: number; pointsAward: number; instantFeedback: boolean;
  questions: Q[]; alreadyDone: { score: number; passed: boolean } | null;
};
type Result = { score: number; passed: boolean; pointsEarned?: number; perQuestion: { questionId: string; correct: boolean; correctIndex: number[] }[] };

function QuizInner() {
  const { lang } = useLang();
  const router = useRouter();
  const quizId = useSearchParams().get("id") ?? "";

  const TT = {
    en: { question: "Question", of: "of", correct: "Correct!", wrong: "Not quite", answer: "Answer",
      continue: "Continue", checkIt: "Check", submit: "Submit", done: "Done!", youScored: "You scored",
      points: "pts earned", backToAcademy: "Back to Academy", retry: "Review again", pickOne: "Tap your answer",
      passed: "Passed 🎉", failed: "Keep practising", noQuiz: "No homework right now", noQuizSub: "Check back when your teacher posts one.",
      alreadyTitle: "Already completed", review: "See answers" },
    fr: { question: "Question", of: "sur", correct: "Correct !", wrong: "Presque", answer: "Réponse",
      continue: "Continuer", checkIt: "Vérifier", submit: "Soumettre", done: "Terminé !", youScored: "Ton score",
      points: "pts gagnés", backToAcademy: "Retour à l'Académie", retry: "Revoir", pickOne: "Touche ta réponse",
      passed: "Réussi 🎉", failed: "Continue à t'entraîner", noQuiz: "Pas de devoir pour l'instant", noQuizSub: "Reviens quand ton prof en publie un.",
      alreadyTitle: "Déjà terminé", review: "Voir les réponses" },
    de: { question: "Frage", of: "von", correct: "Richtig!", wrong: "Fast", answer: "Antwort",
      continue: "Weiter", checkIt: "Prüfen", submit: "Absenden", done: "Fertig!", youScored: "Dein Ergebnis",
      points: "Pkt verdient", backToAcademy: "Zurück zur Akademie", retry: "Nochmal ansehen", pickOne: "Tippe deine Antwort",
      passed: "Bestanden 🎉", failed: "Weiter üben", noQuiz: "Gerade keine Hausaufgabe", noQuizSub: "Schau wieder vorbei, wenn deine Lehrkraft eine postet.",
      alreadyTitle: "Bereits erledigt", review: "Antworten ansehen" },
  };
  const L = TT[lang] ?? TT.en;

  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [quiz, setQuiz] = useState<Quiz | null>(null);

  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);          // instant-feedback per-question lock
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [combo, setCombo] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      setToken(tk);
      if (quizId) {
        const r = await fetch(`/api/portal/academy/quiz?id=${quizId}`, { headers: { Authorization: `Bearer ${tk}` } });
        const j = await r.json().catch(() => null);
        if (j && j.id) setQuiz(j as Quiz);
      }
      setLoading(false);
    });
  }, [router, quizId]);

  const q = quiz?.questions[i];
  const instant = quiz?.instantFeedback ?? false;
  const isRight = instant && q && Array.isArray(q.correct) && q.correct[0] === picked;

  function choose(idx: number) {
    if (locked) return;
    setPicked(idx);
    if (q) setAnswers(a => ({ ...a, [q.id]: idx }));
  }
  function check() {
    if (picked === null || !q) return;
    if (instant) {
      setLocked(true);
      if (Array.isArray(q.correct) && q.correct[0] === picked) setCombo(c => c + 1); else setCombo(0);
    } else {
      next(); // exam: no per-question reveal, just advance
    }
  }
  async function next() {
    if (!quiz) return;
    if (i + 1 >= quiz.questions.length) { await submit(); return; }
    setI(i + 1); setPicked(answers[quiz.questions[i + 1]?.id] ?? null); setLocked(false);
  }
  async function submit() {
    if (!quiz || submitting) return;
    setSubmitting(true);
    const payload = { id: quiz.id, answers: Object.entries(answers).map(([questionId, choice]) => ({ questionId, choice })) };
    const r = await fetch("/api/portal/academy/quiz", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => null);
    setSubmitting(false);
    if (j && typeof j.score === "number") setResult(j as Result);
  }

  if (loading) return <PageLoader />;

  // no quiz id / not found
  if (!quiz) {
    return (
      <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
        <PortalTopNav />
        <div className="max-w-[460px] mx-auto px-4 pt-20 flex flex-col items-center text-center">
          <span className="flex items-center justify-center rounded-full mb-4" style={{ width: 72, height: 72, background: "var(--bg2)" }}>
            <GraduationCap size={34} strokeWidth={1.7} style={{ color: "var(--w3)" }} />
          </span>
          <div className="text-[18px] font-extrabold mb-1" style={{ color: "var(--w)" }}>{L.noQuiz}</div>
          <div className="text-[13px] mb-6" style={{ color: "var(--w3)" }}>{L.noQuizSub}</div>
          <button onClick={() => router.push("/portal/academy")} className="px-5 py-3 rounded-2xl text-[14px] font-extrabold" style={{ background: "var(--gold)", color: "#131312", border: "none", cursor: "pointer" }}>
            {L.backToAcademy}
          </button>
        </div>
      </main>
    );
  }

  const progress = result ? 100 : Math.round((i / quiz.questions.length) * 100);
  const tile = (idx: number): React.CSSProperties => {
    const base: React.CSSProperties = { background: "var(--card)", border: "2px solid var(--border)", borderRadius: 18, cursor: locked ? "default" : "pointer" };
    if (!locked || !instant || !q) return picked === idx ? { ...base, borderColor: "var(--gold)", background: "var(--gdim)" } : base;
    const corr = Array.isArray(q.correct) ? q.correct[0] : -1;
    if (idx === corr) return { ...base, borderColor: "#16a34a", background: "rgba(22,163,74,0.12)" };
    if (idx === picked) return { ...base, borderColor: "#ef4444", background: "rgba(239,68,68,0.12)" };
    return { ...base, opacity: 0.5 };
  };

  return (
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="max-w-[460px] mx-auto px-4 pt-5 pb-28">

        {/* top bar */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => router.push("/portal/academy")} className="flex items-center justify-center rounded-full"
            style={{ width: 34, height: 34, background: "var(--bg2)", border: "1px solid var(--border)", cursor: "pointer", flexShrink: 0 }} aria-label={L.backToAcademy}>
            <X size={18} strokeWidth={2.2} style={{ color: "var(--w2)" }} />
          </button>
          <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "var(--bg2)" }}>
            <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "var(--gold)", transition: "width .35s ease" }} />
          </div>
          {combo >= 2 && !result && instant && (
            <span className="flex items-center gap-1 text-[12px] font-extrabold" style={{ color: "var(--gold)" }}>
              <Flame size={14} fill="var(--gold)" strokeWidth={1.6} />{combo}
            </span>
          )}
        </div>

        {!result ? (
          <>
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ color: "var(--gold)", background: "var(--gdim)" }}>{quiz.title}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "var(--w3)", background: "var(--bg2)" }}>{quiz.level}</span>
            </div>
            <div className="text-center text-[12px] font-semibold mb-2" style={{ color: "var(--w3)" }}>{L.question} {i + 1} {L.of} {quiz.questions.length}</div>
            <div className="text-center text-[24px] font-extrabold leading-tight mb-1 px-2" style={{ color: "var(--w)" }}>{q?.prompt}</div>
            <div className="text-center text-[12px] mb-6" style={{ color: "var(--w3)" }}>{L.pickOne}</div>

            <div className="flex flex-col gap-3">
              {q?.options.map((opt, idx) => (
                <button key={idx} onClick={() => choose(idx)} className="w-full px-4 py-4 flex items-center gap-3 text-left" style={tile(idx)}>
                  <span className="flex items-center justify-center rounded-full text-[13px] font-extrabold"
                    style={{ width: 26, height: 26, flexShrink: 0,
                      background: locked && instant && q && Array.isArray(q.correct) && idx === q.correct[0] ? "#16a34a" : locked && instant && idx === picked ? "#ef4444" : picked === idx ? "var(--gold)" : "var(--bg2)",
                      color: (locked && instant && q && Array.isArray(q.correct) && (idx === q.correct[0] || idx === picked)) ? "#fff" : picked === idx ? "#131312" : "var(--w3)" }}>
                    {locked && instant && q && Array.isArray(q.correct) && idx === q.correct[0] ? <Check size={15} strokeWidth={3} />
                      : locked && instant && idx === picked ? <X size={15} strokeWidth={3} /> : String.fromCharCode(65 + idx)}
                  </span>
                  <span className="text-[16px] font-semibold" style={{ color: "var(--w)" }}>{opt}</span>
                </button>
              ))}
            </div>

            {locked && instant && q && (
              <div className="mt-5 p-4 rounded-2xl" style={{ background: isRight ? "rgba(22,163,74,0.12)" : "rgba(239,68,68,0.10)", border: `1px solid ${isRight ? "rgba(22,163,74,0.4)" : "rgba(239,68,68,0.4)"}` }}>
                <div className="flex items-center gap-2 text-[15px] font-extrabold mb-1" style={{ color: isRight ? "#16a34a" : "#ef4444" }}>
                  {isRight ? <Check size={18} strokeWidth={3} /> : <X size={18} strokeWidth={3} />}{isRight ? L.correct : L.wrong}
                </div>
                {(!isRight || q.hint) && (
                  <div className="text-[13px]" style={{ color: "var(--w2)" }}>
                    {!isRight && Array.isArray(q.correct) && (
                      <span className="font-semibold" style={{ color: "var(--w)" }}>{L.answer}: {q.options[q.correct[0]]}. </span>
                    )}
                    {q.hint?.[lang] ?? q.hint?.en ?? ""}
                  </div>
                )}
              </div>
            )}

            <button onClick={locked && instant ? next : check} disabled={picked === null || submitting}
              className="w-full mt-6 py-4 rounded-2xl flex items-center justify-center gap-2 text-[16px] font-extrabold"
              style={{ background: picked === null ? "var(--bg2)" : "var(--gold)", color: picked === null ? "var(--w3)" : "#131312", border: "none", cursor: picked === null ? "not-allowed" : "pointer" }}>
              {submitting ? "…" : (locked && instant) ? L.continue : (i + 1 >= quiz.questions.length ? L.submit : (instant ? L.checkIt : L.continue))}
              {locked && instant && <ChevronRight size={18} strokeWidth={2.5} />}
            </button>
          </>
        ) : (
          /* ── reward / result screen ───────────────────────────────────────── */
          <div className="flex flex-col items-center text-center pt-6">
            <span className="flex items-center justify-center rounded-full mb-5" style={{ width: 92, height: 92, background: result.passed ? "var(--gdim)" : "var(--bg2)" }}>
              <Trophy size={46} strokeWidth={1.6} style={{ color: result.passed ? "var(--gold)" : "var(--w3)" }} fill={result.passed ? "var(--gold)" : "none"} />
            </span>
            <div className="text-[28px] font-extrabold mb-1" style={{ color: "var(--w)" }}>{L.done}</div>
            <div className="text-[15px] mb-1" style={{ color: "var(--w2)" }}>{L.youScored} {result.score}%</div>
            <div className="text-[13px] font-bold mb-7" style={{ color: result.passed ? "#16a34a" : "var(--w3)" }}>{result.passed ? L.passed : L.failed}</div>

            <div className="flex gap-3 w-full mb-3">
              <div className="flex-1 py-4 rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border-gold)" }}>
                <div className="text-[26px] font-extrabold leading-none" style={{ color: "var(--gold)" }}>+{result.pointsEarned ?? 0}</div>
                <div className="text-[11px] mt-1.5" style={{ color: "var(--w3)" }}>{L.points}</div>
              </div>
              <div className="flex-1 py-4 rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="text-[26px] font-extrabold leading-none" style={{ color: "var(--w)" }}>{result.perQuestion.filter(p => p.correct).length}/{result.perQuestion.length}</div>
                <div className="text-[11px] mt-1.5" style={{ color: "var(--w3)" }}>{L.correct.replace("!", "")}</div>
              </div>
            </div>

            <button onClick={() => router.push("/portal/academy")} className="w-full mt-4 py-4 rounded-2xl text-[16px] font-extrabold" style={{ background: "var(--gold)", color: "#131312", border: "none", cursor: "pointer" }}>
              {L.backToAcademy}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export default function AcademyQuizPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <QuizInner />
    </Suspense>
  );
}
