"use client";

/**
 * Anerkennung / Visa Autopilot — admin Pipeline board ("who's stuck where").
 *
 * Every candidate the admin can see, one row each, ordered most-urgent-first and
 * color-coded by health (blocked → overdue → due soon → on track → done). Click
 * a row → jump to that candidate in the admin panel (where the journey lives).
 * Read-only overview; edits happen in the candidate's journey checklist.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { JOURNEY_PRESETS } from "@/lib/candidateJourney";
import { JourneyMap } from "@/components/JourneyMap";
import { ArrowLeft, AlertTriangle, Clock, CheckCircle2, Search, Map as MapIcon, List, BadgeCheck } from "lucide-react";

type Health = "on_track" | "due_soon" | "overdue" | "blocked" | "done";
type Status = {
  progress: number; doneCount: number; totalPresets: number;
  current: { key: string; owner: string; dueDate: string | null; blocked: boolean; blockedReason: string | null; daysToDue: number | null } | null;
  reached: { key: string; position: number } | null;
  overdueCount: number; blockedCount: number; health: Health;
};
type Sellable = { sellable: boolean; cvDone: boolean; diplomaApproved: boolean };
type Row = { userId: string; name: string; photo: string | null; status: Status; sellable: Sellable; b2Stage?: string };

const HEALTH_STYLE: Record<Health, { dot: string; label: { en: string; de: string; fr: string } }> = {
  blocked:  { dot: "#ef4444", label: { en: "Blocked",   de: "Blockiert",   fr: "Bloqué" } },
  overdue:  { dot: "#f97316", label: { en: "Overdue",   de: "Überfällig",  fr: "En retard" } },
  due_soon: { dot: "#f59e0b", label: { en: "Due soon",  de: "Bald fällig", fr: "Bientôt dû" } },
  on_track: { dot: "#16a34a", label: { en: "On track",  de: "Im Plan",     fr: "Sur la bonne voie" } },
  done:     { dot: "#6b7280", label: { en: "Complete",  de: "Fertig",      fr: "Terminé" } },
};

function presetLabel(key: string | undefined, lang: string): string {
  if (!key) return "—";
  const p = JOURNEY_PRESETS.find((x) => x.key === key);
  if (!p) return key;
  return p.label[(lang as "en" | "fr" | "de")] ?? p.label.en;
}

export default function AdminPipelinePage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [today, setToday] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | "sellable">("all");
  const [view, setView] = useState<"map" | "list">("map");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      let token = session.access_token ?? "";
      const expMs = (session.expires_at ?? 0) * 1000;
      if (!expMs || expMs - Date.now() < 60_000) {
        try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) token = r.session.access_token; } catch { /* keep */ }
        if (cancelled) return;
      }
      const res = await fetch("/api/portal/journey/pipeline", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 || res.status === 403) { router.replace("/portal/dashboard"); return; }
      const j = await res.json().catch(() => ({ candidates: [] }));
      if (cancelled) return;
      setRows((j.candidates ?? []) as Row[]);
      setToday(j.today ?? "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "attention" && !(r.status.health === "blocked" || r.status.health === "overdue")) return false;
      if (filter === "sellable" && !r.sellable.sellable) return false;
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, filter]);

  if (loading) return <PageLoader />;

  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";

  const dueText = (s: Status): string => {
    const d = s.current?.daysToDue;
    if (d === null || d === undefined) return "";
    if (d < 0) return T(`${-d}d overdue`, `${-d} T. überfällig`, `${-d}j de retard`);
    if (d === 0) return T("due today", "heute fällig", "dû aujourd'hui");
    return T(`in ${d}d`, `in ${d} T.`, `dans ${d}j`);
  };

  return (
    <main id="bv-main" className="mx-auto px-4 sm:px-5 py-6 sm:py-10 bv-page-bottom" style={{ maxWidth: 1080 }}>
      <button onClick={() => router.push("/portal/admin")} className="bv-btn bv-btn-ghost mb-5 inline-flex">
        <ArrowLeft size={15} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
      </button>

      <div className="mb-4">
        <h1 className="bv-h1">{T("Pipeline", "Pipeline", "Pipeline")}</h1>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <Search size={15} className="absolute" style={{ left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} className="bv-input" style={{ paddingLeft: 36 }}
            placeholder={T("Search candidate…", "Kandidat suchen…", "Rechercher…")} />
        </div>
        <div className="inline-flex p-0.5 rounded-full" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
          {([["all", T("All", "Alle", "Tous")], ["sellable", T("Ready to sell", "Verkaufsbereit", "Prêts")], ["attention", T("Needs attention", "Braucht Aufmerksamkeit", "À traiter")]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
              style={filter === v ? { background: "var(--gold)", color: "#131312" } : { background: "transparent", color: "var(--w3)" }}>
              {label}
            </button>
          ))}
        </div>
        {/* Map ⇄ List view toggle */}
        <div className="inline-flex p-0.5 rounded-full" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
          {([["map", MapIcon, T("Map", "Karte", "Carte")], ["list", List, T("List", "Liste", "Liste")]] as const).map(([v, Icon, label]) => (
            <button key={v} onClick={() => setView(v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
              style={view === v ? { background: "var(--gold)", color: "#131312" } : { background: "transparent", color: "var(--w3)" }}>
              <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Map view — the living Morocco→Germany rail */}
      {view === "map" ? (
        <JourneyMap rows={shown} lang={lang} onPick={(uid) => router.push(`/portal/admin?nav_user_id=${encodeURIComponent(uid)}`)} />
      ) : shown.length === 0 ? (
        <div className="bv-card text-center py-16">
          <CheckCircle2 size={30} strokeWidth={1.5} className="mx-auto mb-3" style={{ color: "var(--w3)" }} />
          <p className="text-[14px] font-medium" style={{ color: "var(--w2)" }}>
            {filter === "attention"
              ? T("Nothing needs attention 🎉", "Nichts zu tun 🎉", "Rien à traiter 🎉")
              : T("No candidates yet", "Noch keine Kandidaten", "Aucun candidat")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((r) => {
            const hs = HEALTH_STYLE[r.status.health];
            const pct = Math.round(r.status.progress * 100);
            return (
              <button key={r.userId}
                onClick={() => router.push(`/portal/admin?nav_user_id=${encodeURIComponent(r.userId)}`)}
                className="bv-card bv-press text-left flex items-center gap-3 p-3 sm:p-3.5" style={{ borderRadius: "var(--r-lg)" }}>
                {/* Health dot */}
                <span className="flex-shrink-0" style={{ width: 10, height: 10, borderRadius: 999, background: hs.dot }} />
                {/* Avatar */}
                {r.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.photo} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: 38, height: 38 }} />
                ) : (
                  <span className="rounded-full flex items-center justify-center flex-shrink-0 text-[13px] font-semibold"
                    style={{ width: 38, height: 38, background: "var(--gdim)", color: "var(--gold)" }}>{initials(r.name)}</span>
                )}
                {/* Name + current step */}
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold truncate flex items-center gap-1.5" style={{ color: "var(--w)" }}>
                    <span className="truncate">{r.name}</span>
                    {r.sellable.sellable && (
                      <span className="inline-flex items-center gap-1 flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: "var(--gold)", color: "#131312" }}
                        title={T("Ready to sell to an employer", "Verkaufsbereit", "Prêt à vendre")}>
                        <BadgeCheck size={10} strokeWidth={2.5} /> {T("SELL", "VERK", "VENTE")}
                      </span>
                    )}
                  </p>
                  <p className="text-[12px] truncate flex items-center gap-1.5" style={{ color: "var(--w3)" }}>
                    {r.status.current ? (
                      <>
                        {r.status.current.blocked && <AlertTriangle size={11} style={{ color: "#ef4444" }} />}
                        <span className="truncate">{presetLabel(r.status.current.key, lang)}</span>
                        {dueText(r.status) && <span style={{ color: r.status.health === "overdue" ? "#f97316" : "var(--w3)" }}>· {dueText(r.status)}</span>}
                      </>
                    ) : (
                      <span style={{ color: "#16a34a" }}>{T("Journey complete", "Reise abgeschlossen", "Parcours terminé")}</span>
                    )}
                  </p>
                  {/* blocked reason (admin/org only — API already gates) */}
                  {r.status.current?.blocked && r.status.current.blockedReason && (
                    <p className="text-[11px] truncate mt-0.5" style={{ color: "#ef4444" }}>⚠ {r.status.current.blockedReason}</p>
                  )}
                </div>
                {/* Progress */}
                <div className="flex-shrink-0 text-right" style={{ width: 92 }}>
                  <div className="flex items-center gap-1.5 justify-end mb-1">
                    <Clock size={11} style={{ color: "var(--w3)" }} />
                    <span className="text-[11.5px] font-semibold" style={{ color: "var(--w2)" }}>{r.status.doneCount}/{r.status.totalPresets}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 999, background: "var(--bg2)", overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: hs.dot, transition: "width .3s" }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}
