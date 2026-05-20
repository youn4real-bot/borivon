"use client";

/**
 * Admin → Manage Employers (SUPREME admin only).
 *
 * Replaces the "open a SQL editor to add an employer" workflow with a small
 * CRUD page. The same `employers` table backs the assignment picker and the
 * Motivationsschreiben recipient block — adding here lights it up everywhere.
 *
 * - No hard delete. Retire via active=false (preserves history / FK).
 * - Address lines: one per line in a textarea → text[] in the DB.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { Plus, Save as SaveIcon, X as XIcon, Pencil, Power, PowerOff } from "lucide-react";

type Employer = {
  id: string;
  slug: string | null;
  name: string;
  address_lines: string[];
  agency_id: string | null;
  active: boolean;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

type DraftForm = {
  id?: string;
  slug: string;
  name: string;
  addressText: string;            // multiline; split on save
  notes: string;
  active: boolean;
  // Source — Direct employer (no agency) vs Through an agency (links to an
  // organizations row). Schema: employers.agency_id FK organizations.id.
  source: "direct" | "agency";
  agencyId: string | null;
};
const EMPTY_DRAFT: DraftForm = {
  slug: "", name: "", addressText: "", notes: "", active: true,
  source: "direct", agencyId: null,
};

function toDraft(e: Employer): DraftForm {
  return {
    id: e.id,
    slug: e.slug ?? "",
    name: e.name,
    addressText: (e.address_lines ?? []).join("\n"),
    notes: e.notes ?? "",
    active: e.active,
    source: e.agency_id ? "agency" : "direct",
    agencyId: e.agency_id,
  };
}

export default function AdminEmployersPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string>("");
  const [loading, setLoading]         = useState(true);
  const [employers, setEmployers]     = useState<Employer[]>([]);
  const [orgs, setOrgs]               = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft]             = useState<DraftForm | null>(null);
  const [saving, setSaving]           = useState(false);
  // id → org name (for the "via {agency}" badge in the list).
  const orgsById = new Map(orgs.map(o => [o.id, o.name] as const));

  // Auth — supreme only. Anything else → bounce to dashboard.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/portal"); return; }
      setAccessToken(session.access_token ?? "");
      try {
        const r = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!j?.isSuperAdmin) { router.replace("/portal/admin"); return; }
      } catch { router.replace("/portal/admin"); return; }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const [er, or] = await Promise.all([
        fetch("/api/portal/admin/employers?all=1", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/portal/admin/organizations",  { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      if (er.ok) {
        const j = await er.json();
        setEmployers((j.employers ?? []) as Employer[]);
      }
      if (or.ok) {
        const j = await or.json();
        const list = (j.orgs ?? []) as { id: string; name: string }[];
        setOrgs(list.map(o => ({ id: o.id, name: o.name })));
      }
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { if (accessToken) void load(accessToken); }, [accessToken, load]);

  async function save() {
    if (!draft) return;
    const addressLines = draft.addressText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!draft.name.trim()) { alert("Name erforderlich."); return; }
    if (addressLines.length === 0) { alert("Mindestens eine Adresszeile erforderlich."); return; }

    if (draft.source === "agency" && !draft.agencyId) {
      alert("Bitte eine Agentur auswählen.");
      return;
    }
    const body: Record<string, unknown> = {
      slug: draft.slug.trim() || null,
      name: draft.name.trim(),
      address_lines: addressLines,
      notes: draft.notes.trim() || null,
      active: draft.active,
      agency_id: draft.source === "agency" ? draft.agencyId : null,
    };
    if (draft.id) body.id = draft.id;

    setSaving(true);
    try {
      const r = await fetch("/api/portal/admin/employers", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        setDraft(null);
        await load(accessToken);
      } else {
        let msg = `HTTP ${r.status}`;
        try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        alert(`Speichern fehlgeschlagen:\n${msg}`);
      }
    } catch {
      alert("Speichern fehlgeschlagen (Netzwerkfehler).");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(emp: Employer) {
    const body = { id: emp.id, active: !emp.active };
    try {
      const r = await fetch("/api/portal/admin/employers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        alert(`Statuswechsel fehlgeschlagen:\n${msg}`);
        return;
      }
      await load(accessToken);
    } catch {
      alert("Statuswechsel fehlgeschlagen (Netzwerkfehler).");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>Arbeitgeber verwalten</h1>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--w3)" }}>
            Treibt die Zuweisungs-Auswahl und den Motivationsschreiben-Empfängerblock. Nur sichtbar für den Supreme-Admin.
          </p>
        </div>
        <button onClick={() => setDraft({ ...EMPTY_DRAFT })}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold transition-opacity hover:opacity-80"
          style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
          <Plus size={13} strokeWidth={2} /> Neuer Arbeitgeber
        </button>
      </div>

      {loading ? (
        <p className="text-[12px] py-8 text-center" style={{ color: "var(--w3)" }}>Laden…</p>
      ) : employers.length === 0 ? (
        <p className="text-[12px] py-8 text-center" style={{ color: "var(--w3)" }}>Noch keine Arbeitgeber.</p>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          {employers.map((e, idx) => (
            <div key={e.id} className="px-4 py-3 flex items-start gap-3"
              style={{ borderTop: idx === 0 ? "none" : "1px solid var(--border)", opacity: e.active ? 1 : 0.55 }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13.5px] font-semibold truncate" style={{ color: "var(--w)" }}>{e.name}</p>
                  {e.slug && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>{e.slug}</span>
                  )}
                  {e.agency_id ? (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                      via {orgsById.get(e.agency_id) ?? "Agentur"}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>direkt</span>
                  )}
                  {!e.active && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>inaktiv</span>
                  )}
                </div>
                <p className="text-[11.5px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>
                  {(e.address_lines ?? []).join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setDraft(toDraft(e))} title="Bearbeiten" aria-label="Bearbeiten"
                  className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center" style={{ color: "var(--w2)" }}>
                  <Pencil size={13} strokeWidth={1.8} />
                </button>
                <button onClick={() => toggleActive(e)} title={e.active ? "Deaktivieren" : "Reaktivieren"} aria-label={e.active ? "Deaktivieren" : "Reaktivieren"}
                  className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ color: e.active ? "var(--w2)" : "var(--gold)" }}>
                  {e.active ? <PowerOff size={13} strokeWidth={1.8} /> : <Power size={13} strokeWidth={1.8} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
          onClick={() => !saving && setDraft(null)}>
          <div className="w-full max-w-md rounded-[20px] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
            style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)", animation: "bvFadeRise .28s var(--ease-out)", maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)" }}>
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--w)" }}>
                {draft.id ? "Arbeitgeber bearbeiten" : "Neuer Arbeitgeber"}
              </p>
              <button onClick={() => !saving && setDraft(null)}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center" style={{ color: "var(--w3)" }}>
                <XIcon size={14} strokeWidth={1.8} />
              </button>
            </div>
            <div className="px-5 py-5 overflow-y-auto space-y-3" style={{ minHeight: 0 }}>
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>Name *</label>
                <input value={draft.name} onChange={e => setDraft(d => d ? { ...d, name: e.target.value } : d)}
                  placeholder="UKSH Kiel"
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }} />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>Slug (optional, a–z 0–9 _ -)</label>
                <input value={draft.slug} onChange={e => setDraft(d => d ? { ...d, slug: e.target.value } : d)}
                  placeholder="uksh_kiel"
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none font-mono"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }} />
              </div>

              {/* Source — Direct employer (no agency) vs Through an agency. */}
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>Quelle</label>
                <div className="flex gap-2">
                  {(["direct", "agency"] as const).map(src => {
                    const active = draft.source === src;
                    return (
                      <button key={src} type="button"
                        onClick={() => setDraft(d => d ? { ...d, source: src, agencyId: src === "direct" ? null : d.agencyId } : d)}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                        style={{
                          background: active ? "var(--gdim)" : "var(--bg2)",
                          color:      active ? "var(--gold)" : "var(--w3)",
                          border: `1px solid ${active ? "var(--border-gold)" : "var(--border)"}`,
                        }}>
                        {src === "direct" ? "Direkter Arbeitgeber" : "Über Agentur"}
                      </button>
                    );
                  })}
                </div>
              </div>

              {draft.source === "agency" && (
                <div>
                  <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>Agentur *</label>
                  <select value={draft.agencyId ?? ""}
                    onChange={e => setDraft(d => d ? { ...d, agencyId: e.target.value || null } : d)}
                    className="w-full rounded-lg px-2.5 py-2 text-xs outline-none"
                    style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }}>
                    <option value="">— wählen —</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  {orgs.length === 0 && (
                    <p className="text-[10.5px] mt-1" style={{ color: "var(--w3)" }}>
                      Noch keine Agenturen. Lege eine unter <span style={{ color: "var(--gold)" }}>Organisationen</span> an.
                    </p>
                  )}
                </div>
              )}
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>
                  Adresszeilen * <span style={{ color: "var(--w3)" }}>(eine pro Zeile)</span>
                </label>
                <textarea rows={6} value={draft.addressText} onChange={e => setDraft(d => d ? { ...d, addressText: e.target.value } : d)}
                  placeholder={"Universitätsklinikum Schleswig-Holstein\nCampus Kiel\nPersonalabteilung\nArnold-Heller-Straße 3\n24105 Kiel"}
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none resize-y"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)", minHeight: 120 }} />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>Notizen (optional)</label>
                <textarea rows={2} value={draft.notes} onChange={e => setDraft(d => d ? { ...d, notes: e.target.value } : d)}
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none resize-y"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)", minHeight: 56 }} />
              </div>
              <label className="inline-flex items-center gap-2 text-xs select-none" style={{ color: "var(--w2)" }}>
                <input type="checkbox" checked={draft.active}
                  onChange={e => setDraft(d => d ? { ...d, active: e.target.checked } : d)} />
                Aktiv (für Zuweisung verfügbar)
              </label>
            </div>
            <div className="px-5 py-4 flex-shrink-0 flex items-center gap-2" style={{ borderTop: "1px solid var(--border)" }}>
              <button onClick={save} disabled={saving}
                className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                {saving ? "…" : <><SaveIcon size={12} strokeWidth={1.8} /> Speichern</>}
              </button>
              <button onClick={() => !saving && setDraft(null)}
                className="bv-row-hover py-2 px-3 text-xs" style={{ color: "var(--w3)" }}>Abbrechen</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
