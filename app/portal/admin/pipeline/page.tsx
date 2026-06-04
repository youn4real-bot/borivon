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
import { CandidateTable } from "@/components/CandidateTable";
import { Modal, GoldButton, GhostButton } from "@/components/ui/Modal";
import { normalizeB2Stage, b2StageLabel, b2StageColor, B2_FAILED_COLOR } from "@/lib/b2Journey";
import { normalizeAnerkennungStage, anerkennungStageLabel, anerkennungStageColor } from "@/lib/anerkennungJourney";
import { impfungStageLabel, IMPFUNG_STAGE_BY_KEY, type ImpfungStage } from "@/lib/impfungJourney";
import { NURSE_SPECIALTIES, specialtyLabel } from "@/lib/nurseSpecialties";
import { recognitionDocLabel } from "@/lib/recognitionDocs";
import { relativeTimeShort } from "@/lib/relativeTime";
import { Toaster, toast } from "sonner";
import { ArrowLeft, AlertTriangle, CheckCircle2, Search, Map as MapIcon, LayoutGrid, BadgeCheck, ArrowRight, Bell, FileText, Printer, Pencil, ChevronDown } from "lucide-react";

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
type Facts = { specialty: string | null; yearsExperience: number | null; workplace: string | null; availableFrom: string | null };
type DocPackItem = { key: string; status: "approved" | "pending" | "missing" };
type DocPack = { items: DocPackItem[]; collected: number; total: number };
type SelfReport = { kind: string; outcome: string; note: string | null; created_at: string };
type Row = { userId: string; name: string; photo: string | null; status: Status; sellable: Sellable; b2Stage?: string; b2Failed?: boolean; anerkennungStage?: string; impfungStage?: string; impfungDoses?: { got: number; need: number }; followUp?: FollowUp; openTasks?: OpenTask[]; facts?: Facts; docPack?: DocPack; reports?: SelfReport[] };

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
  const [view, setView] = useState<"board" | "map">("board");
  const [track, setTrack] = useState<"journey" | "b2">("journey");
  const [sheetOpen, setSheetOpen] = useState(false); // employer profile sheet
  // Clicking a candidate opens a quick cross-track summary (peek) — NOT a jump
  // straight to their dossier. The dossier is one button away inside the popup.
  const [peek, setPeek] = useState<Row | null>(null);
  const [nudging, setNudging] = useState(false);
  const [nudged, setNudged] = useState<string | null>(null); // userId whose reminder just sent
  // Editable nurse-profile facts (specialty/experience) for the peeked candidate.
  const [factsDraft, setFactsDraft] = useState({ specialty: "", years: "", workplace: "", availableFrom: "" });
  const [factsSaving, setFactsSaving] = useState(false);
  const [factsEdit, setFactsEdit] = useState(false); // nurse-profile editor open?
  const [docsOpen, setDocsOpen] = useState(false);    // recognition-docs details open?

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
    if (!needle) return rows;
    return rows.filter((r) => `${r.name} ${specialtyLabel(r.facts?.specialty, lang)} ${r.facts?.specialty ?? ""} ${r.facts?.workplace ?? ""}`.toLowerCase().includes(needle));
  }, [rows, q, lang]);

  // The B2 / Impfung tracks ignore the journey-specific filter tabs (sellable /
  // attention) — those are about the main journey. They respect only the search.
  const searchOnlyRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => `${r.name} ${specialtyLabel(r.facts?.specialty, lang)} ${r.facts?.specialty ?? ""} ${r.facts?.workplace ?? ""}`.toLowerCase().includes(needle));
  }, [rows, q, lang]);

  // Sync the editable nurse-facts form whenever a different candidate is peeked.
  useEffect(() => {
    if (!peek) return;
    setFactsDraft({
      specialty: peek.facts?.specialty ?? "",
      years: peek.facts?.yearsExperience != null ? String(peek.facts.yearsExperience) : "",
      workplace: peek.facts?.workplace ?? "",
      availableFrom: peek.facts?.availableFrom ?? "",
    });
    setFactsEdit(false);
    setDocsOpen(false);
  }, [peek]);

  // Drag-and-drop: drop a face on a stage lane to move them. Optimistic (instant
  // glide via Motion) → persist to the right route (B2 or Anerkennung, both gated
  // by LAW #25) → roll back on failure. Branches on the currently shown track.
  const moveStage = async (userId: string, toStage: string) => {
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
      if (!res.ok) { setRows(snapshot); toast.error(T("Couldn't move — try again", "Verschieben fehlgeschlagen", "Déplacement échoué")); }
    } catch {
      setRows(snapshot);
      toast.error(T("Couldn't move — try again", "Verschieben fehlgeschlagen", "Déplacement échoué"));
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
      if (res.ok) { setNudged(userId); toast.success(T("Reminder sent", "Erinnerung gesendet", "Rappel envoyé")); }
      else toast.error(T("Couldn't send reminder", "Senden fehlgeschlagen", "Échec de l'envoi"));
    } catch { toast.error(T("Couldn't send reminder", "Senden fehlgeschlagen", "Échec de l'envoi")); }
    setNudging(false);
  };

  const updateFact = (patch: Partial<typeof factsDraft>) => setFactsDraft((d) => ({ ...d, ...patch }));

  // Persist nurse profile facts (specialty / experience / workplace / availability).
  const saveFacts = async () => {
    if (!peek) return;
    const id = peek.userId;
    setFactsSaving(true);
    const payload = {
      candidateId: id,
      specialty: factsDraft.specialty || null,
      yearsExperience: factsDraft.years === "" ? null : Number(factsDraft.years),
      workplace: factsDraft.workplace,
      availableFrom: factsDraft.availableFrom || null,
    };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/portal/journey/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const newFacts: Facts = { specialty: payload.specialty, yearsExperience: payload.yearsExperience, workplace: payload.workplace || null, availableFrom: payload.availableFrom };
        setRows((rs) => rs.map((r) => (r.userId === id ? { ...r, facts: newFacts } : r)));
        setPeek((p) => (p && p.userId === id ? { ...p, facts: newFacts } : p));
        setFactsEdit(false);
        toast.success(T("Profile saved", "Profil gespeichert", "Profil enregistré"));
      } else {
        toast.error(T("Couldn't save", "Speichern fehlgeschlagen", "Échec de l'enregistrement"));
      }
    } catch { toast.error(T("Couldn't save", "Speichern fehlgeschlagen", "Échec de l'enregistrement")); }
    setFactsSaving(false);
  };

  if (loading) return <PageLoader />;

  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";

  // Two views only: Board (unified grid, default) + Map (the visual rail).
  const viewOpts: [("board" | "map"), typeof MapIcon, string][] = [
    ["board", LayoutGrid, T("Board", "Tafel", "Tableau")],
    ["map", MapIcon, T("Map", "Karte", "Carte")],
  ];

  return (
    <main id="bv-main" className="mx-auto px-4 sm:px-5 py-6 sm:py-10 bv-page-bottom" style={{ maxWidth: 1080 }}>
      <button onClick={() => router.push("/portal/admin")} className="bv-btn bv-btn-ghost mb-5 inline-flex">
        <ArrowLeft size={15} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
      </button>

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="bv-h1">{T("Pipeline", "Pipeline", "Pipeline")}</h1>
        {/* Track switcher — only for the per-track Map/List views (the Board is
            track-independent, so it's hidden there). */}
        {view !== "board" && (
          <div className="inline-flex p-0.5 rounded-full" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
            {([
              ["journey", T("Journey", "Reise", "Parcours")],
              ["b2", T("B2 German", "B2 Deutsch", "B2 allemand")],
            ] as const).map(([v, label]) => (
              <button key={v} onClick={() => setTrack(v)}
                className="px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
                style={track === v ? { background: "var(--gold)", color: "#131312", boxShadow: "var(--shadow-gold-sm)" } : { background: "transparent", color: "var(--w3)" }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <Search size={15} className="absolute" style={{ left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} className="bv-input" style={{ paddingLeft: 36 }}
            placeholder={T("Search candidate…", "Kandidat suchen…", "Rechercher…")} />
        </div>
        {/* View toggle — Canvas (Figma board) / Map / List. Always available;
            List is journey-only. */}
        <div className="inline-flex p-0.5 rounded-full" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
          {viewOpts.map(([v, Icon, label]) => (
            <button key={v} onClick={() => setView(v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
              style={view === v ? { background: "var(--gold)", color: "#131312", boxShadow: "var(--shadow-gold-sm)" } : { background: "transparent", color: "var(--w3)" }}>
              <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Two views: Board (unified sortable grid) and Map (the visual rail). */}
      {view === "board" ? (
        <CandidateTable rows={shown} lang={lang} onPick={(uid) => setPeek(rows.find((r) => r.userId === uid) ?? null)} />
      ) : (
        <JourneyMap rows={track !== "journey" ? searchOnlyRows : shown} lang={lang} track={track}
          onPick={(uid) => setPeek(rows.find((r) => r.userId === uid) ?? null)}
          onMoveStage={moveStage} />
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
            <button onClick={() => setSheetOpen(true)}
              className="bv-press text-[12.5px] font-semibold px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5"
              style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
              <FileText size={14} /> {T("Employer sheet", "Arbeitgeber-Blatt", "Fiche employeur")}
            </button>
            <GoldButton onClick={() => { const id = peek.userId; setPeek(null); router.push(`/portal/admin?nav_user_id=${encodeURIComponent(id)}`); }}>
              {T("Open full profile", "Profil öffnen", "Profil complet")} <ArrowRight size={14} strokeWidth={2.5} />
            </GoldButton>
          </>
        ) : null}>
        {peek && (() => {
          const b2s = normalizeB2Stage(peek.b2Stage);
          const anerk = normalizeAnerkennungStage(peek.anerkennungStage);
          const imp = (peek.impfungStage ?? "not_required") as ImpfungStage;
          const impDef = imp !== "not_required" && imp !== "not_started" ? IMPFUNG_STAGE_BY_KEY[imp] : undefined;
          const pct = Math.round(peek.status.progress * 100);
          const hs = HEALTH_STYLE[peek.status.health];
          const journeyLine = peek.status.health === "done"
            ? T("Arrived in Germany 🇩🇪", "In Deutschland angekommen 🇩🇪", "Arrivé en Allemagne 🇩🇪")
            : peek.status.current ? presetLabel(peek.status.current.key, lang)
            : T("Just started", "Gerade begonnen", "Vient de commencer");
          const card: CSSProperties = { borderRadius: 16, border: "1px solid var(--border)", background: "var(--bg2)", padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" };
          const cap: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--w3)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 };
          const lbl: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--w3)", marginBottom: 4, display: "block" };
          const reportLabel = (rep: SelfReport) => {
            if (rep.kind === "b2") return rep.outcome === "passed" ? T("Passed B2 🎉", "B2 bestanden 🎉", "B2 réussi 🎉") : T("Didn't pass B2 — retaking", "B2 nicht bestanden", "B2 non réussi");
            if (rep.kind === "interview") return rep.outcome === "passed" ? T("Passed an interview ✅", "Gespräch bestanden ✅", "Entretien réussi ✅")
              : rep.outcome === "scheduled" ? T("Interview scheduled 📅", "Gespräch geplant 📅", "Entretien planifié 📅")
              : T("Interview didn't pass", "Gespräch nicht bestanden", "Entretien non réussi");
            return rep.note || T("Update", "Update", "Mise à jour");
          };
          return (
            <div className="p-5 flex flex-col gap-3">
              {/* Identity */}
              <div className="flex items-center gap-3.5 pb-3 mb-0.5" style={{ borderBottom: "1px solid var(--border)" }}>
                {peek.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={peek.photo} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: 60, height: 60, border: `2.5px solid ${hs.dot}`, boxShadow: `0 0 0 4px color-mix(in srgb, ${hs.dot} 14%, transparent)` }} />
                ) : (
                  <span className="rounded-full flex items-center justify-center flex-shrink-0 text-[20px] font-bold" style={{ width: 60, height: 60, background: "var(--gdim)", color: "var(--gold)", border: `2.5px solid ${hs.dot}`, boxShadow: `0 0 0 4px color-mix(in srgb, ${hs.dot} 14%, transparent)` }}>{initials(peek.name)}</span>
                )}
                <div className="min-w-0">
                  <p className="text-[16px] font-bold tracking-[-0.01em] truncate" style={{ color: "var(--w)" }}>{peek.name}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
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

              {/* Nurse profile — one compact line; click to edit (progressive disclosure). */}
              {!factsEdit ? (
                <button onClick={() => setFactsEdit(true)}
                  className="bv-press w-full text-left flex items-center gap-2 text-[12.5px] px-3 py-2.5 rounded-xl"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w2)" }}>
                  <span style={{ flexShrink: 0 }}>🩺</span>
                  <span className="flex-1 truncate">
                    {[
                      peek.facts?.specialty ? specialtyLabel(peek.facts.specialty, lang) : null,
                      peek.facts?.yearsExperience != null ? `${peek.facts.yearsExperience} ${T("yrs", "J.", "ans")}` : null,
                      peek.facts?.workplace || null,
                      peek.facts?.availableFrom ? `${T("from", "ab", "dès")} ${peek.facts.availableFrom}` : null,
                    ].filter(Boolean).join("  ·  ") || T("Add nurse details", "Pflegedetails hinzufügen", "Ajouter des détails")}
                  </span>
                  <Pencil size={13} style={{ color: "var(--w3)", flexShrink: 0 }} />
                </button>
              ) : (
                <div style={card}>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="col-span-2">
                      <label style={lbl}>{T("Specialty", "Fachbereich", "Spécialité")}</label>
                      <select className="bv-input" value={factsDraft.specialty} onChange={(e) => updateFact({ specialty: e.target.value })} style={{ fontSize: 12.5 }}>
                        <option value="">{T("— none set —", "— keine —", "— aucune —")}</option>
                        {NURSE_SPECIALTIES.map((s) => <option key={s.key} value={s.key}>{specialtyLabel(s.key, lang)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>{T("Years", "Jahre", "Années")}</label>
                      <input className="bv-input" type="number" min={0} max={60} value={factsDraft.years} onChange={(e) => updateFact({ years: e.target.value })} style={{ fontSize: 12.5 }} />
                    </div>
                    <div>
                      <label style={lbl}>{T("Available from", "Verfügbar ab", "Disponible dès")}</label>
                      <input className="bv-input" type="date" value={factsDraft.availableFrom} onChange={(e) => updateFact({ availableFrom: e.target.value })} style={{ fontSize: 12.5 }} />
                    </div>
                    <div className="col-span-2">
                      <label style={lbl}>{T("Current workplace", "Aktueller Arbeitsplatz", "Lieu de travail actuel")}</label>
                      <input className="bv-input" type="text" maxLength={120} value={factsDraft.workplace} onChange={(e) => updateFact({ workplace: e.target.value })}
                        placeholder={T("e.g. CHU Ibn Sina — ICU", "z. B. CHU Ibn Sina — Intensiv", "ex. CHU Ibn Sina — soins intensifs")} style={{ fontSize: 12.5 }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => void saveFacts()} disabled={factsSaving}
                      className="bv-press inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60"
                      style={{ background: "var(--gold)", color: "#131312" }}>
                      {factsSaving ? T("Saving…", "Speichern…", "Enregistrement…") : T("Save", "Speichern", "Enregistrer")}
                    </button>
                    <button onClick={() => setFactsEdit(false)} className="bv-press text-[12px] font-medium px-3 py-1.5" style={{ color: "var(--w3)" }}>
                      {T("Cancel", "Abbrechen", "Annuler")}
                    </button>
                  </div>
                </div>
              )}

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

              {/* Candidate updates — what they self-reported (passed B2, interview…) */}
              {peek.reports && peek.reports.length > 0 && (
                <div style={card}>
                  <div style={cap}>🗣️ {T("Candidate updates", "Kandidaten-Updates", "Mises à jour du candidat")}</div>
                  <div className="flex flex-col gap-2">
                    {peek.reports.map((rep, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[12.5px]" style={{ color: "var(--w2)" }}>
                        <span className="truncate">{reportLabel(rep)}</span>
                        <span className="flex-shrink-0" style={{ color: "var(--w3)", fontSize: 11 }}>{relativeTimeShort(rep.created_at, lang)}</span>
                      </div>
                    ))}
                  </div>
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

              {/* Status — B2 / Anerkennung / Impfung at a glance (one card). */}
              <div style={card}>
                <div style={cap}>{T("Status", "Status", "Statut")}</div>
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: b2StageColor(b2s), flexShrink: 0 }} />
                    <span style={{ color: "var(--w3)", fontWeight: 600, width: 86, flexShrink: 0 }}>📜 {T("B2", "B2", "B2")}</span>
                    <span className="truncate" style={{ color: "var(--w)", fontWeight: 600 }}>{b2StageLabel(b2s, lang)}</span>
                    {peek.b2Failed && <span style={{ color: B2_FAILED_COLOR, fontWeight: 700, flexShrink: 0 }}>· ↺</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: anerkennungStageColor(anerk), flexShrink: 0 }} />
                    <span style={{ color: "var(--w3)", fontWeight: 600, width: 86, flexShrink: 0 }}>🏅 {T("Anerk.", "Anerk.", "Reconn.")}</span>
                    <span className="truncate" style={{ color: "var(--w)", fontWeight: 600 }}>{anerkennungStageLabel(anerk, lang)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: imp === "not_required" || imp === "not_started" ? "var(--w3)" : (impDef?.color ?? "var(--w3)"), flexShrink: 0 }} />
                    <span style={{ color: "var(--w3)", fontWeight: 600, width: 86, flexShrink: 0 }}>💉 {T("Impf.", "Impf.", "Vacc.")}</span>
                    <span className="truncate" style={{ color: "var(--w)", fontWeight: 600 }}>
                      {imp === "not_required" ? T("Not required", "Nicht erforderlich", "Non requis")
                        : imp === "not_started" ? T("Required — not started", "Erforderlich — offen", "Requis — à faire")
                        : impfungStageLabel(imp, lang)}
                      {imp !== "not_required" && peek.impfungDoses && peek.impfungDoses.need > 0 ? ` · ${peek.impfungDoses.got}/${peek.impfungDoses.need}` : ""}
                    </span>
                  </div>
                </div>
              </div>

              {/* Recognition documents — compact bar; click for the checklist. */}
              {peek.docPack && (
                <div style={card}>
                  <button onClick={() => setDocsOpen((o) => !o)} className="bv-press w-full flex items-center gap-2.5">
                    <span style={{ fontSize: 12.5 }}>📂</span>
                    <div style={{ flex: 1, height: 7, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
                      <div style={{ width: `${peek.docPack.total ? Math.round((peek.docPack.collected / peek.docPack.total) * 100) : 0}%`, height: "100%", background: "var(--gold)" }} />
                    </div>
                    <span className="text-[11.5px] font-semibold" style={{ color: "var(--w2)", flexShrink: 0 }}>{peek.docPack.collected}/{peek.docPack.total}</span>
                    <ChevronDown size={14} style={{ color: "var(--w3)", flexShrink: 0, transform: docsOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                  </button>
                  {docsOpen && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3">
                      {peek.docPack.items.map((it) => (
                        <div key={it.key} className="flex items-center gap-1.5 text-[12px]" style={{ color: it.status === "missing" ? "var(--w3)" : "var(--w2)" }}>
                          <span style={{ flexShrink: 0 }}>{it.status === "approved" ? "✅" : it.status === "pending" ? "🕓" : "⬜"}</span>
                          <span className="truncate">{recognitionDocLabel(it.key, lang)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Employer-ready profile sheet — clean, identity-safe, printable one-pager. */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} size="md"
        title={T("Employer profile sheet", "Arbeitgeber-Profil", "Fiche profil employeur")}
        footer={peek ? (
          <>
            <GhostButton onClick={() => setSheetOpen(false)}>{T("Close", "Schließen", "Fermer")}</GhostButton>
            <GoldButton onClick={() => window.print()}><Printer size={14} strokeWidth={2.2} /> {T("Print / Save PDF", "Drucken / PDF", "Imprimer / PDF")}</GoldButton>
          </>
        ) : null}>
        {peek && (() => {
          const b2s = normalizeB2Stage(peek.b2Stage);
          const anerk = normalizeAnerkennungStage(peek.anerkennungStage);
          const imp = (peek.impfungStage ?? "not_required") as ImpfungStage;
          const fct = peek.facts;
          const pct = peek.docPack && peek.docPack.total ? Math.round((peek.docPack.collected / peek.docPack.total) * 100) : 0;
          const rowS: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--border)", fontSize: 13 };
          const k: CSSProperties = { color: "var(--w3)", fontWeight: 600 };
          const val: CSSProperties = { color: "var(--w)", fontWeight: 700, textAlign: "right" };
          return (
            <div data-employer-sheet style={{ padding: 24 }}>
              <style>{`@media print { body * { visibility: hidden !important; } [data-employer-sheet], [data-employer-sheet] * { visibility: visible !important; color: #111 !important; } [data-employer-sheet] { position: fixed !important; inset: 0 !important; margin: 0 !important; padding: 28px !important; background: #fff !important; } }`}</style>
              {/* Brand header — Borivon, never an individual admin (LAW). */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, paddingBottom: 14, borderBottom: "2px solid var(--gold)" }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "var(--gold)", letterSpacing: -0.5 }}>Borivon</div>
                  <div style={{ fontSize: 11, color: "var(--w3)" }}>{T("Vetted nursing candidate", "Geprüfte Pflegekraft", "Candidat infirmier vérifié")}</div>
                </div>
                {peek.sellable?.sellable && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: "var(--gold)", color: "#131312" }}>
                    <BadgeCheck size={11} strokeWidth={2.5} /> {T("READY", "BEREIT", "PRÊT")}
                  </span>
                )}
              </div>
              {/* Identity */}
              <div className="flex items-center gap-3.5 mb-4">
                {peek.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={peek.photo} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: 68, height: 68, border: "2px solid var(--gold)" }} />
                ) : (
                  <span className="rounded-full flex items-center justify-center flex-shrink-0 text-[22px] font-bold" style={{ width: 68, height: 68, background: "var(--gdim)", color: "var(--gold)", border: "2px solid var(--gold)" }}>{initials(peek.name)}</span>
                )}
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--w)" }}>{peek.name}</div>
                  <div style={{ fontSize: 13, color: "var(--gold)", fontWeight: 600 }}>{fct?.specialty ? specialtyLabel(fct.specialty, lang) : T("Nurse", "Pflegekraft", "Infirmier")}</div>
                </div>
              </div>
              {/* Facts */}
              <div>
                <div style={rowS}><span style={k}>{T("Specialty", "Fachbereich", "Spécialité")}</span><span style={val}>{fct?.specialty ? specialtyLabel(fct.specialty, lang) : "—"}</span></div>
                <div style={rowS}><span style={k}>{T("Experience", "Erfahrung", "Expérience")}</span><span style={val}>{fct?.yearsExperience != null ? `${fct.yearsExperience} ${T("years", "Jahre", "ans")}` : "—"}</span></div>
                <div style={rowS}><span style={k}>{T("German level (B2)", "Deutsch (B2)", "Allemand (B2)")}</span><span style={val}>{b2StageLabel(b2s, lang)}</span></div>
                <div style={rowS}><span style={k}>{T("Recognition", "Anerkennung", "Reconnaissance")}</span><span style={val}>{anerkennungStageLabel(anerk, lang)}</span></div>
                <div style={rowS}><span style={k}>{T("Vaccination", "Impfung", "Vaccination")}</span><span style={val}>{imp === "not_required" ? T("Not required", "Nicht erforderlich", "Non requis") : impfungStageLabel(imp, lang)}</span></div>
                <div style={rowS}><span style={k}>{T("Documents ready", "Dokumente bereit", "Documents prêts")}</span><span style={val}>{peek.docPack ? `${peek.docPack.collected}/${peek.docPack.total} (${pct}%)` : "—"}</span></div>
                <div style={{ ...rowS, borderBottom: "none" }}><span style={k}>{T("Available from", "Verfügbar ab", "Disponible dès")}</span><span style={val}>{fct?.availableFrom || "—"}</span></div>
              </div>
              <div style={{ marginTop: 16, fontSize: 10, color: "var(--w3)", textAlign: "center" }}>
                {T("Confidential — shared by Borivon. Contact us to proceed with this candidate.",
                   "Vertraulich — von Borivon bereitgestellt. Kontaktieren Sie uns für diesen Kandidaten.",
                   "Confidentiel — partagé par Borivon. Contactez-nous pour ce candidat.")}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Smooth, battle-tested toasts (sonner) for save / reminder / move feedback. */}
      <Toaster theme="dark" position="top-center" richColors toastOptions={{ style: { fontSize: "13px" } }} />
    </main>
  );
}
