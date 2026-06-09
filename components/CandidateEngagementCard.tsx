"use client";

import { useEffect, useState } from "react";
import { BarChart3, Camera, Mic, Clock, BookOpen, Hand, ShieldOff } from "lucide-react";

/**
 * Compact live-class engagement profile for ONE candidate — the employer/staff
 * view. Self-fetching + access-controlled server-side
 * (/api/portal/classroom/engagement/[userId]): supreme/sub-admins always see
 * it, org members only for their own candidates and only with active consent.
 * Renders nothing until data resolves; shows a muted state if the candidate
 * hasn't consented or has no class data yet.
 */

type Row = {
  sessionsAttended: number; presentSeconds: number; cameraPct: number;
  speakingSeconds: number; exerciseActions: number; handRaises: number; score: number;
};

const fmtDur = (s: number) => s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
function scoreColor(score: number) {
  if (score >= 70) return { fg: "var(--success)", bg: "var(--success-bg)", bd: "var(--success-border)" };
  if (score >= 45) return { fg: "var(--gold)", bg: "var(--gdim)", bd: "var(--border-gold)" };
  return { fg: "var(--danger)", bg: "var(--danger-bg)", bd: "var(--danger-border)" };
}

export function CandidateEngagementCard({ userId, accessToken, lang }: { userId: string; accessToken: string; lang: "fr" | "en" | "de" }) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [state, setState] = useState<"loading" | "hidden" | "no-consent" | "no-data" | "ready">("loading");
  const [row, setRow] = useState<Row | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/portal/classroom/engagement/${userId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (cancelled) return;
        if (!r.ok) { setState("hidden"); return; }   // 404/403 → not allowed to see; show nothing
        const j = await r.json();
        if (j.consented === false) { setState("no-consent"); return; }
        if (!j.row) { setState("no-data"); return; }
        setRow(j.row as Row); setState("ready");
      } catch { if (!cancelled) setState("hidden"); }
    })();
    return () => { cancelled = true; };
  }, [userId, accessToken]);

  if (state === "loading" || state === "hidden") return null;

  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 size={14} strokeWidth={1.8} style={{ color: "var(--gold)" }} />
        <h2 className="text-[13.5px] font-semibold" style={{ color: "var(--w)" }}>{T("Live-class engagement", "Live-Kurs-Engagement", "Engagement en cours")}</h2>
        {state === "ready" && row && (() => { const c = scoreColor(row.score); return (
          <span className="ml-auto inline-block text-[12px] font-extrabold px-2 py-0.5 rounded-lg tabular-nums" style={{ color: c.fg, background: c.bg, border: `1px solid ${c.bd}` }}>{row.score}/100</span>
        ); })()}
      </div>

      {state === "no-consent" ? (
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--w3)" }}>
          <ShieldOff size={14} /> {T("Candidate hasn't consented to engagement tracking.", "Kandidat hat dem Engagement-Tracking nicht zugestimmt.", "Le candidat n'a pas consenti au suivi de l'engagement.")}
        </div>
      ) : state === "no-data" ? (
        <p className="text-[12px]" style={{ color: "var(--w3)" }}>{T("No live-class data yet.", "Noch keine Live-Kurs-Daten.", "Pas encore de données de cours.")}</p>
      ) : row ? (
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { icon: <Camera size={12} />, label: T("Camera", "Kamera", "Caméra"), val: pct(row.cameraPct), color: row.cameraPct >= 0.9 ? "var(--success)" : row.cameraPct >= 0.5 ? "var(--gold)" : "var(--danger)" },
            { icon: <Mic size={12} />, label: T("Spoke", "Gesprochen", "Parlé"), val: fmtDur(row.speakingSeconds), color: "var(--w)" },
            { icon: <Clock size={12} />, label: T("Present", "Anwesend", "Présent"), val: fmtDur(row.presentSeconds), color: "var(--w)" },
            { icon: <BookOpen size={12} />, label: T("Actions", "Aktionen", "Actions"), val: String(row.exerciseActions), color: "var(--w)" },
            { icon: <Hand size={12} />, label: T("Hands", "Melden", "Mains"), val: String(row.handRaises), color: "var(--w)" },
            { icon: <BarChart3 size={12} />, label: T("Sessions", "Sitzungen", "Sessions"), val: String(row.sessionsAttended), color: "var(--w)" },
          ].map((m, i) => (
            <div key={i} className="rounded-xl p-2.5 text-center" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-center gap-1 mb-0.5" style={{ color: "var(--w3)" }}>{m.icon}<span className="text-[9.5px] uppercase tracking-wide font-bold">{m.label}</span></div>
              <p className="text-[15px] font-bold tabular-nums" style={{ color: m.color }}>{m.val}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
