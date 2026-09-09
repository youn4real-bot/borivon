"use client";

/**
 * /portal/admin/documents — the document-set workbench.
 *
 * ONE place to build the document lists candidates get, instead of doing it
 * buried inside a single candidate's dossier. Pick a scope (everyone / an
 * agency / one site), pick a phase (Bearbeitung / Visum), then name the
 * documents. Every candidate in that scope inherits them automatically:
 * a candidate at UKSH Kiel gets the Calmaroi batch list PLUS Kiel's extras.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Plus, Trash2, Check, X as XIcon, Users, Building2, Globe } from "lucide-react";
import { PageLoader, Spinner, EmptyState } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { FileText } from "lucide-react";

type Org = { id: string; name: string };
type Employer = { id: string; name: string; agencyId?: string | null };
type Slot = { id: string; label: string; position: number; is_required?: boolean | null; type?: string | null };

type Scope =
  | { kind: "global" }
  | { kind: "org"; id: string; name: string }
  | { kind: "emp"; id: string; name: string };

const PHASES = ["bearbeitung", "visum"] as const;
type Phase = (typeof PHASES)[number];

export default function AdminDocumentsPage() {
  const router = useRouter();
  const { lang } = useLang();
  const L = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);

  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [employers, setEmployers] = useState<Employer[]>([]);

  const [scope, setScope] = useState<Scope>({ kind: "global" });
  const [phase, setPhase] = useState<Phase>("bearbeitung");

  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Bootstrap: role gate + the scope lists ────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const t = session.access_token ?? "";
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${t}` } });
      const j = await roleRes.json().catch(() => ({ role: null }));
      if (j?.role !== "admin" && j?.role !== "sub_admin") { router.replace("/portal"); return; }
      setToken(t);
      const [oRes, eRes] = await Promise.all([
        fetch("/api/portal/admin/organizations", { headers: { Authorization: `Bearer ${t}` } }),
        fetch("/api/portal/admin/employers", { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      const oJson = await oRes.json().catch(() => ({}));
      const eJson = await eRes.json().catch(() => ({}));
      setOrgs((oJson.orgs ?? []) as Org[]);
      setEmployers((eJson.employers ?? []) as Employer[]);
      setLoading(false);
    });
  }, [router]);

  // ── Load the selected scope's slots ───────────────────────────────────────
  const loadSlots = useCallback(async (t: string, sc: Scope, ph: Phase) => {
    if (!t) return;
    setSlotsLoading(true);
    try {
      const qs = sc.kind === "org" ? `phase=${ph}&orgId=${sc.id}`
        : sc.kind === "emp" ? `phase=${ph}&employerId=${sc.id}`
        : `phase=${ph}`;
      const res = await fetch(`/api/portal/phase-slots?${qs}`, { headers: { Authorization: `Bearer ${t}` } });
      const j = res.ok ? await res.json() : { slots: [] };
      setSlots(((j.slots ?? []) as Slot[]).slice().sort((a, b) => a.position - b.position));
    } catch { setSlots([]); }
    finally { setSlotsLoading(false); }
  }, []);

  useEffect(() => { if (token) void loadSlots(token, scope, phase); }, [token, scope, phase, loadSlots]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  async function addSlot() {
    const label = newLabel.trim();
    if (!label || !token) return;
    setAdding(true);
    try {
      const res = await fetch("/api/portal/phase-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          phase, type: "simple", label,
          // "Everyone" must be stated outright — the API refuses to infer a
          // portal-wide slot, since that reaches every agency's candidates.
          ...(scope.kind === "org" ? { orgId: scope.id }
            : scope.kind === "emp" ? { employerId: scope.id }
            : { global: true }),
        }),
      });
      if (res.ok) { setNewLabel(""); await loadSlots(token, scope, phase); }
    } finally { setAdding(false); }
  }

  async function renameSlot(id: string) {
    const label = editLabel.trim();
    if (!label || !token) { setEditingId(null); return; }
    setBusyId(id);
    try {
      await fetch("/api/portal/phase-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, label }),
      });
      setSlots(p => p.map(s => (s.id === id ? { ...s, label } : s)));
    } finally { setBusyId(null); setEditingId(null); }
  }

  async function toggleRequired(s: Slot) {
    if (!token) return;
    const next = s.is_required === false; // false → make required
    setBusyId(s.id);
    setSlots(p => p.map(x => (x.id === s.id ? { ...x, is_required: next } : x)));
    try {
      await fetch("/api/portal/phase-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: s.id, is_required: next }),
      });
    } catch {
      setSlots(p => p.map(x => (x.id === s.id ? { ...x, is_required: !next } : x))); // revert
    } finally { setBusyId(null); }
  }

  async function removeSlot(s: Slot) {
    if (!token) return;
    if (!window.confirm(L(
      `Delete "${s.label}" for EVERY candidate in this scope? Files already uploaded against it lose their place. This cannot be undone.`,
      `"${s.label}" für ALLE Kandidaten in diesem Bereich löschen? Bereits hochgeladene Dateien verlieren ihren Platz. Nicht umkehrbar.`,
      `Supprimer « ${s.label} » pour TOUS les candidats de ce périmètre ? Les fichiers déjà envoyés perdront leur emplacement. Irréversible.`,
    ))) return;
    const before = slots;
    setSlots(p => p.filter(x => x.id !== s.id));
    try {
      const r = await fetch("/api/portal/phase-slots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: s.id }),
      });
      if (!r.ok) setSlots(before);
    } catch { setSlots(before); }
  }

  if (loading) return <PageLoader />;

  const sitesOf = (orgId: string) => employers.filter(e => e.agencyId === orgId);
  const directEmployers = employers.filter(e => !e.agencyId);
  const isActive = (s: Scope) =>
    s.kind === scope.kind && (s.kind === "global" || ("id" in s && "id" in scope && s.id === scope.id));

  const chip = (label: string, s: Scope, icon?: React.ReactNode) => {
    const on = isActive(s);
    return (
      <button key={`${s.kind}-${"id" in s ? s.id : "global"}`} onClick={() => setScope(s)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-semibold transition-all"
        style={{
          background: on ? "var(--gold)" : "var(--bg2)",
          color: on ? "#131312" : "var(--w2)",
          border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`,
          cursor: "pointer",
        }}>
        {icon}{label}
      </button>
    );
  };

  const scopeTitle =
    scope.kind === "global" ? L("everyone", "alle Kandidaten", "tous les candidats") : scope.name;

  return (
    <>
      <PortalTopNav />
      <main className="min-h-dvh px-5 sm:px-8 py-8" style={{ background: "var(--bg)" }}>
        <div className="mx-auto w-full max-w-[860px]">

          <button onClick={() => router.push("/portal/admin")}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium mb-5"
            style={{ color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
            <ArrowLeft size={13} /> {L("Back to candidates", "Zurück zu Kandidaten", "Retour aux candidats")}
          </button>

          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--w)" }}>
            {L("Documents", "Dokumente", "Documents")}
          </h1>
          <p className="text-[12.5px] mt-1.5 mb-6" style={{ color: "var(--w3)" }}>
            {L("Build the document list once. Every candidate in the scope gets it automatically — a candidate at a site inherits their agency's list plus that site's extras.",
               "Dokumentliste einmal anlegen. Jede/r Kandidat/in im Bereich bekommt sie automatisch — an einem Standort zusätzlich zur Agenturliste.",
               "Composez la liste une fois. Chaque candidat du périmètre la reçoit automatiquement — sur un site, la liste de l'agence plus les ajouts du site.")}
          </p>

          {/* ── Scope ─────────────────────────────────────────────────────── */}
          <label className="block text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--w3)" }}>
            {L("Who gets these documents", "Wer bekommt diese Dokumente", "Qui reçoit ces documents")}
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {chip(L("Everyone", "Alle Kandidaten", "Tous"), { kind: "global" }, <Globe size={12} />)}
            {orgs.map(o => chip(o.name, { kind: "org", id: o.id, name: o.name }, <Users size={12} />))}
          </div>
          {orgs.some(o => sitesOf(o.id).length > 0) && (
            <div className="flex flex-wrap gap-2 mb-2">
              {orgs.flatMap(o => sitesOf(o.id)).map(e =>
                chip(e.name, { kind: "emp", id: e.id, name: e.name }, <Building2 size={12} />))}
            </div>
          )}
          {directEmployers.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {directEmployers.map(e => chip(e.name, { kind: "emp", id: e.id, name: e.name }, <Building2 size={12} />))}
            </div>
          )}

          {/* ── Phase ─────────────────────────────────────────────────────── */}
          <div className="flex gap-2 mt-6 mb-4">
            {PHASES.map(p => {
              const on = phase === p;
              return (
                <button key={p} onClick={() => setPhase(p)}
                  className="px-4 py-2 rounded-xl text-[12.5px] font-semibold transition-all"
                  style={{
                    background: on ? "var(--gdim)" : "transparent",
                    color: on ? "var(--gold)" : "var(--w3)",
                    border: `1px solid ${on ? "var(--border-gold)" : "var(--border)"}`,
                    cursor: "pointer",
                  }}>
                  {p === "bearbeitung" ? "Bearbeitung" : "Visum"}
                </button>
              );
            })}
          </div>

          {/* ── Slots ─────────────────────────────────────────────────────── */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="px-4 py-2.5 text-[11px]" style={{ borderBottom: "1px solid var(--border)", color: "var(--w3)" }}>
              {L(`${phase === "bearbeitung" ? "Bearbeitung" : "Visum"} documents for ${scopeTitle}`,
                 `${phase === "bearbeitung" ? "Bearbeitung" : "Visum"}-Dokumente für ${scopeTitle}`,
                 `Documents ${phase === "bearbeitung" ? "Bearbeitung" : "Visum"} pour ${scopeTitle}`)}
            </div>

            {slotsLoading ? (
              <div className="py-10 flex justify-center"><Spinner size="sm" /></div>
            ) : slots.length === 0 ? (
              <div className="py-8">
                <EmptyState Icon={FileText}
                  title={L("No documents yet", "Noch keine Dokumente", "Aucun document")}
                  sub={L("Add the first one below — everyone in this scope will get it.",
                         "Unten das erste hinzufügen — alle in diesem Bereich bekommen es.",
                         "Ajoutez le premier ci-dessous — tout le périmètre le recevra.")} />
              </div>
            ) : (
              slots.map((s, i) => {
                const optional = s.is_required === false;
                return (
                  <div key={s.id} className="px-4 py-3 flex items-center gap-3"
                    style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <div className="flex-1 min-w-0">
                      {editingId === s.id ? (
                        <div className="flex items-center gap-2">
                          <input autoFocus value={editLabel} onChange={e => setEditLabel(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") void renameSlot(s.id); if (e.key === "Escape") setEditingId(null); }}
                            className="flex-1 px-2.5 py-1.5 text-[13px] outline-none"
                            style={{ background: "var(--bg2)", border: "1px solid var(--border-gold)", borderRadius: 8, color: "var(--w)" }} />
                          <button onClick={() => void renameSlot(s.id)} disabled={busyId === s.id}
                            className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{ background: "var(--gold)", color: "#131312", border: "none", cursor: "pointer" }}>
                            <Check size={13} strokeWidth={2.4} />
                          </button>
                          <button onClick={() => setEditingId(null)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)", cursor: "pointer" }}>
                            <XIcon size={13} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingId(s.id); setEditLabel(s.label); }}
                          className="text-left w-full"
                          style={{ background: "transparent", border: "none", cursor: "text", padding: 0 }}>
                          <span className="text-[13px] font-medium" style={{ color: "var(--w)" }}>{s.label}</span>
                        </button>
                      )}
                    </div>

                    {editingId !== s.id && (
                      <>
                        <button onClick={() => void toggleRequired(s)} disabled={busyId === s.id}
                          title={optional ? L("Optional — doesn't count toward the %", "Optional — zählt nicht für die %", "Optionnel — ne compte pas dans le %")
                                          : L("Required — counts toward the %", "Erforderlich — zählt für die %", "Requis — compte dans le %")}
                          className="px-2.5 py-1 rounded-full text-[10.5px] font-semibold flex-shrink-0"
                          style={{
                            background: optional ? "var(--bg2)" : "var(--gdim)",
                            color: optional ? "var(--w3)" : "var(--gold)",
                            border: `1px solid ${optional ? "var(--border)" : "var(--border-gold)"}`,
                            cursor: "pointer",
                          }}>
                          {optional ? L("Optional", "Optional", "Optionnel") : L("Required", "Erforderlich", "Requis")}
                        </button>
                        <button onClick={() => void removeSlot(s)}
                          className="bv-icon-btn bv-icon-btn--reject w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Trash2 size={13} strokeWidth={1.8} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}

            {/* Add */}
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: "1px solid var(--border)" }}>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void addSlot(); }}
                placeholder={L("Document name", "Dokumentname", "Nom du document")}
                className="flex-1 px-3 py-2 text-[13px] outline-none"
                style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--w)" }} />
              <button onClick={() => void addSlot()} disabled={adding || !newLabel.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-semibold disabled:opacity-50"
                style={{ background: "var(--gold)", color: "#131312", borderRadius: 10, border: "none", cursor: "pointer" }}>
                {adding ? <Spinner size="xs" color="#131312" /> : <Plus size={13} strokeWidth={2.4} />}
                {L("Add", "Hinzufügen", "Ajouter")}
              </button>
            </div>
          </div>

          <p className="text-[11px] mt-3" style={{ color: "var(--w3)" }}>
            {L("Tip: click a name to rename it. Renaming also renames the matching file for every candidate.",
               "Tipp: Auf einen Namen klicken zum Umbenennen — benennt auch die Datei jedes Kandidaten um.",
               "Astuce : cliquez sur un nom pour le renommer — renomme aussi le fichier de chaque candidat.")}
          </p>
        </div>
      </main>
    </>
  );
}
