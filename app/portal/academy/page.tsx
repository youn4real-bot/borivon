"use client";

/**
 * ACADEMY — candidate-facing landing. LIVE (wired to /api/portal/academy/me).
 *
 * Audience = young candidates, short attention span, phone-first. Design rule:
 * ONE thing per glance, big + bold, MAXIMISE human-status pull (streak you can't
 * break, your rank, beating named peers) + the job-stakes hook (the reliability
 * employers see). Everything here is derived live from the ledger, so it can't
 * drift. Realtime: subscribes to academy:<userId> so a teacher's class bonus /
 * attendance mark refreshes the numbers instantly. Trilingual per LAW #19.
 */
import { useEffect, useState, useCallback } from "react";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { PageLoader } from "@/components/ui/states";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Flame, ChevronRight, Play, PenLine, Eye, ShieldCheck, CalendarCheck, Clock, GraduationCap } from "lucide-react";

type Rel = { index: number | null; attendancePct: number | null; onTimePct: number | null; sessions: number };
type BoardRow = { rank: number; name: string; photo: string | null; points: number; me: boolean };
type MeData = {
  enrolled: boolean;
  cohortName?: string; level?: string; nextLevel?: string; targetLevel?: string;
  points?: number; rank?: number; streak: number;
  aheadName?: string | null; aheadGap?: number;
  reliability: Rel;
  leaderboard?: BoardRow[];
  nextClass?: { id: string; title: string; startsAt: string; live: boolean } | null;
  homework?: { id: string; title: string; questions: number; points: number } | null;
  activeToday?: boolean; bonusToday?: number | null;
};

