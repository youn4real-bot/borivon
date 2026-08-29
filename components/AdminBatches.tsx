"use client";

/**
 * Batch selector — pills that FILTER the real candidate list below (same profile
 * cards, with photos) to the picked batch's people, least-doc-complete first. "All"
 * clears it. A "+" (supreme only) creates a new batch right here — same create API
 * as the batches page — so it's all in one place; candidates get added later.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, X as XIcon } from "lucide-react";

type Member = { uid: string; batchId: string; pct: number };
type Batch = { id: string; name: string; count: number };
type Resp = { ok: boolean; batches: Batch[]; members: Member[] };
type Opt = { id: string; name: string };

export function AdminBatches({
  accessToken,
  lang,
  canCreate,
  onSelect,
}: {
  accessToken: string;
  lang: string;
  canCreate: boolean;
  onSelect: (uids: string[] | null) => void;
}) {
  const [data, setData] = useState<Resp | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);

  // create-batch modal
  const [showCreate, setShowCreate] = useState(false);
  const [employers, setEmployers] = useState<Opt[]>([]);
  const [orgs, setOrgs] = useState<Opt[]>([]);
  const [form, setForm] = useState({ name: "", seats: "10", employerId: "", orgId: "", start: "", end: "" });
  const [saving, setSaving] = useState(false);

  const uidsFor = (resp: Resp, batchId: string | null) =>
    batchId === null ? null : resp.members.filter((m) => m.batchId === batchId).map((m) => m.uid);
  const choose = (resp: Resp, batchId: string | null) => { setSel(batchId); onSelect(uidsFor(resp, batchId)); };

  const load = useCallback(async () => {
    if (!accessToken) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const r = await fetch("/api/portal/admin/batches-track", { headers: { Authorization: `Bearer ${accessToken}` }, signal: ac.signal });
      const j = (await r.json()) as Resp;
      if (abortRef.current !== ac) return;
      setData(j);
      setSel((prev) => {
        const keep = prev && j.batches.some((b) => b.id === prev) ? prev : (j.batches[0]?.id ?? null);
        onSelect(uidsFor(j, keep));
        return keep;
      });
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      if (abortRef.current === ac) { setData({ ok: true, batches: [], members: [] }); onSelect(null); }
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); return () => abortRef.current?.abort(); }, [load]);

  // Lazily load employer + agency options the first time the create modal opens.
  const openCreate = async () => {
    setShowCreate(true);
    if (employers.length || orgs.length) return;
    try {
      const r = await fetch("/api/portal/batches", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) return;
      const j = (await r.json()) as { employers?: Opt[]; organizations?: Opt[] };
      setEmployers(j.employers ?? []);
      setOrgs(j.organizations ?? []);
    } catch { /* pickers just stay empty */ }
  };

  const create = async () => {
    const name = form.name.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const r = await fetch("/api/portal/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          name,
          seats: parseInt(form.seats, 10) || 10,
          employerId: form.employerId || undefined,
          orgId: form.orgId || undefined,
          targetStart: form.start || undefined,
          targetEnd: form.end || undefined,
        }),
      });
      if (r.ok) {
        setShowCreate(false);
        setForm({ name: "", seats: "10", employerId: "", orgId: "", start: "", end: "" });
        await load(); // new batch appears as a pill
      }
    } catch { /* ignore — modal stays open to retry */ }
    finally { setSaving(false); }
  };

  const pill = (id: string | null, label: string) => {
    const active = sel === id;
    return (
      <button key={id ?? "all"} type="button" onClick={() => data && choose(data, id)}
        className="px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
        style={{ borderRadius: 999, border: `1px solid ${active ? "var(--border-gold)" : "var(--border)"}`, background: active ? "var(--gdim)" : "transparent", color: active ? "var(--gold)" : "var(--w3)" }}>
        {label}
      </button>
    );
  };

  // Nothing to select yet: still offer "+" to create the first batch (supreme only).
  if (loading && !data) {
    return (
      <div className="mb-3 flex items-center gap-2 text-[12px]" style={{ color: "var(--w3)" }}>
        <Loader2 size={13} className="animate-spin" strokeWidth={2} /> {L("Loading batches…", "Chargement…", "Batches werden geladen…")}
      </div>
    );
  }
  const hasBatches = !!data && data.batches.length > 0;
  if (!hasBatches && !canCreate) return null;

  const inp: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: 8, height: 34, fontSize: 13, padding: "0 8px", width: "100%" };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {data?.batches.map((b) => pill(b.id, `${b.name} ${b.count}`))}
      {hasBatches && pill(null, L("All", "Tous", "Alle"))}
      {canCreate && (
        <button type="button" onClick={openCreate} aria-label={L("New batch", "Nouveau lot", "Neuer Batch")}
          className="inline-flex items-center justify-center transition-colors"
          style={{ width: 26, height: 26, borderRadius: 999, border: "1px solid var(--border)", color: "var(--w2)" }}>
          <Plus size={14} strokeWidth={2.2} />
        </button>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }} onClick={() => setShowCreate(false)} role="dialog" aria-modal="true">
          <div className="w-full flex flex-col gap-2.5 p-4" style={{ maxWidth: 380, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 20 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center">
              <span className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>{L("New batch", "Nouveau lot", "Neuer Batch")}</span>
              <button type="button" onClick={() => setShowCreate(false)} className="ml-auto opacity-70 hover:opacity-100" style={{ color: "var(--w2)" }}><XIcon size={17} strokeWidth={2} /></button>
            </div>
            <input autoFocus type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={L("Name — e.g. UKSH Kiel — April 2027", "Nom — ex. UKSH Kiel — avril 2027", "Name — z. B. UKSH Kiel — April 2027")} style={inp} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
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
            <button type="button" onClick={() => void create()} disabled={!form.name.trim() || saving}
              className="mt-1 inline-flex items-center justify-center gap-1.5 font-semibold transition-opacity disabled:opacity-40"
              style={{ height: 38, borderRadius: 10, background: "var(--gold)", color: "#1a1205", fontSize: 13 }}>
              {saving ? <Loader2 size={14} className="animate-spin" strokeWidth={2.4} /> : <Plus size={14} strokeWidth={2.4} />}
              {L("Create batch", "Créer le lot", "Batch erstellen")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
