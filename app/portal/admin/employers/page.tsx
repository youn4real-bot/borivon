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

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { Plus, Save as SaveIcon, X as XIcon, Pencil, Power, PowerOff, Image as ImageIcon, Trash2 } from "lucide-react";

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

type Agency = {
  id: string;
  name: string;
  notes: string | null;
  logo_filename: string | null;
  footer_text: string | null;
};
type AgencyDraft = {
  id?: string;
  name: string;
  addressText: string;            // multiline; becomes footer_text on save
  logoDataUrl: string | null;     // data: URL or legacy filename
  notes: string;
};
const EMPTY_AGENCY: AgencyDraft = { name: "", addressText: "", logoDataUrl: null, notes: "" };

function toAgencyDraft(o: Agency): AgencyDraft {
  return {
    id: o.id,
    name: o.name,
    addressText: o.footer_text ?? "",
    logoDataUrl: o.logo_filename ?? null,
    notes: o.notes ?? "",
  };
}

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
  const { lang } = useLang();
  // LAW #19 — every visible string in FR/EN/DE.
  const L = lang === "fr"
    ? {
        title: "Gérer les employeurs",
        hint: "Alimente le sélecteur d'affectation et le bloc destinataire du Motivationsschreiben. Visible uniquement par le supreme admin.",
        newBtn: "Nouvel employeur", loading: "Chargement…", empty: "Aucun employeur pour le moment.",
        inactive: "inactif", direct: "direct", via: "via",
        edit: "Modifier", deactivate: "Désactiver", reactivate: "Réactiver",
        modalEdit: "Modifier l'employeur", modalNew: "Nouvel employeur",
        nameLbl: "Nom *", slugLbl: "Slug (optionnel, a–z 0–9 _ -)",
        source: "Source", directEmp: "Employeur direct", viaAgency: "Via une agence",
        agencyLbl: "Agence *", pick: "— choisir —",
        noOrgs: "Pas encore d'agences. Créez-en une sous Organisations.",
        addressLbl: "Lignes d'adresse *", addressHint: "(une par ligne)",
        notesLbl: "Notes (optionnel)", activeLbl: "Actif (disponible pour l'affectation)",
        save: "Enregistrer", cancel: "Annuler",
        autoSaving: "Enregistrement automatique", autoSaved: "Enregistré automatiquement", done: "Terminé",
        errName: "Nom requis.", errAddress: "Au moins une ligne d'adresse requise.",
        errAgency: "Veuillez choisir une agence.",
        errSave: "Échec de l'enregistrement", errAutoSave: "Échec de l'enregistrement automatique",
        errToggle: "Échec du changement de statut", errNet: "(Erreur réseau)",
        tabEmployers: "Employeurs", tabAgencies: "Agences",
        agencyHint: "Une agence achemine les candidats vers un employeur final. Son logo et son adresse apparaissent sur les CV et lettres des candidats affectés.",
        newAgency: "Nouvelle agence", emptyAgencies: "Aucune agence pour l'instant.",
        modalNewAgency: "Nouvelle agence", modalEditAgency: "Modifier l'agence",
        agencyName: "Nom *",
        agencyAddress: "Adresse (pied de CV)", agencyAddressHint: "(une ligne par ligne — apparaît sous chaque page du CV)",
        logoLbl: "Logo", logoUpload: "Téléverser un logo", logoReplace: "Remplacer le logo", logoRemove: "Retirer",
        logoTooBig: "Image trop grande — max 300 Ko.",
        usedBy: (n: number) => `Utilisée par ${n} employeur${n !== 1 ? "s" : ""}`,
      }
    : lang === "de"
    ? {
        title: "Arbeitgeber verwalten",
        hint: "Treibt die Zuweisungs-Auswahl und den Motivationsschreiben-Empfängerblock. Nur sichtbar für den Supreme-Admin.",
        newBtn: "Neuer Arbeitgeber", loading: "Laden…", empty: "Noch keine Arbeitgeber.",
        inactive: "inaktiv", direct: "direkt", via: "via",
        edit: "Bearbeiten", deactivate: "Deaktivieren", reactivate: "Reaktivieren",
        modalEdit: "Arbeitgeber bearbeiten", modalNew: "Neuer Arbeitgeber",
        nameLbl: "Name *", slugLbl: "Slug (optional, a–z 0–9 _ -)",
        source: "Quelle", directEmp: "Direkter Arbeitgeber", viaAgency: "Über Agentur",
        agencyLbl: "Agentur *", pick: "— wählen —",
        noOrgs: "Noch keine Agenturen. Lege eine unter Organisationen an.",
        addressLbl: "Adresszeilen *", addressHint: "(eine pro Zeile)",
        notesLbl: "Notizen (optional)", activeLbl: "Aktiv (für Zuweisung verfügbar)",
        save: "Speichern", cancel: "Abbrechen",
        autoSaving: "Wird automatisch gespeichert", autoSaved: "Automatisch gespeichert", done: "Fertig",
        errName: "Name erforderlich.", errAddress: "Mindestens eine Adresszeile erforderlich.",
        errAgency: "Bitte eine Agentur auswählen.",
        errSave: "Speichern fehlgeschlagen", errAutoSave: "Auto-Speichern fehlgeschlagen",
        errToggle: "Statuswechsel fehlgeschlagen", errNet: "(Netzwerkfehler)",
        tabEmployers: "Arbeitgeber", tabAgencies: "Agenturen",
        agencyHint: "Eine Agentur vermittelt Kandidaten an einen finalen Arbeitgeber. Ihr Logo und ihre Adresse erscheinen auf CV und Anschreiben der zugewiesenen Kandidaten.",
        newAgency: "Neue Agentur", emptyAgencies: "Noch keine Agenturen.",
        modalNewAgency: "Neue Agentur", modalEditAgency: "Agentur bearbeiten",
        agencyName: "Name *",
        agencyAddress: "Adresse (CV-Fußzeile)", agencyAddressHint: "(eine pro Zeile — erscheint unter jeder CV-Seite)",
        logoLbl: "Logo", logoUpload: "Logo hochladen", logoReplace: "Logo ersetzen", logoRemove: "Entfernen",
        logoTooBig: "Bild zu groß — max 300 KB.",
        usedBy: (n: number) => `Genutzt von ${n} Arbeitgeber${n !== 1 ? "n" : ""}`,
      }
    : {
        title: "Manage employers",
        hint: "Powers the assignment picker and the Motivationsschreiben recipient block. Visible only to the supreme admin.",
        newBtn: "New employer", loading: "Loading…", empty: "No employers yet.",
        inactive: "inactive", direct: "direct", via: "via",
        edit: "Edit", deactivate: "Deactivate", reactivate: "Reactivate",
        modalEdit: "Edit employer", modalNew: "New employer",
        nameLbl: "Name *", slugLbl: "Slug (optional, a–z 0–9 _ -)",
        source: "Source", directEmp: "Direct employer", viaAgency: "Through an agency",
        agencyLbl: "Agency *", pick: "— choose —",
        noOrgs: "No agencies yet. Create one under Organisations.",
        addressLbl: "Address lines *", addressHint: "(one per line)",
        notesLbl: "Notes (optional)", activeLbl: "Active (available for assignment)",
        save: "Save", cancel: "Cancel",
        autoSaving: "Saves automatically", autoSaved: "Auto-saved", done: "Done",
        errName: "Name required.", errAddress: "At least one address line required.",
        errAgency: "Please select an agency.",
        errSave: "Save failed", errAutoSave: "Auto-save failed",
        errToggle: "Status change failed", errNet: "(Network error)",
        tabEmployers: "Employers", tabAgencies: "Agencies",
        agencyHint: "An agency routes candidates to a final employer. Its logo and address appear on the CV and motivation letter of every assigned candidate.",
        newAgency: "New agency", emptyAgencies: "No agencies yet.",
        modalNewAgency: "New agency", modalEditAgency: "Edit agency",
        agencyName: "Name *",
        agencyAddress: "Address (CV footer)", agencyAddressHint: "(one line per line — shown under every CV page)",
        logoLbl: "Logo", logoUpload: "Upload logo", logoReplace: "Replace logo", logoRemove: "Remove",
        logoTooBig: "Image too large — max 300 KB.",
        usedBy: (n: number) => `Used by ${n} employer${n !== 1 ? "s" : ""}`,
      };
  const [accessToken, setAccessToken] = useState<string>("");
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState<"employers" | "agencies">("employers");
  const [employers, setEmployers]     = useState<Employer[]>([]);
  const [orgs, setOrgs]               = useState<Agency[]>([]);
  const [draft, setDraft]             = useState<DraftForm | null>(null);
  const [agencyDraft, setAgencyDraft] = useState<AgencyDraft | null>(null);
  const [saving, setSaving]           = useState(false);
  const [autoSaved, setAutoSaved]     = useState(false);
  // Autosave plumbing (edit mode only). seed = the JSON snapshot last
  // persisted; saveTimer = the in-flight debounce; formRef mirrors `draft`
  // so close/unmount can flush the last keystrokes.
  const seedRef   = useRef<string>("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef   = useRef<DraftForm | null>(null);
  // Agency autosave plumbing (separate state — modal lives independently).
  const agSeedRef   = useRef<string>("");
  const agSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agFormRef   = useRef<AgencyDraft | null>(null);
  // id → org name (for the "via {agency}" badge in the list).
  const orgsById = new Map(orgs.map(o => [o.id, o.name] as const));
  // employer count per agency (for "Used by N employers" line).
  const empCountByAgency = new Map<string, number>();
  for (const e of employers) if (e.agency_id) empCountByAgency.set(e.agency_id, (empCountByAgency.get(e.agency_id) ?? 0) + 1);

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
        const list = (j.orgs ?? []) as Array<{ id: string; name: string; notes: string | null; logo_filename: string | null; footer_text: string | null }>;
        setOrgs(list.map(o => ({ id: o.id, name: o.name, notes: o.notes ?? null, logo_filename: o.logo_filename ?? null, footer_text: o.footer_text ?? null })));
      }
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { if (accessToken) void load(accessToken); }, [accessToken, load]);

  async function save() {
    if (!draft) return;
    const addressLines = draft.addressText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!draft.name.trim()) { alert(L.errName); return; }
    if (addressLines.length === 0) { alert(L.errAddress); return; }

    if (draft.source === "agency" && !draft.agencyId) {
      alert(L.errAgency);
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
        alert(`${L.errSave}:\n${msg}`);
      }
    } catch {
      alert(`${L.errSave} ${L.errNet}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Edit-mode autosave (no Save button) ─────────────────────────────────
  // PATCH the current draft 600 ms after the last keystroke. Skips when
  // required fields are empty (Name + at least one address line). On close
  // / unmount the last edits are flushed so a change can never be lost.
  const persistEdit = useCallback(async (d: DraftForm) => {
    if (!d.id) return;
    const addressLines = d.addressText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!d.name.trim() || addressLines.length === 0) return; // wait for valid state
    if (d.source === "agency" && !d.agencyId) return;
    const body: Record<string, unknown> = {
      id: d.id,
      slug: d.slug.trim() || null,
      name: d.name.trim(),
      address_lines: addressLines,
      notes: d.notes.trim() || null,
      active: d.active,
      agency_id: d.source === "agency" ? d.agencyId : null,
    };
    try {
      const r = await fetch("/api/portal/admin/employers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (r.ok) {
        seedRef.current = JSON.stringify(d);
        setAutoSaved(true);
        setTimeout(() => setAutoSaved(false), 1600);
        // Reflect the saved row in the list without a full reload.
        const j = await r.json().catch(() => null) as { employer?: Employer } | null;
        if (j?.employer) setEmployers(prev => prev.map(e => e.id === j.employer!.id ? j.employer! : e));
      } else {
        let msg = `HTTP ${r.status}`;
        try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        // Re-arm a retry; surface the reason so it's never silent.
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { void persistEdit(d); }, 4000);
        alert(`${L.errAutoSave}:\n${msg}`);
      }
    } catch {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void persistEdit(d); }, 4000);
    }
  }, [accessToken]);

  // Debounced effect: any draft change in EDIT mode → PATCH after 600 ms idle.
  useEffect(() => {
    formRef.current = draft;
    if (!draft || !draft.id) return;
    const sig = JSON.stringify(draft);
    if (sig === seedRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const snap = draft;
    saveTimer.current = setTimeout(() => { void persistEdit(snap); }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [draft, persistEdit]);

  // Close: flush pending edits in EDIT mode (no "discard" — autosave model).
  function closeDraft() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const d = formRef.current;
    if (d && d.id && JSON.stringify(d) !== seedRef.current) void persistEdit(d);
    setDraft(null);
  }

  // Page unmount / route change: flush.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const d = formRef.current;
    if (d && d.id && JSON.stringify(d) !== seedRef.current) void persistEdit(d);
    if (agSaveTimer.current) clearTimeout(agSaveTimer.current);
    const ad = agFormRef.current;
    if (ad && ad.id && JSON.stringify(ad) !== agSeedRef.current) void persistAgency(ad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistEdit]);

  // ── Agency create (POST /api/portal/admin/organizations) ─────────────────
  async function saveAgency() {
    if (!agencyDraft) return;
    if (!agencyDraft.name.trim()) { alert(L.errName); return; }
    setSaving(true);
    try {
      // 1) create the org row
      const r = await fetch("/api/portal/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ name: agencyDraft.name.trim(), notes: agencyDraft.notes.trim() || undefined }),
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        alert(`${L.errSave}:\n${msg}`);
        return;
      }
      const j = await r.json();
      const newId = j?.org?.id as string | undefined;
      // 2) write branding (footer_text + logo) in a follow-up PATCH so the
      //    POST endpoint can stay focused on identity fields.
      if (newId) {
        const footer = agencyDraft.addressText.trim();
        const logo   = agencyDraft.logoDataUrl ?? "";
        if (footer || logo) {
          await fetch(`/api/portal/admin/organizations/${newId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ footerText: footer, logoFilename: logo }),
          }).catch(() => null);
        }
      }
      setAgencyDraft(null);
      await load(accessToken);
    } catch {
      alert(`${L.errSave} ${L.errNet}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Agency edit autosave ────────────────────────────────────────────────
  const persistAgency = useCallback(async (d: AgencyDraft) => {
    if (!d.id) return;
    if (!d.name.trim()) return; // wait for valid state
    const body = {
      name: d.name.trim(),
      notes: d.notes.trim(),
      footerText: d.addressText.trim(),
      logoFilename: d.logoDataUrl ?? "",
    };
    try {
      const r = await fetch(`/api/portal/admin/organizations/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (r.ok) {
        agSeedRef.current = JSON.stringify(d);
        setAutoSaved(true);
        setTimeout(() => setAutoSaved(false), 1600);
        // Reflect in the local list without a full reload.
        setOrgs(prev => prev.map(o => o.id === d.id ? {
          ...o,
          name: d.name.trim(),
          notes: d.notes.trim() || null,
          footer_text: d.addressText.trim() || null,
          logo_filename: d.logoDataUrl || null,
        } : o));
      } else {
        let msg = `HTTP ${r.status}`;
        try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        if (agSaveTimer.current) clearTimeout(agSaveTimer.current);
        agSaveTimer.current = setTimeout(() => { void persistAgency(d); }, 4000);
        alert(`${L.errAutoSave}:\n${msg}`);
      }
    } catch {
      if (agSaveTimer.current) clearTimeout(agSaveTimer.current);
      agSaveTimer.current = setTimeout(() => { void persistAgency(d); }, 4000);
    }
  }, [accessToken]);

  useEffect(() => {
    agFormRef.current = agencyDraft;
    if (!agencyDraft || !agencyDraft.id) return;
    const sig = JSON.stringify(agencyDraft);
    if (sig === agSeedRef.current) return;
    if (agSaveTimer.current) clearTimeout(agSaveTimer.current);
    const snap = agencyDraft;
    agSaveTimer.current = setTimeout(() => { void persistAgency(snap); }, 600);
    return () => { if (agSaveTimer.current) clearTimeout(agSaveTimer.current); };
  }, [agencyDraft, persistAgency]);

  function closeAgencyDraft() {
    if (agSaveTimer.current) clearTimeout(agSaveTimer.current);
    const d = agFormRef.current;
    if (d && d.id && JSON.stringify(d) !== agSeedRef.current) void persistAgency(d);
    setAgencyDraft(null);
  }

  // Read a chosen file as a data: URL, capped at 300 KB raw to keep the
  // base64 payload under the API's 300 KB ceiling (org logos live in
  // logo_filename — see /api/portal/admin/organizations/[id] PATCH).
  function onLogoFile(file: File) {
    if (file.size > 300_000) { alert(L.logoTooBig); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      setAgencyDraft(d => d ? { ...d, logoDataUrl: url } : d);
    };
    reader.readAsDataURL(file);
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
        alert(`${L.errToggle}:\n${msg}`);
        return;
      }
      await load(accessToken);
    } catch {
      alert(`${L.errToggle} ${L.errNet}`);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{L.title}</h1>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--w3)" }}>{tab === "employers" ? L.hint : L.agencyHint}</p>
        </div>
        {tab === "employers" ? (
          <button onClick={() => { seedRef.current = ""; setDraft({ ...EMPTY_DRAFT }); }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold transition-opacity hover:opacity-80"
            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
            <Plus size={13} strokeWidth={2} /> {L.newBtn}
          </button>
        ) : (
          <button onClick={() => { agSeedRef.current = ""; setAgencyDraft({ ...EMPTY_AGENCY }); }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold transition-opacity hover:opacity-80"
            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
            <Plus size={13} strokeWidth={2} /> {L.newAgency}
          </button>
        )}
      </div>

      {/* Segmented tabs — Employers | Agencies */}
      <div className="flex gap-2 mb-4">
        {(["employers", "agencies"] as const).map(k => {
          const active = tab === k;
          return (
            <button key={k} type="button" onClick={() => setTab(k)}
              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
              style={{
                background: active ? "var(--gdim)" : "var(--bg2)",
                color:      active ? "var(--gold)" : "var(--w3)",
                border: `1px solid ${active ? "var(--border-gold)" : "var(--border)"}`,
              }}>
              {k === "employers" ? L.tabEmployers : L.tabAgencies}
            </button>
          );
        })}
      </div>

      {tab === "agencies" ? (
        loading ? (
          <p className="text-[12px] py-8 text-center" style={{ color: "var(--w3)" }}>{L.loading}</p>
        ) : orgs.length === 0 ? (
          <p className="text-[12px] py-8 text-center" style={{ color: "var(--w3)" }}>{L.emptyAgencies}</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            {orgs.map((o, idx) => {
              const usedN = empCountByAgency.get(o.id) ?? 0;
              return (
                <div key={o.id} className="px-4 py-3 flex items-center gap-3"
                  style={{ borderTop: idx === 0 ? "none" : "1px solid var(--border)" }}>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
                    style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                    {o.logo_filename ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.logo_filename.startsWith("data:") ? o.logo_filename : `/logos/${o.logo_filename}`} alt={o.name}
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    ) : (
                      <ImageIcon size={14} strokeWidth={1.6} style={{ color: "var(--w3)" }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold truncate" style={{ color: "var(--w)" }}>{o.name}</p>
                    <p className="text-[11.5px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>
                      {o.footer_text ? o.footer_text.split("\n").join(" · ") : L.usedBy(usedN)}
                    </p>
                  </div>
                  <button onClick={() => { const d = toAgencyDraft(o); agSeedRef.current = JSON.stringify(d); setAgencyDraft(d); }}
                    title={L.edit} aria-label={L.edit}
                    className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ color: "var(--w2)" }}>
                    <Pencil size={13} strokeWidth={1.8} />
                  </button>
                </div>
              );
            })}
          </div>
        )
      ) : loading ? (
        <p className="text-[12px] py-8 text-center" style={{ color: "var(--w3)" }}>{L.loading}</p>
      ) : employers.length === 0 ? (
        <p className="text-[12px] py-8 text-center" style={{ color: "var(--w3)" }}>{L.empty}</p>
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
                      {L.via} {orgsById.get(e.agency_id) ?? "—"}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>{L.direct}</span>
                  )}
                  {!e.active && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>{L.inactive}</span>
                  )}
                </div>
                <p className="text-[11.5px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>
                  {(e.address_lines ?? []).join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => { const d = toDraft(e); seedRef.current = JSON.stringify(d); setDraft(d); }} title={L.edit} aria-label={L.edit}
                  className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center" style={{ color: "var(--w2)" }}>
                  <Pencil size={13} strokeWidth={1.8} />
                </button>
                <button onClick={() => toggleActive(e)} title={e.active ? L.deactivate : L.reactivate} aria-label={e.active ? L.deactivate : L.reactivate}
                  className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ color: e.active ? "var(--w2)" : "var(--gold)" }}>
                  {e.active ? <PowerOff size={13} strokeWidth={1.8} /> : <Power size={13} strokeWidth={1.8} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {agencyDraft && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
          onClick={() => { if (saving) return; if (agencyDraft?.id) closeAgencyDraft(); else setAgencyDraft(null); }}>
          <div className="w-full max-w-md rounded-[20px] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
            style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)", animation: "bvFadeRise .28s var(--ease-out)", maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)" }}>
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--w)" }}>
                {agencyDraft.id ? L.modalEditAgency : L.modalNewAgency}
              </p>
              <button onClick={() => { if (saving) return; if (agencyDraft?.id) closeAgencyDraft(); else setAgencyDraft(null); }}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center" style={{ color: "var(--w3)" }}>
                <XIcon size={14} strokeWidth={1.8} />
              </button>
            </div>
            <div className="px-5 py-5 overflow-y-auto space-y-3" style={{ minHeight: 0 }}>
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>{L.agencyName}</label>
                <input value={agencyDraft.name} onChange={e => setAgencyDraft(d => d ? { ...d, name: e.target.value } : d)}
                  placeholder="Calmaroi GmbH"
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }} />
              </div>

              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>{L.logoLbl}</label>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0"
                    style={{ background: "var(--bg2)", border: "1px solid var(--border2)" }}>
                    {agencyDraft.logoDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={agencyDraft.logoDataUrl.startsWith("data:") ? agencyDraft.logoDataUrl : `/logos/${agencyDraft.logoDataUrl}`} alt=""
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    ) : (
                      <ImageIcon size={18} strokeWidth={1.6} style={{ color: "var(--w3)" }} />
                    )}
                  </div>
                  <label className="bv-row-hover py-1.5 px-3 text-[11px] font-semibold rounded-lg cursor-pointer inline-flex items-center gap-1.5"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                    {agencyDraft.logoDataUrl ? L.logoReplace : L.logoUpload}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) onLogoFile(f); e.currentTarget.value = ""; }} />
                  </label>
                  {agencyDraft.logoDataUrl && (
                    <button type="button" onClick={() => setAgencyDraft(d => d ? { ...d, logoDataUrl: null } : d)}
                      className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center" title={L.logoRemove} aria-label={L.logoRemove}
                      style={{ color: "var(--danger)" }}>
                      <Trash2 size={13} strokeWidth={1.8} />
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>
                  {L.agencyAddress} <span style={{ color: "var(--w3)" }}>{L.agencyAddressHint}</span>
                </label>
                <textarea rows={4} value={agencyDraft.addressText}
                  onChange={e => setAgencyDraft(d => d ? { ...d, addressText: e.target.value } : d)}
                  placeholder={"Calmaroi GmbH\nRömerstraße 15 · 63450\nwww.calmaroi.de"}
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none resize-y"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)", minHeight: 90 }} />
              </div>

              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>{L.notesLbl}</label>
                <textarea rows={2} value={agencyDraft.notes}
                  onChange={e => setAgencyDraft(d => d ? { ...d, notes: e.target.value } : d)}
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none resize-y"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)", minHeight: 56 }} />
              </div>
            </div>
            <div className="px-5 py-4 flex-shrink-0 flex items-center justify-between gap-2" style={{ borderTop: "1px solid var(--border)" }}>
              {agencyDraft.id ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-[11px]"
                    style={{ color: autoSaved ? "var(--success)" : "var(--w3)" }}>
                    <SaveIcon size={12} strokeWidth={1.8} />
                    {autoSaved ? L.autoSaved : L.autoSaving}
                  </span>
                  <button onClick={closeAgencyDraft}
                    className="bv-row-hover py-2 px-4 text-xs font-semibold rounded-xl"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                    {L.done}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={saveAgency} disabled={saving}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                    {saving ? "…" : <><SaveIcon size={12} strokeWidth={1.8} /> {L.save}</>}
                  </button>
                  <button onClick={() => !saving && setAgencyDraft(null)}
                    className="bv-row-hover py-2 px-3 text-xs" style={{ color: "var(--w3)" }}>{L.cancel}</button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {draft && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
          onClick={() => { if (saving) return; if (draft?.id) closeDraft(); else setDraft(null); }}>
          <div className="w-full max-w-md rounded-[20px] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
            style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)", animation: "bvFadeRise .28s var(--ease-out)", maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)" }}>
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--w)" }}>
                {draft.id ? L.modalEdit : L.modalNew}
              </p>
              <button onClick={() => { if (saving) return; if (draft?.id) closeDraft(); else setDraft(null); }}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center" style={{ color: "var(--w3)" }}>
                <XIcon size={14} strokeWidth={1.8} />
              </button>
            </div>
            <div className="px-5 py-5 overflow-y-auto space-y-3" style={{ minHeight: 0 }}>
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>{L.nameLbl}</label>
                <input value={draft.name} onChange={e => setDraft(d => d ? { ...d, name: e.target.value } : d)}
                  placeholder="UKSH Kiel"
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }} />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>{L.slugLbl}</label>
                <input value={draft.slug} onChange={e => setDraft(d => d ? { ...d, slug: e.target.value } : d)}
                  placeholder="uksh_kiel"
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none font-mono"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }} />
              </div>

              {/* Source — Direct employer (no agency) vs Through an agency. */}
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>{L.source}</label>
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
                        {src === "direct" ? L.directEmp : L.viaAgency}
                      </button>
                    );
                  })}
                </div>
              </div>

              {draft.source === "agency" && (
                <div>
                  <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>{L.agencyLbl}</label>
                  <select value={draft.agencyId ?? ""}
                    onChange={e => setDraft(d => d ? { ...d, agencyId: e.target.value || null } : d)}
                    className="w-full rounded-lg px-2.5 py-2 text-xs outline-none"
                    style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }}>
                    <option value="">{L.pick}</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  {orgs.length === 0 && (
                    <p className="text-[10.5px] mt-1" style={{ color: "var(--w3)" }}>{L.noOrgs}</p>
                  )}
                </div>
              )}
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>
                  {L.addressLbl} <span style={{ color: "var(--w3)" }}>{L.addressHint}</span>
                </label>
                <textarea rows={6} value={draft.addressText} onChange={e => setDraft(d => d ? { ...d, addressText: e.target.value } : d)}
                  placeholder={"Universitätsklinikum Schleswig-Holstein\nCampus Kiel\nPersonalabteilung\nArnold-Heller-Straße 3\n24105 Kiel"}
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none resize-y"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)", minHeight: 120 }} />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--w2)" }}>{L.notesLbl}</label>
                <textarea rows={2} value={draft.notes} onChange={e => setDraft(d => d ? { ...d, notes: e.target.value } : d)}
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none resize-y"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)", minHeight: 56 }} />
              </div>
              <label className="inline-flex items-center gap-2 text-xs select-none" style={{ color: "var(--w2)" }}>
                <input type="checkbox" checked={draft.active}
                  onChange={e => setDraft(d => d ? { ...d, active: e.target.checked } : d)} />
                {L.activeLbl}
              </label>
            </div>
            <div className="px-5 py-4 flex-shrink-0 flex items-center justify-between gap-2" style={{ borderTop: "1px solid var(--border)" }}>
              {draft.id ? (
                <>
                  {/* Edit mode: no Save button — autosaves on every change. */}
                  <span className="inline-flex items-center gap-1.5 text-[11px]"
                    style={{ color: autoSaved ? "var(--success)" : "var(--w3)" }}>
                    <SaveIcon size={12} strokeWidth={1.8} />
                    {autoSaved ? L.autoSaved : L.autoSaving}
                  </span>
                  <button onClick={closeDraft}
                    className="bv-row-hover py-2 px-4 text-xs font-semibold rounded-xl"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                    {L.done}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={save} disabled={saving}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                    {saving ? "…" : <><SaveIcon size={12} strokeWidth={1.8} /> {L.save}</>}
                  </button>
                  <button onClick={() => !saving && setDraft(null)}
                    className="bv-row-hover py-2 px-3 text-xs" style={{ color: "var(--w3)" }}>{L.cancel}</button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