export default function AcademyPage() {
  const { lang } = useLang();
  const router = useRouter();

  const TT = {
    en: {
      level: "Level", points: "pts", rank: "Rank",
      streakDays: "day streak", keepAlive: "Don't break it 🔥",
      streakSafe: "Active today — streak safe",
      behind: (p: number, n: string) => `${p} pts behind ${n} — catch up!`,
      leadGap: "You're #1 — hold your lead 👑",
      classBonus: (p: number) => `Your teacher gave +${p} to everyone in class 🎉`,
      employersSee: "What employers see", reliability: "Reliability",
      attendance: "Attendance", onTime: "On-time", noRel: "Show up to build this",
      nextClass: "Your class", liveNow: "Live now", join: "Join",
      homework: "Today's homework", questionsWord: "questions", start: "Start",
      continue: "Continue learning", you: "You",
      leaderboard: "Leaderboard", period: "30-day",
      notEnrolledTitle: "You'll join a class soon", notEnrolledSub: "Your teacher will add you to a cohort. Your streak and reliability already count.",
    },
    fr: {
      level: "Niveau", points: "pts", rank: "Rang",
      streakDays: "jours d'affilée", keepAlive: "Ne casse pas la série 🔥",
      streakSafe: "Actif aujourd'hui — série protégée",
      behind: (p: number, n: string) => `${p} pts derrière ${n} — rattrape-le !`,
      leadGap: "Tu es #1 — garde ta place 👑",
      classBonus: (p: number) => `Ton prof a donné +${p} à toute la classe 🎉`,
      employersSee: "Ce que voient les employeurs", reliability: "Fiabilité",
      attendance: "Présence", onTime: "Ponctualité", noRel: "Sois présent pour la construire",
      nextClass: "Ton cours", liveNow: "En direct", join: "Rejoindre",
      homework: "Devoir du jour", questionsWord: "questions", start: "Commencer",
      continue: "Continuer", you: "Toi",
      leaderboard: "Classement", period: "30 jours",
      notEnrolledTitle: "Tu rejoindras bientôt une classe", notEnrolledSub: "Ton prof t'ajoutera à une cohorte. Ta série et ta fiabilité comptent déjà.",
    },
    de: {
      level: "Niveau", points: "Pkt", rank: "Rang",
      streakDays: "Tage-Streak", keepAlive: "Nicht abreißen lassen 🔥",
      streakSafe: "Heute aktiv — Streak sicher",
      behind: (p: number, n: string) => `${p} Pkt hinter ${n} — hol auf!`,
      leadGap: "Du bist #1 — halte deinen Vorsprung 👑",
      classBonus: (p: number) => `Deine Lehrkraft gab +${p} für die ganze Klasse 🎉`,
      employersSee: "Was Arbeitgeber sehen", reliability: "Zuverlässigkeit",
      attendance: "Anwesenheit", onTime: "Pünktlichkeit", noRel: "Sei dabei, um sie aufzubauen",
      nextClass: "Dein Kurs", liveNow: "Live", join: "Beitreten",
      homework: "Heutige Hausaufgabe", questionsWord: "Fragen", start: "Starten",
      continue: "Weiterlernen", you: "Du",
      leaderboard: "Rangliste", period: "30 Tage",
      notEnrolledTitle: "Du kommst bald in eine Klasse", notEnrolledSub: "Deine Lehrkraft fügt dich einer Kohorte hinzu. Dein Streak und deine Zuverlässigkeit zählen bereits.",
    },
  };
  const L = TT[lang] ?? TT.en;

  const [data, setData] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (tk: string) => {
    const r = await fetch("/api/portal/academy/me", { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json().catch(() => null);
    if (j && typeof j.streak === "number") setData(j as MeData);
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      await load(tk);
      setLoading(false);
      // realtime: a teacher's mark / bonus pings this candidate's topic
      channel = supabase.channel(`academy:${session.user.id}`)
        .on("broadcast", { event: "points" }, () => load(tk))
        .subscribe();
    });
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [router, load]);

  const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 24 };
  const avatar = (name: string, photo: string | null, me?: boolean): React.CSSProperties => ({
    width: 42, height: 42, borderRadius: 99, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 15, fontWeight: 700,
    background: photo ? `center/cover no-repeat url(${photo})` : me ? "var(--gold)" : "var(--bg2)",
    color: me ? "#131312" : "var(--w2)", border: me && !photo ? "none" : "1px solid var(--border)",
  });
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" });

  if (loading) return <PageLoader />;

  // ── not enrolled: still honour streak + reliability, soft prompt ───────────
  if (!data || !data.enrolled) {
    const rel = data?.reliability;
    return (
      <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
        <PortalTopNav />
        <div className="max-w-[460px] mx-auto px-4 pt-5 pb-28">
          <div className="p-6 flex flex-col items-center text-center" style={{ ...card, borderColor: "var(--border-gold)" }}>
            <span className="flex items-center justify-center rounded-full mb-4" style={{ width: 72, height: 72, background: "var(--gdim)" }}>
              <GraduationCap size={36} strokeWidth={1.7} style={{ color: "var(--gold)" }} />
            </span>
            <div className="text-[20px] font-extrabold mb-1" style={{ color: "var(--w)" }}>{L.notEnrolledTitle}</div>
            <div className="text-[13px]" style={{ color: "var(--w3)" }}>{L.notEnrolledSub}</div>
            {data && data.streak > 0 && (
              <div className="flex items-center gap-2 mt-5 px-4 py-2 rounded-full" style={{ background: "var(--bg2)" }}>
                <Flame size={18} fill="var(--gold)" strokeWidth={1.6} style={{ color: "var(--gold)" }} />
                <span className="text-[15px] font-extrabold" style={{ color: "var(--w)" }}>{data.streak}</span>
                <span className="text-[12px]" style={{ color: "var(--w3)" }}>{L.streakDays}</span>
              </div>
            )}
            {rel && rel.index != null && (
              <div className="text-[12px] mt-3" style={{ color: "var(--w3)" }}>{L.reliability}: <b style={{ color: "var(--gold)" }}>{rel.index}</b></div>
            )}
          </div>
        </div>
      </main>
    );
  }

  const rel = data.reliability;
  const board = data.leaderboard ?? [];
  const MEDAL = ["var(--gold)", "#c0c7cf", "#cd7f32"];

  return (
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="max-w-[460px] mx-auto px-4 pt-5 pb-28">

        {/* ── LIVE CLASS-BONUS MOMENT ──────────────────────────────────────── */}
        {data.bonusToday != null && data.bonusToday > 0 && (
          <div className="mb-3 px-4 py-3 rounded-2xl flex items-center gap-3" style={{ background: "var(--gold)" }}>
            <span className="text-[15px] font-bold flex-1" style={{ color: "#131312" }}>{L.classBonus(data.bonusToday)}</span>
            <span className="text-[15px] font-extrabold px-2.5 py-1 rounded-full tabular-nums" style={{ background: "#131312", color: "var(--gold)" }}>+{data.bonusToday}</span>
          </div>
        )}

        {/* ── 1. STATUS HERO ───────────────────────────────────────────────── */}
        <div className="p-6 mb-3 flex flex-col items-center text-center" style={{ ...card, borderColor: "var(--border-gold)" }}>
          <button onClick={() => router.push("/portal/academy/path")}
            className="text-[11px] font-semibold px-3 py-1 rounded-full mb-4"
            style={{ background: "var(--gdim)", color: "var(--gold)", border: "none", cursor: "pointer" }}>
            {L.level} {data.level} → {data.targetLevel}
          </button>

          <Flame size={56} strokeWidth={1.6} style={{ color: "var(--gold)" }} fill="var(--gold)" />
          <div className="text-[64px] font-extrabold leading-none mt-1" style={{ color: "var(--w)" }}>{data.streak}</div>
          <div className="text-[14px] font-semibold mb-0.5" style={{ color: "var(--w2)" }}>{L.streakDays}</div>
          {data.activeToday ? (
            <div className="text-[12px] font-semibold flex items-center gap-1" style={{ color: "#16a34a" }}>
              <ShieldCheck size={14} strokeWidth={2.4} />{L.streakSafe}
            </div>
          ) : (
            <div className="text-[12px]" style={{ color: "var(--gold)" }}>{L.keepAlive}</div>
          )}

          <div className="flex gap-3 mt-5 w-full">
            <div className="flex-1 py-3 rounded-2xl" style={{ background: "var(--bg2)" }}>
              <div className="text-[22px] font-extrabold leading-none" style={{ color: "var(--w)" }}>{data.points}</div>
              <div className="text-[11px] mt-1" style={{ color: "var(--w3)" }}>{L.points}</div>
            </div>
            <div className="flex-1 py-3 rounded-2xl" style={{ background: "var(--bg2)" }}>
              <div className="text-[22px] font-extrabold leading-none" style={{ color: "var(--gold)" }}>#{data.rank}</div>
              <div className="text-[11px] mt-1" style={{ color: "var(--w3)" }}>{L.rank}</div>
            </div>
          </div>

          <div className="text-[12px] font-medium mt-4 px-3 py-2 rounded-full w-full" style={{ background: "var(--gdim)", color: "var(--w)" }}>
            {data.aheadName ? L.behind(data.aheadGap ?? 0, data.aheadName) : L.leadGap}
          </div>
        </div>

        {/* ── 1b. RELIABILITY — the job-stakes hook ────────────────────────── */}
        <div className="p-4 mb-3" style={{ ...card, borderColor: "var(--border-gold)" }}>
          <div className="flex items-center gap-1.5 mb-3">
            <Eye size={14} strokeWidth={2.2} style={{ color: "var(--w3)" }} />
            <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--w3)" }}>{L.employersSee}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center justify-center rounded-2xl px-4 py-3" style={{ background: "var(--gdim)", minWidth: 92 }}>
              <span className="text-[40px] font-extrabold leading-none" style={{ color: "var(--gold)" }}>{rel.index ?? "—"}</span>
              <span className="text-[11px] font-semibold mt-1" style={{ color: "var(--w2)" }}>{L.reliability}</span>
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <CalendarCheck size={16} strokeWidth={2.2} style={{ color: "#16a34a" }} />
                <span className="text-[13px] flex-1" style={{ color: "var(--w2)" }}>{L.attendance}</span>
                <span className="text-[15px] font-extrabold tabular-nums" style={{ color: "var(--w)" }}>{rel.attendancePct != null ? `${rel.attendancePct}%` : "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={16} strokeWidth={2.2} style={{ color: "#16a34a" }} />
                <span className="text-[13px] flex-1" style={{ color: "var(--w2)" }}>{L.onTime}</span>
                <span className="text-[15px] font-extrabold tabular-nums" style={{ color: "var(--w)" }}>{rel.onTimePct != null ? `${rel.onTimePct}%` : "—"}</span>
              </div>
            </div>
          </div>
          <div className="text-[12px] font-semibold mt-3 px-3 py-2 rounded-full text-center" style={{ background: "var(--bg2)", color: "var(--gold)" }}>
            {rel.index != null
              ? (lang === "de" ? "Top-Zuverlässigkeit wird zuerst gewählt" : lang === "fr" ? "Les plus fiables sont choisis en premier" : "Top reliability gets picked first")
              : L.noRel}
          </div>
        </div>

        {/* ── 2. NEXT CLASS (only if scheduled / live) ─────────────────────── */}
        {data.nextClass && (
          <button onClick={() => router.push(`/portal/academy/class?id=${data.nextClass!.id}`)} className="w-full p-4 mb-3 flex items-center gap-4 text-left" style={{ ...card, background: "var(--gold)", border: "none", cursor: "pointer" }}>
            <span className="flex items-center justify-center rounded-full" style={{ width: 46, height: 46, background: "rgba(0,0,0,0.12)", flexShrink: 0 }}>
              <Play size={22} strokeWidth={2} fill="#131312" style={{ color: "#131312", marginLeft: 2 }} />
            </span>
            <span className="flex-1">
              <span className="block text-[11px] font-semibold" style={{ color: "rgba(0,0,0,0.6)" }}>
                {data.nextClass.live ? L.liveNow : hhmm(data.nextClass.startsAt)} · {L.nextClass}
              </span>
              <span className="block text-[16px] font-bold" style={{ color: "#131312" }}>{data.nextClass.title}</span>
            </span>
            <span className="text-[13px] font-bold px-3 py-2 rounded-full" style={{ background: "#131312", color: "var(--gold)" }}>{L.join}</span>
          </button>
        )}

        {/* ── 2b. HOMEWORK (only if a quiz is pending) ─────────────────────── */}
        {data.homework && (
          <button onClick={() => router.push(`/portal/academy/quiz?id=${data.homework!.id}`)} className="w-full p-4 mb-3 flex items-center gap-4 text-left" style={{ ...card, cursor: "pointer" }}>
            <span className="flex items-center justify-center rounded-full" style={{ width: 46, height: 46, background: "var(--gdim)", flexShrink: 0 }}>
              <PenLine size={20} strokeWidth={2} style={{ color: "var(--gold)" }} />
            </span>
            <span className="flex-1">
              <span className="block text-[16px] font-bold" style={{ color: "var(--w)" }}>{data.homework.title || L.homework}</span>
              <span className="block text-[12px]" style={{ color: "var(--w3)" }}>{data.homework.questions} {L.questionsWord} · +{data.homework.points} {L.points}</span>
            </span>
            <span className="text-[13px] font-bold px-3 py-2 rounded-full" style={{ background: "var(--gold)", color: "#131312" }}>{L.start}</span>
          </button>
        )}

        {/* ── 3. LEADERBOARD ───────────────────────────────────────────────── */}
        <div className="p-4" style={card}>
          <div className="text-[18px] font-extrabold mb-3" style={{ color: "var(--w)" }}>
            {L.leaderboard} <span className="text-[13px] font-semibold" style={{ color: "var(--w3)" }}>({L.period})</span>
          </div>
          <div className="mb-1" style={{ height: 1, background: "var(--border)" }} />
          {board.length === 0 && (
            <div className="py-6 text-center text-[13px]" style={{ color: "var(--w3)" }}>—</div>
          )}
          {board.map((r) => {
            const medal = r.rank <= 3 ? MEDAL[r.rank - 1] : null;
            return (
              <div key={r.rank} className="flex items-center gap-3 py-2.5 rounded-2xl px-1" style={{ background: r.me ? "var(--gdim)" : "transparent" }}>
                {medal ? (
                  <span className="flex items-center justify-center rounded-full text-[13px] font-extrabold" style={{ width: 26, height: 26, flexShrink: 0, background: medal, color: "#131312" }}>{r.rank}</span>
                ) : (
                  <span className="w-[26px] text-center text-[15px] font-bold" style={{ color: "var(--w3)" }}>{r.rank}</span>
                )}
                <span style={avatar(r.name, r.photo, r.me)}>{!r.photo && (r.name.charAt(0) || "?")}</span>
                <span className="flex-1 text-[15px] font-bold flex items-center gap-1.5" style={{ color: r.me ? "var(--gold)" : "var(--w)" }}>
                  {r.me ? L.you : r.name}
                  {r.me && data.streak > 0 && <Flame size={14} fill="var(--gold)" strokeWidth={1.6} style={{ color: "var(--gold)" }} />}
                </span>
                <span className="text-[15px] font-extrabold tabular-nums" style={{ color: "var(--gold)" }}>+{r.points.toLocaleString()}</span>
              </div>
            );
          })}
        </div>

        {/* continue-learning — quiet link to the path */}
        <button onClick={() => router.push("/portal/academy/path")} className="w-full flex items-center justify-center gap-1.5 mt-4 text-[13px] font-semibold"
          style={{ color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
          {L.continue} <ChevronRight size={15} strokeWidth={2.2} />
        </button>

      </div>
    </main>
  );
}
