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
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { meToken } from "@/lib/meApi";
import { Plus, Trash2, Check, X as XIcon, FileUp } from "lucide-react";
import { PageLoader, Spinner } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { FileText } from "lucide-react";
import { PageHead, Btn, Card, Seg, Field, Empty, Pager, usePaged, STATUS_TINT } from "@/components/fx/kit";

type Org = { id: string; name: string };
type Employer = { id: string; name: string; agencyId?: string | null };
type Slot = { id: string; label: string; position: number; is_required?: boolean | null; type?: string | null; template_pdf_path?: string | null };

type Scope =
  | { kind: "global" }
  | { kind: "org"; id: string; name: string }
  | { kind: "emp"; id: string; name: string };

const PHASES = ["bearbeitung", "visum"] as const;
type Phase = (typeof PHASES)[number];

// The token in state is only the one read at mount — it expires after ~1h.
// meToken() goes through getSession(), which refreshes an expired JWT, so a
// tab left open (or reopened later) keeps working instead of 401-ing.
const freshToken = async (fallback: string) => (await meToken()) || fallback;

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
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Blank-form upload: one hidden file input, aimed at whichever slot was clicked.
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingTplRef = useRef<Slot | null>(null);

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
      const res = await fetch(`/api/portal/phase-slots?${qs}`, { headers: { Authorization: `Bearer ${await freshToken(t)}` } });
      // A refused load must not read as "this scope has no documents" — that
      // invites the admin to re-add what already exists.
      if (!res.ok) { setSlots([]); setLoadFailed(true); return; }
      const j = await res.json();
      setLoadFailed(false);
      setSlots(((j.slots ?? []) as Slot[]).slice().sort((a, b) => a.position - b.position));
    } catch { setSlots([]); setLoadFailed(true); }
    finally { setSlotsLoading(false); }
  }, []);

  useEffect(() => { if (token) void loadSlots(token, scope, phase); }, [token, scope, phase, loadSlots]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  async function addSlot() {
    const label = newLabel.trim();
    if (!label || !token) return;
    setAdding(true); setSaveFailed(false);
    try {
      const res = await fetch("/api/portal/phase-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await freshToken(token)}` },
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
      else setSaveFailed(true);
    } catch { setSaveFailed(true); }
    finally { setAdding(false); }
  }

  async function renameSlot(id: string) {
    const label = editLabel.trim();
    if (!label || !token) { setEditingId(null); return; }
    setBusyId(id); setSaveFailed(false);
    try {
      const res = await fetch("/api/portal/phase-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await freshToken(token)}` },
        body: JSON.stringify({ id, label }),
      });
      // Only show the new label once the server has it.
      if (res.ok) setSlots(p => p.map(s => (s.id === id ? { ...s, label } : s)));
      else setSaveFailed(true);
    } catch { setSaveFailed(true); }
    finally { setBusyId(null); setEditingId(null); }
  }

  async function toggleRequired(s: Slot) {
    if (!token) return;
    const next = s.is_required === false; // false → make required
    const revert = () => setSlots(p => p.map(x => (x.id === s.id ? { ...x, is_required: !next } : x)));
    setBusyId(s.id); setSaveFailed(false);
    setSlots(p => p.map(x => (x.id === s.id ? { ...x, is_required: next } : x)));
    try {
      const res = await fetch("/api/portal/phase-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await freshToken(token)}` },
        body: JSON.stringify({ id: s.id, is_required: next }),
      });
      if (!res.ok) { revert(); setSaveFailed(true); }
    } catch {
      revert(); setSaveFailed(true);
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
    setSaveFailed(false);
    setSlots(p => p.filter(x => x.id !== s.id));
    try {
      const r = await fetch("/api/portal/phase-slots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await freshToken(token)}` },
        body: JSON.stringify({ id: s.id }),
      });
      if (!r.ok) { setSlots(before); setSaveFailed(true); }
    } catch { setSlots(before); setSaveFailed(true); }
  }

  /**
   * The BLANK form every candidate in this scope downloads from the slot's ⋯ menu.
   * This page is the only place a template is set — never from inside one
   * candidate's dossier, where a filled-in copy once replaced the blank form and
   * was offered to every Calmaroi candidate (found + quarantined 2026-09-11).
   * The server archives the previous version before replacing it (LAW #33).
   */
  function pickTemplate(s: Slot) {
    if (!window.confirm(L(
      `Upload the BLANK "${s.label}" form? Every candidate in ${scopeTitle} will be able to download it — it must not contain anyone's name or personal details.`,
      `Das LEERE Formular „${s.label}" hochladen? Alle Kandidaten in ${scopeTitle} können es herunterladen — es darf keine Namen oder persönlichen Daten enthalten.`,
      `Téléverser le formulaire VIERGE « ${s.label} » ? Tous les candidats de ${scopeTitle} pourront le télécharger — il ne doit contenir aucun nom ni donnée personnelle.`,
    ))) return;
    pendingTplRef.current = s;
    fileRef.current?.click();
  }

  async function uploadTemplate(file: File) {
    const s = pendingTplRef.current;
    pendingTplRef.current = null;
    if (!s || !token) return;
    setBusyId(s.id); setSaveFailed(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("slotId", s.id);
      const res = await fetch("/api/portal/admin/slot-template", {
        method: "POST",
        headers: { Authorization: `Bearer ${await freshToken(token)}` },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) setSlots(p => p.map(x => (x.id === s.id ? { ...x, template_pdf_path: (j as { path?: string }).path ?? `slot-templates/${s.id}.pdf` } : x)));
      else setSaveFailed(true);
    } catch { setSaveFailed(true); }
    finally { setBusyId(null); }
  }

  if (loading) return <PageLoader />;

  const sitesOf = (orgId: string) => employers.filter(e => e.agencyId === orgId);
  const directEmployers = employers.filter(e => !e.agencyId);

  // the scope picker is one select (same scopes as the old chips): "global" | "org:<id>" | "emp:<id>"
  const scopeValue = scope.kind === "global" ? "global" : `${scope.kind}:${scope.id}`;
  const pickScope = (v: string) => {
    if (v === "global") { setScope({ kind: "global" }); return; }
    const [kind, id] = [v.slice(0, v.indexOf(":")), v.slice(v.indexOf(":") + 1)];
    if (kind === "org") { const o = orgs.find(x => x.id === id); if (o) setScope({ kind: "org", id: o.id, name: o.name }); }
    else { const e = employers.find(x => x.id === id); if (e) setScope({ kind: "emp", id: e.id, name: e.name }); }
  };
  const orgSites = orgs.flatMap(o => sitesOf(o.id));

  const scopeTitle =
    scope.kind === "global" ? L("everyone", "alle Kandidaten", "tous les candidats") : scope.name;
  const phaseName = phase === "bearbeitung" ? "Bearbeitung" : "Visum";

  // the one design (founder 2026-11-13): serif head, phase as a segmented switch, scope as one field,
  // the documents as hairline rows that flip, one black "add" pill
  return (
    <>
      <PortalTopNav />
      <main className="min-h-dvh px-5 sm:px-8 py-8" style={{ background: "var(--bg)", paddingTop: 88 }}>
        <div className="mx-auto w-full max-w-[760px]">

          <PageHead back={{ label: L("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
            title={L("Documents", "Dokumente", "Documents")}
            sub={L("Build the list once — everyone in the scope gets it; a site adds its extras to the agency list.",
                   "Liste einmal anlegen — alle im Bereich bekommen sie; ein Standort ergänzt die Agenturliste.",
                   "Composez la liste une fois — tout le périmètre la reçoit ; un site complète la liste de l'agence.")}
            actions={<Seg value={phase} onChange={setPhase} options={PHASES.map(p => [p, p === "bearbeitung" ? "Bearbeitung" : "Visum"] as [Phase, string])} />} />

          {/* ── Scope ─────────────────────────────────────────────────────── */}
          <div style={{ marginBottom: 16 }}>
            <Field label={L("Who gets these documents", "Wer bekommt diese Dokumente", "Qui reçoit ces documents")}>
              <select className="bvk-input" value={scopeValue} onChange={e => pickScope(e.target.value)}>
                <option value="global">{L("Everyone", "Alle Kandidaten", "Tous")}</option>
                {orgs.length > 0 && (
                  <optgroup label={L("Agencies", "Agenturen", "Agences")}>
                    {orgs.map(o => <option key={o.id} value={`org:${o.id}`}>{o.name}</option>)}
                  </optgroup>
                )}
                {orgSites.length > 0 && (
                  <optgroup label={L("Sites", "Standorte", "Sites")}>
                    {orgSites.map(e => <option key={e.id} value={`emp:${e.id}`}>{e.name}</option>)}
                  </optgroup>
                )}
                {directEmployers.length > 0 && (
                  <optgroup label={L("Employers", "Arbeitgeber", "Employeurs")}>
                    {directEmployers.map(e => <option key={e.id} value={`emp:${e.id}`}>{e.name}</option>)}
                  </optgroup>
                )}
              </select>
            </Field>
          </div>

          {/* ── Slots ─────────────────────────────────────────────────────── */}
          <div style={{ fontSize: 12.5, color: "var(--w3)", margin: "0 0 8px 2px" }}>
            {L(`${phaseName} documents for ${scopeTitle}`,
               `${phaseName}-Dokumente für ${scopeTitle}`,
               `Documents ${phaseName} pour ${scopeTitle}`)}
          </div>
          <Card style={{ padding: "2px 16px" }}>
            {slotsLoading ? (
              <div className="py-10 flex justify-center"><Spinner size="sm" /></div>
            ) : loadFailed ? (
              <div role="alert" style={{ margin: "12px 0", padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)", textAlign: "center" }}>
                {L("Couldn't load the documents — reload the page.",
                   "Dokumente konnten nicht geladen werden — Seite neu laden.",
                   "Impossible de charger les documents — rechargez la page.")}
              </div>
            ) : slots.length === 0 ? (
              <Empty icon={<FileText size={20} strokeWidth={1.6} style={{ color: "var(--gold)" }} />}>
                <span style={{ color: "var(--w)", fontWeight: 500 }}>{L("No documents yet", "Noch keine Dokumente", "Aucun document")}</span>
                <span style={{ fontSize: 12.5, marginTop: -4 }}>{L("Add the first one below — everyone in this scope will get it.",
                       "Unten das erste hinzufügen — alle in diesem Bereich bekommen es.",
                       "Ajoutez le premier ci-dessous — tout le périmètre le recevra.")}</span>
              </Empty>
            ) : (
              <Paged items={slots} per={7} perPhone={4}>
                {(slice) => slice.map((s, i) => {
                  const optional = s.is_required === false;
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 0", minHeight: 52, borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {editingId === s.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input autoFocus value={editLabel} onChange={e => setEditLabel(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") void renameSlot(s.id); if (e.key === "Escape") setEditingId(null); }}
                              className="bvk-input" style={{ height: 36, flex: 1 }} />
                            <Btn kind="ghost" size="sm" icon onClick={() => void renameSlot(s.id)} disabled={busyId === s.id} aria-label={L("Save", "Speichern", "Enregistrer")}>
                              <Check size={14} strokeWidth={2.4} />
                            </Btn>
                            <Btn kind="quiet" size="sm" icon onClick={() => setEditingId(null)} aria-label={L("Cancel", "Abbrechen", "Annuler")}>
                              <XIcon size={14} />
                            </Btn>
                          </div>
                        ) : (
                          <button type="button" onClick={() => { setEditingId(s.id); setEditLabel(s.label); }}
                            style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "text", padding: 0, fontFamily: "inherit",
                              fontSize: 14, color: "var(--w)", overflowWrap: "break-word", hyphens: "auto" }} lang="de">
                            {s.label}
                          </button>
                        )}
                      </div>

                      {editingId !== s.id && (
                        <>
                          <Btn kind="quiet" size="sm" icon onClick={() => pickTemplate(s)} disabled={busyId === s.id}
                            title={s.template_pdf_path
                              ? L("Blank form set — click to replace it", "Leeres Formular hinterlegt — klicken zum Ersetzen", "Formulaire vierge en place — cliquer pour le remplacer")
                              : L("Upload the blank form candidates download", "Leeres Formular zum Herunterladen hochladen", "Téléverser le formulaire vierge à télécharger")}
                            aria-label={L("Blank form", "Leeres Formular", "Formulaire vierge")}
                            style={{ color: s.template_pdf_path ? "var(--gold)" : "var(--w3)" }}>
                            {busyId === s.id ? <Spinner size="xs" /> : <FileUp size={15} strokeWidth={1.9} />}
                          </Btn>
                          <Btn kind="quiet" size="sm" onClick={() => void toggleRequired(s)} disabled={busyId === s.id}
                            title={optional ? L("Optional — doesn't count toward the %", "Optional — zählt nicht für die %", "Optionnel — ne compte pas dans le %")
                                            : L("Required — counts toward the %", "Erforderlich — zählt für die %", "Requis — compte dans le %")}
                            style={{ fontSize: 12, fontWeight: 600, color: optional ? "var(--w3)" : "var(--w)", minWidth: 78, justifyContent: "flex-end" }}>
                            {optional ? L("Optional", "Optional", "Optionnel") : L("Required", "Erforderlich", "Requis")}
                          </Btn>
                          <Btn kind="quiet" size="sm" icon onClick={() => void removeSlot(s)} aria-label={L("Delete", "Löschen", "Supprimer")}>
                            <Trash2 size={14} strokeWidth={1.8} />
                          </Btn>
                        </>
                      )}
                    </div>
                  );
                })}
              </Paged>
            )}

            {/* Add */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", borderTop: "1px solid var(--border)" }}>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void addSlot(); }}
                placeholder={L("Document name", "Dokumentname", "Nom du document")}
                className="bvk-input" style={{ flex: 1, minWidth: 0 }} />
              <Btn kind="primary" onClick={() => void addSlot()} disabled={adding || !newLabel.trim()}>
                {adding ? <Spinner size="xs" color="var(--bg)" /> : <Plus size={14} strokeWidth={2.4} />}
                {L("Add", "Hinzufügen", "Ajouter")}
              </Btn>
            </div>
          </Card>

          {saveFailed && (
            <div role="alert" style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)" }}>
              {L("Couldn't save that change — nothing was changed. Try again.",
                 "Änderung konnte nicht gespeichert werden — nichts wurde geändert. Erneut versuchen.",
                 "Modification non enregistrée — rien n'a changé. Réessayez.")}
            </div>
          )}

          <input ref={fileRef} type="file" accept="application/pdf" hidden
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadTemplate(f); }} />

          <p style={{ marginTop: 10, fontSize: 12, color: "var(--w3)" }}>
            {L("Tip: click a name to rename it. Renaming also renames the matching file for every candidate.",
               "Tipp: Auf einen Namen klicken zum Umbenennen — benennt auch die Datei jedes Kandidaten um.",
               "Astuce : cliquez sur un nom pour le renommer — renomme aussi le fichier de chaque candidat.")}
          </p>
        </div>
      </main>
    </>
  );
}

/** lists flip instead of scrolling (components/fx/kit usePaged + Pager) */
function Paged<I>({ items, per, perPhone, children }: { items: I[]; per: number; perPhone: number; children: (slice: I[]) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, per, perPhone);
  return <>{children(slice)}<Pager page={page} pages={pages} onPage={setPage} /></>;
}
