"use client";

/**
 * Batch selector — pills that FILTER the real candidate list (same profile cards)
 * to the picked batch's people. Fully CONTROLLED + prop-driven: batches come from
 * the initial page payload, so it renders instantly with no second fetch and no
 * load-flash. "All" clears it. A "+" (supreme only) creates a batch right here;
 * a pencil on the selected pill EDITS it (rename / seats / agency / dates). Adding
 * and moving PEOPLE happens on the candidate cards + the "Add people" picker.
 * Minimalist.
 */

import { useState } from "react";
import { Loader2, Plus, Pencil, X as XIcon } from "lucide-react";

type Batch = { id: string; name: string; count: number };
type Opt = { id: string; name: string };
type FullBatch = { id: string; name: string; seats?: number; employerId?: string | null; orgId?: string | null; targetStart?: string | null; targetEnd?: string | null };

export function AdminBatches({
  accessToken,
  lang,
  canCreate,
  isOrgAdmin = false,
  batches,
  selectedBatchId,
  onSelect,
  onCreated,
  onEdited,
}: {
  accessToken: string;
  lang: string;
  canCreate: boolean;
  /** Org-scoped agency admin → their batches must carry an org; pre-select it. */
  isOrgAdmin?: boolean;
  batches: Batch[];
  selectedBatchId: string | null;
  onSelect: (batchId: string | null) => void;
  onCreated: (batch: Batch) => void;
  onEdited: (batch: { id: string; name: string }) => void;
}) {
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [employers, setEmployers] = useState<Opt[]>([]);
  const [orgs, setOrgs] = useState<Opt[]>([]);
  const [form, setForm] = useState({ name: "", seats: "10", employerId: "", orgId: "", start: "", end: "" });
  const [saving, setSaving] = useState(false);
  const [formReady, setFormReady] = useState(true); // false while an edit's values are still loading

  if (batches.length === 0 && !canCreate) return null;

  const loadPickers = async (): Promise<{ orgs: Opt[]; batches: FullBatch[] }> => {
    try {
      const r = await fetch("/api/portal/batches", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) return { orgs: [], batches: [] };
      const j = (await r.json()) as { employers?: Opt[]; organizations?: Opt[]; batches?: FullBatch[] };
      setEmployers(j.employers ?? []);
      setOrgs(j.organizations ?? []);
      return { orgs: j.organizations ?? [], batches: j.batches ?? [] };
    } catch { return { orgs: [], batches: [] }; }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormReady(true);
    setForm({ name: "", seats: "10", employerId: "", orgId: "", start: "", end: "" });
  };

  const openCreate = async () => {
    setEditingId(null);
    setFormReady(true); // create has nothing to load — ready immediately
    setForm({ name: "", seats: "10", employerId: "", orgId: "", start: "", end: "" });
    setShowForm(true);
    const { orgs: loaded } = await loadPickers();
    // An org-scoped admin's batch MUST carry an org — pre-select their (first) one
    // so a create can't silently 403 on a missing agency.
    if (isOrgAdmin && loaded.length) setForm((f) => ({ ...f, orgId: f.orgId || loaded[0].id }));
  };

  const openEdit = async (id: string) => {
    setEditingId(id);
    setFormReady(false); // block save until the batch's real values load
    setShowForm(true);
    const { batches: full } = await loadPickers();
    const b = full.find((x) => x.id === id);
    // Only mark ready once we've loaded the batch — otherwise a failed/slow GET
    // would leave empty fields that Save would send as intentional clears.
    if (b) {
      setForm({
        name: b.name ?? "", seats: String(b.seats ?? 10),
        employerId: b.employerId ?? "", orgId: b.orgId ?? "",
        start: b.targetStart ?? "", end: b.targetEnd ?? "",
      });
      setFormReady(true);
    }
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        const r = await fetch("/api/portal/batches", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            batchId: editingId, name, seats: parseInt(form.seats, 10) || 10,
            employerId: form.employerId || "", orgId: form.orgId || "",
            targetStart: form.start || "", targetEnd: form.end || "",
          }),
        });
        if (r.ok) { onEdited({ id: editingId, name }); closeForm(); }
      } else {
        const r = await fetch("/api/portal/batches", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            name, seats: parseInt(form.seats, 10) || 10,
            employerId: form.employerId || undefined, orgId: form.orgId || undefined,
            targetStart: form.start || undefined, targetEnd: form.end || undefined,
          }),
        });
        if (r.ok) {
          const j = (await r.json().catch(() => ({}))) as { id?: string };
          if (j.id) onCreated({ id: j.id, name, count: 0 });
          closeForm();
        }
      }
    } catch { /* stay open to retry */ }
    finally { setSaving(false); }
  };

  const pill = (id: string | null, label: string) => {
    const active = selectedBatchId === id;
    return (
      <button key={id ?? "all"} type="button" onClick={() => onSelect(id)}
        className="px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
        style={{ borderRadius: 999, border: `1px solid ${active ? "var(--border-gold)" : "var(--border)"}`, background: active ? "var(--gdim)" : "transparent", color: active ? "var(--gold)" : "var(--w3)" }}>
        {label}
      </button>
    );
  };

  const inp: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: 8, height: 34, fontSize: 13, padding: "0 8px", width: "100%" };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {batches.map((b) => pill(b.id, `${b.name.replace(/_/g, " ")} ${b.count}`))}
      {batches.length > 0 && pill(null, L("All", "Tous", "Alle"))}
      {canCreate && selectedBatchId && (
        <button type="button" onClick={() => void openEdit(selectedBatchId)} aria-label={L("Edit batch", "Modifier le lot", "Batch bearbeiten")}
          className="inline-flex items-center justify-center transition-colors"
          style={{ width: 26, height: 26, borderRadius: 999, border: "1px solid var(--border-gold)", color: "var(--gold)", background: "var(--gdim)" }}>
          <Pencil size={12} strokeWidth={2.2} />
        </button>
      )}
      {canCreate && (
        <button type="button" onClick={openCreate} aria-label={L("New batch", "Nouveau lot", "Neuer Batch")}
          className="inline-flex items-center justify-center transition-colors"
          style={{ width: 26, height: 26, borderRadius: 999, border: "1px solid var(--border)", color: "var(--w2)" }}>
          <Plus size={14} strokeWidth={2.2} />
        </button>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }} onClick={closeForm} role="dialog" aria-modal="true">
          <div className="w-full flex flex-col gap-2.5 p-4" style={{ maxWidth: 380, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 20 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center">
              <span className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>
                {editingId ? L("Edit batch", "Modifier le lot", "Batch bearbeiten") : L("New batch", "Nouveau lot", "Neuer Batch")}
              </span>
              <button type="button" onClick={closeForm} className="ml-auto opacity-70 hover:opacity-100" style={{ color: "var(--w2)" }}><XIcon size={17} strokeWidth={2} /></button>
            </div>
            <input autoFocus type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={L("Name — e.g. UKSH Kiel — April 2027", "Nom — ex. UKSH Kiel — avril 2027", "Name — z. B. UKSH Kiel — April 2027")} style={inp} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
            <div className="flex gap-2">
              <label className="flex-1 flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--w3)" }}>{L("Seats", "Places", "Plätze")}</span>
                <input type="number" min={1} max={1000} value={form.seats} onChange={(e) => setForm((f) => ({ ...f, seats: e.target.value }))} style={inp} />
              </label>
              <label className="flex-1 flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--w3)" }}>{L("Agency", "Agence", "Agentur")}</span>
                <select value={form.orgId} onChange={(e) => setForm((f) => ({ ...f, orgId: e.target.value }))} style={inp}>
                  <option value="">{L("— none —", "— aucune —", "— keine —")}</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--w3)" }}>{L("Employer", "Employeur", "Arbeitgeber")}</span>
              <select value={form.employerId} onChange={(e) => setForm((f) => ({ ...f, employerId: e.target.value }))} style={inp}>
                <option value="">{L("— none —", "— aucun —", "— keiner —")}</option>
                {employers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <label className="flex-1 flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--w3)" }}>{L("Start", "Début", "Start")}</span>
                <input type="date" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} style={inp} />
              </label>
              <label className="flex-1 flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--w3)" }}>{L("End", "Fin", "Ende")}</span>
                <input type="date" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} style={inp} />
              </label>
            </div>
            <button type="button" onClick={() => void save()} disabled={!form.name.trim() || saving || !formReady}
              className="mt-1 inline-flex items-center justify-center gap-1.5 font-semibold transition-opacity disabled:opacity-40"
              style={{ height: 38, borderRadius: 10, background: "var(--gold)", color: "#1a1205", fontSize: 13 }}>
              {saving ? <Loader2 size={14} className="animate-spin" strokeWidth={2.4} /> : editingId ? <Pencil size={13} strokeWidth={2.4} /> : <Plus size={14} strokeWidth={2.4} />}
              {editingId ? L("Save changes", "Enregistrer", "Speichern") : L("Create batch", "Créer le lot", "Batch erstellen")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
