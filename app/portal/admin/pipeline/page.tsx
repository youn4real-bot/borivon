"use client";

/**
 * Anerkennung / Visa Autopilot — admin Pipeline board ("who's stuck where").
 *
 * Every candidate the admin can see, one row each, ordered most-urgent-first and
 * color-coded by health (blocked → overdue → due soon → on track → done). Click
 * a row → jump to that candidate in the admin panel (where the journey lives).
 * Read-only overview; edits happen in the candidate's journey checklist.
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { JOURNEY_PRESETS } from "@/lib/candidateJourney";
import { JourneyMap } from "@/components/JourneyMap";
import { Modal, GoldButton, GhostButton } from "@/components/ui/Modal";
import { normalizeB2Stage, b2StageLabel, b2StageColor, B2_FAILED_COLOR } from "@/lib/b2Journey";
import { impfungStageLabel, IMPFUNG_STAGE_BY_KEY, type ImpfungStage } from "@/lib/impfungJourney";
import { ArrowLeft, AlertTriangle, Clock, CheckCircle2, Search, Map as MapIcon, List, BadgeCheck, ArrowRight, Bell } from "lucide-react";

type Health = "on_track" | "due_soon" | "overdue" | "blocked" | "done";
type Status = {
  progress: number; doneCount: number; totalPresets: number;
  current: { key: string; owner: string; dueDate: string | null; blocked: boolean; blockedReason: string | null; daysToDue: number | null } | null;
  reached: { key: string; position: number } | null;
  overdueCount: number; blockedCount: number; health: Health;
};
type Sellable = { sellable: boolean; cvDone: boolean; diplomaApproved: boolean };
type FollowUp = { needed: boolean; reasons: string[] };
type OpenTask = { key: string | null; text: string | null; owner: string | null; dueDate: string | null; blocked: boolean };
type Row = { userId: string; name: string; photo: string | null; status: Status; sellable: Sellable; b2Stage?: string; b2Failed?: boolean; impfungStage?: string; impfungDoses?: { got: number; need: number }; followUp?: FollowUp; openTasks?: OpenTask[] };

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
  const [track, setTrack] = useState<"journey" | "b2" | "impfung">("journey");
  // Clicking a candidate opens a quick cross-track summary (peek) — NOT a jump
  // straight to their dossier. The dossier is one button away inside the popup.
  const [peek, setPeek] = useState<Row | null>(null);
  const [nudging, setNudging] = useState(false);
  const [nudged, setNudged] = useState<string | null>(null); // userId whose reminder just sent

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
      if (filter === "attention" && !r.followUp?.needed) return false;
      if (filter === "sellable" && !r.sellable.sellable) return false;
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, filter]);

  // The B2 / Impfung tracks ignore the journey-specific filter tabs (sellable /
  // attention) — those are about the main journey. They respect only the search.
  const searchOnlyRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  // Drag-and-drop: move a candidate to a different B2 stage by dropping their
  // face on that stage row. Optimistic (instant glide via Motion) → persist to
  // the B2 route (which gates authority per LAW #25) → roll back on failure.
  const moveB2 = async (userId: string, toStage: string) => {
    let rolledBack = false;
    const snapshot = rows;
    setRows((rs) => rs.map((r) => (r.userId === userId ? { ...r, b2Stage: toStage } : r)));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/portal/journey/b2", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId: userId, stage: toStage }),
      });
      if (!res.ok) { rolledBack = true; setRows(snapshot); }
    } catch {
      rolledBack = true;
      setRows(snapshot);
    }
    if (rolledBack) {
      // Soft, non-blocking notice — the face snaps back so the admin sees it didn't take.
      console.warn("[pipeline] B2 stage move failed; rolled back");
    }
  };

  // Send a follow-up reminder to a candidate (in-app bell notification, masked
  // as coming from "Borivon"). One click from the peek popup.
  const sendNudge = async (userId: string) => {
    setNudging(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/portal/journey/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId: userId }),
      });
      if (res.ok) setNudged(userId);
    } catch { /* swallow — button just won't flip to "sent" */ }
    setNudging(false);
  };

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

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="bv-h1">{T("Pipeline", "Pipeline", "Pipeline")}</h1>
        {/* Track switcher — flip between roadmaps instantly (no new URL). */}
        <div className="inline-flex p-0.5 rounded-full" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
          {([
            ["journey", T("Journey", "Reise", "Parcours")],
            ["b2", T("B2 German", "B2 Deutsch", "B2 allemand")],
            ["impfung", T("Impfung", "Impfung", "Vaccins")],
          ] as const).map(([v, label]) => (
            <button key={v} onClick={() => setTrack(v)}
              className="px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
              style={track === v ? { background: "var(--gold)", color: "#131312" } : { background: "transparent", color: "var(--w3)" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <Search size={15} className="absolute" style={{ left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} className="bv-input" style={{ paddingLeft: 36 }}
            placeholder={T("Search candidate…", "Kandidat suchen…", "Rechercher…")} />
        </div>
        {/* Journey-only controls (sellable/attention filter + Map/List). The B2
            track is its own roadmap and ignores these. */}
        {track === "journey" && (
          <>
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
          </>
        )}
      </div>

      {/* Map view — the living roadmap (Journey or B2, per the track switch).
          The B2 track always uses the map style + the search-only list. */}
      {view === "map" || track !== "journey" ? (
        <JourneyMap rows={track !== "journey" ? searchOnlyRows : shown} lang={lang} track={track}
          onPick={(uid) => setPeek(rows.find((r) => r.userId === uid) ?? null)}
          onMoveB2={moveB2} />
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
                onClick={() => setPeek(r)}
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
      {/* Candidate peek — quick cross-track summary; the dossier is one click away. */}
      <Modal
        open={!!peek}
        onClose={() => setPeek(null)}
        size="md"
        title={peek?.name ?? ""}
        subtitle={T("Quick summary — open the full profile for documents & details",
          "Kurzübersicht — vollständiges Profil für Dokumente & Details",
          "Résumé rapide — ouvrez le profil complet pour documents et détails")}
        footer={peek ? (
          <>
            <GhostButton onClick={() => setPeek(null)}>{T("Close", "Schließen", "Fermer")}</GhostButton>
            <GoldButton onClick={() => { const id = peek.userId; setPeek(null); router.push(`/portal/admin?nav_user_id=${encodeURIComponent(id)}`); }}>
              {T("Open full profile", "Profil öffnen", "Profil complet")} <ArrowRight size={14} strokeWidth={2.5} />
            </GoldButton>
          </>
        ) : null}>
        {peek && (() => {
          const b2s = normalizeB2Stage(peek.b2Stage);
          const imp = (peek.impfungStage ?? "not_required") as ImpfungStage;
          const impDef = imp !== "not_required" && imp !== "not_started" ? IMPFUNG_STAGE_BY_KEY[imp] : undefined;
          const pct = Math.round(peek.status.progress * 100);
          const hs = HEALTH_STYLE[peek.status.health];
          const journeyLine = peek.status.health === "done"
            ? T("Arrived in Germany 🇩🇪", "In Deutschland angekommen 🇩🇪", "Arrivé en Allemagne 🇩🇪")
            : peek.status.current ? presetLabel(peek.status.current.key, lang)
            : T("Just started", "Gerade begonnen", "Vient de commencer");
          const card: CSSProperties = { borderRadius: 16, border: "1px solid var(--border)", background: "var(--bg2)", padding: 16 };
          const cap: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--w3)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 };
          return (
            <div className="p-5 flex flex-col gap-4">
              {/* Identity */}
              <div className="flex items-center gap-3">
                {peek.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={peek.photo} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: 56, height: 56, border: `2px solid ${hs.dot}` }} />
                ) : (
                  <span className="rounded-full flex items-center justify-center flex-shrink-0 text-[18px] font-bold" style={{ width: 56, height: 56, background: "var(--gdim)", color: "var(--gold)", border: `2px solid ${hs.dot}` }}>{initials(peek.name)}</span>
                )}
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold truncate" style={{ color: "var(--w)" }}>{peek.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${hs.dot} 16%, transparent)`, color: hs.dot }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: hs.dot }} /> {hs.label[lang as "en" | "fr" | "de"]}
                    </span>
                    {peek.sellable?.sellable && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--gold)", color: "#131312" }}>
                        <BadgeCheck size={10} strokeWidth={2.5} /> {T("READY TO SELL", "VERKAUFSBEREIT", "PRÊT À VENDRE")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Needs-follow-up banner + one-click reminder */}
              {peek.followUp?.needed && (
                <div style={{ borderRadius: 16, border: "1px solid color-mix(in srgb, #f59e0b 45%, var(--border))", background: "color-mix(in srgb, #f59e0b 10%, transparent)", padding: 16 }}>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={15} style={{ color: "#f59e0b" }} />
                    <span className="text-[13px] font-bold" style={{ color: "var(--w)" }}>{T("Needs follow-up", "Nachfassen nötig", "À relancer")}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {peek.followUp.reasons.map((reason) => (
                      <span key={reason} className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                        {reason === "blocked" ? T("Blocked", "Blockiert", "Bloqué")
                          : reason === "overdue" ? T("Overdue step", "Überfälliger Schritt", "Étape en retard")
                          : T("Rejected document", "Abgelehntes Dokument", "Document rejeté")}
                      </span>
                    ))}
                  </div>
                  <button onClick={() => sendNudge(peek.userId)} disabled={nudging || nudged === peek.userId}
                    className="bv-press inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg disabled:opacity-70"
                    style={nudged === peek.userId
                      ? { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }
                      : { background: "#f59e0b", color: "#131312" }}>
                    {nudged === peek.userId
                      ? <><CheckCircle2 size={14} strokeWidth={2.2} /> {T("Reminder sent", "Erinnerung gesendet", "Rappel envoyé")}</>
                      : <><Bell size={14} strokeWidth={2.2} /> {nudging ? T("Sending…", "Senden…", "Envoi…") : T("Send reminder", "Erinnerung senden", "Envoyer un rappel")}</>}
                  </button>
                </div>
              )}

              {/* Journey */}
              <div style={card}>
                <div style={cap}>🗺️ {T("Journey", "Reise", "Parcours")}</div>
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: hs.dot, flexShrink: 0 }} />
                  <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{journeyLine}</span>
                </div>
                <div style={{ height: 7, borderRadius: 999, background: "var(--border)", overflow: "hidden", marginBottom: 7 }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: hs.dot }} />
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[11.5px]" style={{ color: "var(--w3)" }}>
                  <span>{peek.status.doneCount}/{peek.status.totalPresets} {T("steps done", "Schritte erledigt", "étapes faites")}</span>
                  {peek.status.overdueCount > 0 && <span style={{ color: "#f97316" }}>· {peek.status.overdueCount} {T("overdue", "überfällig", "en retard")}</span>}
                  {peek.status.blockedCount > 0 && <span style={{ color: "#ef4444" }}>· {peek.status.blockedCount} {T("blocked", "blockiert", "bloqué")}</span>}
                </div>
              </div>

              {/* Open tasks — what's still outstanding for them */}
              {peek.openTasks && peek.openTasks.length > 0 && (
                <div style={card}>
                  <div style={cap}>📋 {T("Open tasks", "Offene Aufgaben", "Tâches ouvertes")}</div>
                  <div className="flex flex-col gap-2">
                    {peek.openTasks.map((task, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--w2)" }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: task.blocked ? "#ef4444" : "var(--w3)", flexShrink: 0 }} />
                        <span className="truncate">{task.key ? presetLabel(task.key, lang) : (task.text || "—")}</span>
                        {task.blocked && <AlertTriangle size={11} style={{ color: "#ef4444", flexShrink: 0 }} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* B2 German */}
              <div style={card}>
                <div style={cap}>📜 {T("B2 German", "B2 Deutsch", "B2 allemand")}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: b2StageColor(b2s), flexShrink: 0 }} />
                  <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{b2StageLabel(b2s, lang)}</span>
                  {peek.b2Failed && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${B2_FAILED_COLOR} 18%, transparent)`, color: B2_FAILED_COLOR }}>
                      {T("FAILED BEFORE · RETAKING", "NICHT BESTANDEN · WIEDERHOLUNG", "ÉCHOUÉ · REPRISE")}
                    </span>
                  )}
                </div>
              </div>

              {/* Impfung */}
              <div style={card}>
                <div style={cap}>💉 {T("Impfung", "Impfung", "Vaccination")}</div>
                {imp === "not_required" ? (
                  <span className="text-[12.5px]" style={{ color: "var(--w3)" }}>{T("Not required by their agency", "Von der Agentur nicht verlangt", "Non requis par leur agence")}</span>
                ) : imp === "not_started" ? (
                  <div className="flex items-center gap-2">
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--w3)", flexShrink: 0 }} />
                    <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{T("Required — not started", "Erforderlich — nicht begonnen", "Requis — pas commencé")}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: impDef?.color ?? "var(--w3)", flexShrink: 0 }} />
                    <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{impfungStageLabel(imp, lang)}</span>
                    {peek.impfungDoses && peek.impfungDoses.need > 0 && (
                      <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--border)", color: "var(--w2)" }}>{peek.impfungDoses.got}/{peek.impfungDoses.need} {T("doses", "Dosen", "doses")}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>
    </main>
  );
}
