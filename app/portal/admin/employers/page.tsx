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
import { PageHead, Btn, Card, Seg, Field, Empty, Pager, usePaged, STATUS_DOT } from "@/components/fx/kit";

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
        hint: "Alimente l'affectation et le bloc destinataire du Motivationsschreiben.",
        newBtn: "Nouvel employeur", loading: "Chargement…", empty: "Aucun employeur pour le moment.",
        inactive: "inactif", direct: "direct", via: "via",
        edit: "Modifier", deactivate: "Désactiver", reactivate: "Réactiver",
        modalEdit: "Modifier l'employeur", modalNew: "Nouvel employeur",
        nameLbl: "Nom *", slugLbl: "Slug (optionnel, a–z 0–9 _ -)",
        source: "Source", directEmp: "Employeur direct", viaAgency: "Via une agence",
        agencyLbl: "Agence *", pick: "— choisir —",
        noOrgs: "Pas encore d'agences. Créez-en une sous Agences.",
        addressLbl: "Lignes d'adresse *", addressHint: "(une par ligne)",
        notesLbl: "Notes (optionnel)", activeLbl: "Actif (disponible pour l'affectation)",
        save: "Enregistrer", cancel: "Annuler", close: "Fermer",
        autoSaving: "Enregistrement automatique", autoSaved: "Enregistré automatiquement", done: "Terminé",
        errName: "Nom requis.", errAddress: "Au moins une ligne d'adresse requise.",
        errAgency: "Veuillez choisir une agence.",
        errSave: "Échec de l'enregistrement", errAutoSave: "Échec de l'enregistrement automatique",
        errToggle: "Échec du changement de statut", errNet: "(Erreur réseau)",
        tabEmployers: "Employeurs", tabAgencies: "Agences",
        agencyHint: "Logo et adresse figurent sur le CV et la lettre de motivation.",
        newAgency: "Nouvelle agence", emptyAgencies: "Aucune agence pour l'instant.",
        modalNewAgency: "Nouvelle agence", modalEditAgency: "Modifier l'agence",
        agencyName: "Nom *",
        agencyAddress: "Adresse (pied de CV)", agencyAddressHint: "Une par ligne — apparaît sous chaque page du CV.",
        logoLbl: "Logo", logoUpload: "Téléverser un logo", logoReplace: "Remplacer le logo", logoRemove: "Retirer",
        logoTooBig: "Image trop grande — max 300 Ko.",
        usedBy: (n: number) => `Utilisée par ${n} employeur${n !== 1 ? "s" : ""}`,
      }
    : lang === "de"
    ? {
        title: "Arbeitgeber verwalten",
        hint: "Für die Zuweisung und den Empfängerblock im Motivationsschreiben.",
        newBtn: "Neuer Arbeitgeber", loading: "Laden…", empty: "Noch keine Arbeitgeber.",
        inactive: "inaktiv", direct: "direkt", via: "via",
        edit: "Bearbeiten", deactivate: "Deaktivieren", reactivate: "Reaktivieren",
        modalEdit: "Arbeitgeber bearbeiten", modalNew: "Neuer Arbeitgeber",
        nameLbl: "Name *", slugLbl: "Slug (optional, a–z 0–9 _ -)",
        source: "Quelle", directEmp: "Direkter Arbeitgeber", viaAgency: "Über Agentur",
        agencyLbl: "Agentur *", pick: "— wählen —",
        noOrgs: "Noch keine Agenturen. Lege eine unter Agenturen an.",
        addressLbl: "Adresszeilen *", addressHint: "(eine pro Zeile)",
        notesLbl: "Notizen (optional)", activeLbl: "Aktiv (für Zuweisung verfügbar)",
        save: "Speichern", cancel: "Abbrechen", close: "Schließen",
        autoSaving: "Wird automatisch gespeichert", autoSaved: "Automatisch gespeichert", done: "Fertig",
        errName: "Name erforderlich.", errAddress: "Mindestens eine Adresszeile erforderlich.",
        errAgency: "Bitte eine Agentur auswählen.",
        errSave: "Speichern fehlgeschlagen", errAutoSave: "Auto-Speichern fehlgeschlagen",
        errToggle: "Statuswechsel fehlgeschlagen", errNet: "(Netzwerkfehler)",
        tabEmployers: "Arbeitgeber", tabAgencies: "Agenturen",
        agencyHint: "Logo und Adresse stehen auf Lebenslauf und Motivationsschreiben.",
        newAgency: "Neue Agentur", emptyAgencies: "Noch keine Agenturen.",
        modalNewAgency: "Neue Agentur", modalEditAgency: "Agentur bearbeiten",
        agencyName: "Name *",
        agencyAddress: "Adresse (CV-Fußzeile)", agencyAddressHint: "Eine pro Zeile — erscheint unter jeder Lebenslauf-Seite.",
        logoLbl: "Logo", logoUpload: "Logo hochladen", logoReplace: "Logo ersetzen", logoRemove: "Entfernen",
        logoTooBig: "Bild zu groß — max 300 KB.",
        usedBy: (n: number) => `Genutzt von ${n} Arbeitgeber${n !== 1 ? "n" : ""}`,
      }
    : {
        title: "Manage employers",
        hint: "Feeds the assignment picker and the motivation-letter recipient block.",
        newBtn: "New employer", loading: "Loading…", empty: "No employers yet.",
        inactive: "inactive", direct: "direct", via: "via",
        edit: "Edit", deactivate: "Deactivate", reactivate: "Reactivate",
        modalEdit: "Edit employer", modalNew: "New employer",
        nameLbl: "Name *", slugLbl: "Slug (optional, a–z 0–9 _ -)",
        source: "Source", directEmp: "Direct employer", viaAgency: "Through an agency",
        agencyLbl: "Agency *", pick: "— choose —",
        noOrgs: "No agencies yet. Create one under Agencies.",
        addressLbl: "Address lines *", addressHint: "(one per line)",
        notesLbl: "Notes (optional)", activeLbl: "Active (available for assignment)",
        save: "Save", cancel: "Cancel", close: "Close",
        autoSaving: "Saves automatically", autoSaved: "Auto-saved", done: "Done",
        errName: "Name required.", errAddress: "At least one address line required.",
        errAgency: "Please select an agency.",
        errSave: "Save failed", errAutoSave: "Auto-save failed",
        errToggle: "Status change failed", errNet: "(Network error)",
        tabEmployers: "Employers", tabAgencies: "Agencies",
        agencyHint: "Logo and address appear on the CV and motivation letter.",
        newAgency: "New agency", emptyAgencies: "No agencies yet.",
        modalNewAgency: "New agency", modalEditAgency: "Edit agency",
        agencyName: "Name *",
        agencyAddress: "Address (CV footer)", agencyAddressHint: "One per line — shown under every CV page.",
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
        // Borivon team, not supreme-only: a sub-admin who can place a candidate
        // with an employer has to be able to SEE the employer list. Agencies stay
        // out — this page shows every employer, including other agencies'.
        // Mirrors the same predicate the API applies server-side.
        const borivonTeam = j?.role === "admin" || (j?.role === "sub_admin" && !j?.isAgencyAdmin);
        if (!borivonTeam) { router.replace("/portal/admin"); return; }
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

  // the one design (founder 2026-11-13): serif head, ONE black button, Seg for the two lists, hairline rows
  // that flip (nobody scrolls), the two editors in the universal popup (LAW #36) with the kit's fields.
  return (
    <div className="mx-auto w-full px-4" style={{ maxWidth: 760, paddingTop: 90, paddingBottom: 32 }}>
      <style>{EMP_CSS}</style>
      <PageHead
        title={L.title}
        sub={tab === "employers" ? L.hint : L.agencyHint}
        actions={tab === "employers" ? (
          <Btn kind="primary" onClick={() => { seedRef.current = ""; setDraft({ ...EMPTY_DRAFT }); }}>
            <Plus size={15} strokeWidth={2} />{L.newBtn}
          </Btn>
        ) : (
          <Btn kind="primary" onClick={() => { agSeedRef.current = ""; setAgencyDraft({ ...EMPTY_AGENCY }); }}>
            <Plus size={15} strokeWidth={2} />{L.newAgency}
          </Btn>
        )} />

      {/* Segmented tabs — Employers | Agencies */}
      <div style={{ marginBottom: 16 }}>
        <Seg value={tab} options={[["employers", L.tabEmployers], ["agencies", L.tabAgencies]]} onChange={(k) => setTab(k)} />
      </div>

      {tab === "agencies" ? (
        loading ? (
          <Card><Empty>{L.loading}</Empty></Card>
        ) : orgs.length === 0 ? (
          <Card><Empty>{L.emptyAgencies}</Empty></Card>
        ) : (
          <Paged items={orgs} per={7} perPhone={6}>
            {slice => (
              <Card style={{ overflow: "hidden" }}>
                {slice.map((o, idx) => {
                  const usedN = empCountByAgency.get(o.id) ?? 0;
                  return (
                    <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 10px 10px 14px", borderTop: idx === 0 ? "none" : "1px solid var(--border)" }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", overflow: "hidden", flex: "none", background: "var(--bg2)" }}>
                        {o.logo_filename ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={o.logo_filename.startsWith("data:") ? o.logo_filename : `/logos/${o.logo_filename}`} alt={o.name}
                            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                        ) : (
                          <ImageIcon size={15} strokeWidth={1.6} style={{ color: "var(--w3)" }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={ROW_NAME}>{o.name}</div>
                        <div style={ROW_META}>{o.footer_text ? o.footer_text.split("\n").join(" · ") : L.usedBy(usedN)}</div>
                      </div>
                      <Btn kind="quiet" size="sm" icon onClick={() => { const d = toAgencyDraft(o); agSeedRef.current = JSON.stringify(d); setAgencyDraft(d); }}
                        title={L.edit} aria-label={L.edit}>
                        <Pencil size={14} strokeWidth={1.8} />
                      </Btn>
                    </div>
                  );
                })}
              </Card>
            )}
          </Paged>
        )
      ) : loading ? (
        <Card><Empty>{L.loading}</Empty></Card>
      ) : employers.length === 0 ? (
        <Card><Empty>{L.empty}</Empty></Card>
      ) : (
        <Paged items={employers} per={7} perPhone={6}>
          {slice => (
            <Card style={{ overflow: "hidden" }}>
              {slice.map((e, idx) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "11px 10px 11px 18px", borderTop: idx === 0 ? "none" : "1px solid var(--border)" }}>
                  <div style={{ flex: 1, minWidth: 0, marginRight: 8, opacity: e.active ? 1 : 0.55 }}>
                    <div style={ROW_NAME}>{e.name}</div>
                    <div style={ROW_META}>
                      {e.agency_id ? <>{L.via} <span style={{ color: "var(--w2)" }}>{orgsById.get(e.agency_id) ?? "—"}</span></> : L.direct}
                      {e.slug ? ` · ${e.slug}` : ""}
                      {(e.address_lines ?? []).length > 0 ? ` · ${(e.address_lines ?? []).join(" · ")}` : ""}
                    </div>
                  </div>
                  {!e.active && <span style={{ ...STATE_WORD, marginRight: 4 }}>{L.inactive}</span>}
                  <Btn kind="quiet" size="sm" icon onClick={() => { const d = toDraft(e); seedRef.current = JSON.stringify(d); setDraft(d); }} title={L.edit} aria-label={L.edit}>
                    <Pencil size={14} strokeWidth={1.8} />
                  </Btn>
                  <Btn kind="quiet" size="sm" icon onClick={() => toggleActive(e)} title={e.active ? L.deactivate : L.reactivate} aria-label={e.active ? L.deactivate : L.reactivate}>
                    {e.active ? <PowerOff size={14} strokeWidth={1.8} /> : <Power size={14} strokeWidth={1.8} />}
                  </Btn>
                </div>
              ))}
            </Card>
          )}
        </Paged>
      )}

      {agencyDraft && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
          style={MODAL_BACK}
          onClick={() => { if (saving) return; if (agencyDraft?.id) closeAgencyDraft(); else setAgencyDraft(null); }}>
          <div role="dialog" aria-modal="true" aria-label={agencyDraft.id ? L.modalEditAgency : L.modalNewAgency}
            onClick={e => e.stopPropagation()} style={{ ...MODAL_CARD, maxWidth: 460 }}>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "20px 22px 4px" }}>
              <h2 style={{ ...MODAL_TITLE, flex: 1 }}>{agencyDraft.id ? L.modalEditAgency : L.modalNewAgency}</h2>
              <Btn kind="quiet" icon onClick={() => { if (saving) return; if (agencyDraft?.id) closeAgencyDraft(); else setAgencyDraft(null); }}
                title={L.close} aria-label={L.close}>
                <XIcon size={18} strokeWidth={1.6} />
              </Btn>
            </div>
            <div style={{ overflowY: "auto", minHeight: 0, padding: "12px 22px 6px", display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label={L.agencyName}>
                <input className="bvk-input" value={agencyDraft.name} onChange={e => setAgencyDraft(d => d ? { ...d, name: e.target.value } : d)}
                  placeholder="Calmaroi GmbH" />
              </Field>

              <div className="bvk-field">
                <span>{L.logoLbl}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 12, display: "grid", placeItems: "center", overflow: "hidden", flex: "none", background: "var(--bg2)" }}>
                    {agencyDraft.logoDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={agencyDraft.logoDataUrl.startsWith("data:") ? agencyDraft.logoDataUrl : `/logos/${agencyDraft.logoDataUrl}`} alt=""
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    ) : (
                      <ImageIcon size={18} strokeWidth={1.6} style={{ color: "var(--w3)" }} />
                    )}
                  </div>
                  <label className="bvk-btn bvk-ghost bvk-sm">
                    {agencyDraft.logoDataUrl ? L.logoReplace : L.logoUpload}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) onLogoFile(f); e.currentTarget.value = ""; }} />
                  </label>
                  {agencyDraft.logoDataUrl && (
                    <Btn kind="quiet" size="sm" icon onClick={() => setAgencyDraft(d => d ? { ...d, logoDataUrl: null } : d)}
                      title={L.logoRemove} aria-label={L.logoRemove}>
                      <Trash2 size={14} strokeWidth={1.8} />
                    </Btn>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Field label={L.agencyAddress}>
                  <textarea className="bvk-input" rows={3} value={agencyDraft.addressText}
                    onChange={e => setAgencyDraft(d => d ? { ...d, addressText: e.target.value } : d)}
                    placeholder={"Calmaroi GmbH\nRömerstraße 15 · 63450\nwww.calmaroi.de"}
                    style={{ lineHeight: 1.5 }} />
                </Field>
                <span style={{ fontSize: 12, color: "var(--w3)" }}>{L.agencyAddressHint}</span>
              </div>

              <Field label={L.notesLbl}>
                <textarea className="bvk-input" rows={2} value={agencyDraft.notes}
                  onChange={e => setAgencyDraft(d => d ? { ...d, notes: e.target.value } : d)}
                  style={{ minHeight: 60 }} />
              </Field>
            </div>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: agencyDraft.id ? "space-between" : "flex-end", gap: 8, padding: "14px 22px 20px" }}>
              {agencyDraft.id ? (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: autoSaved ? STATUS_DOT.approved : "var(--w3)" }}>
                    <SaveIcon size={13} strokeWidth={1.8} />
                    {autoSaved ? L.autoSaved : L.autoSaving}
                  </span>
                  <Btn kind="primary" onClick={closeAgencyDraft}>{L.done}</Btn>
                </>
              ) : (
                <>
                  <Btn kind="quiet" onClick={() => !saving && setAgencyDraft(null)}>{L.cancel}</Btn>
                  <Btn kind="primary" onClick={saveAgency} disabled={saving}>
                    {saving ? "…" : <><SaveIcon size={14} strokeWidth={1.8} />{L.save}</>}
                  </Btn>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {draft && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
          style={MODAL_BACK}
          onClick={() => { if (saving) return; if (draft?.id) closeDraft(); else setDraft(null); }}>
          <div role="dialog" aria-modal="true" aria-label={draft.id ? L.modalEdit : L.modalNew}
            onClick={e => e.stopPropagation()} style={{ ...MODAL_CARD, maxWidth: 560 }}>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "20px 22px 4px" }}>
              <h2 style={{ ...MODAL_TITLE, flex: 1 }}>{draft.id ? L.modalEdit : L.modalNew}</h2>
              <Btn kind="quiet" icon onClick={() => { if (saving) return; if (draft?.id) closeDraft(); else setDraft(null); }}
                title={L.close} aria-label={L.close}>
                <XIcon size={18} strokeWidth={1.6} />
              </Btn>
            </div>
            <div style={{ overflowY: "auto", minHeight: 0, padding: "12px 22px 6px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="bve-g2">
                <Field label={L.nameLbl}>
                  <input className="bvk-input" value={draft.name} onChange={e => setDraft(d => d ? { ...d, name: e.target.value } : d)}
                    placeholder="UKSH Kiel" />
                </Field>
                <Field label={L.slugLbl}>
                  <input className="bvk-input" value={draft.slug} onChange={e => setDraft(d => d ? { ...d, slug: e.target.value } : d)}
                    placeholder="uksh_kiel" style={{ fontFamily: "monospace" }} />
                </Field>
              </div>

              {/* Source — Direct employer (no agency) vs Through an agency. */}
              <div className="bvk-field">
                <span>{L.source}</span>
                <div>
                  <Seg value={draft.source} options={[["direct", L.directEmp], ["agency", L.viaAgency]]}
                    onChange={(src) => setDraft(d => d ? { ...d, source: src, agencyId: src === "direct" ? null : d.agencyId } : d)} />
                </div>
              </div>

              {draft.source === "agency" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Field label={L.agencyLbl}>
                    <select className="bvk-input" value={draft.agencyId ?? ""}
                      onChange={e => setDraft(d => d ? { ...d, agencyId: e.target.value || null } : d)}>
                      <option value="">{L.pick}</option>
                      {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </Field>
                  {orgs.length === 0 && (
                    <span style={{ fontSize: 12, color: "var(--w3)" }}>{L.noOrgs}</span>
                  )}
                </div>
              )}

              <div className="bve-split">
                <Field label={<>{L.addressLbl} <span style={{ textTransform: "none", letterSpacing: 0 }}>{L.addressHint}</span></>}>
                  <textarea className="bvk-input" rows={5} value={draft.addressText} onChange={e => setDraft(d => d ? { ...d, addressText: e.target.value } : d)}
                    placeholder={"Universitätsklinikum Schleswig-Holstein\nCampus Kiel\nPersonalabteilung\nArnold-Heller-Straße 3\n24105 Kiel"}
                    style={{ lineHeight: 1.5 }} />
                </Field>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                  <Field label={L.notesLbl}>
                    <textarea className="bvk-input" rows={2} value={draft.notes} onChange={e => setDraft(d => d ? { ...d, notes: e.target.value } : d)}
                      style={{ minHeight: 60 }} />
                  </Field>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 13.5, color: "var(--w2)", cursor: "pointer", userSelect: "none" }}>
                    <input type="checkbox" checked={draft.active}
                      onChange={e => setDraft(d => d ? { ...d, active: e.target.checked } : d)}
                      style={{ width: 16, height: 16, flex: "none", accentColor: "var(--w)" }} />
                    {L.activeLbl}
                  </label>
                </div>
              </div>
            </div>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: draft.id ? "space-between" : "flex-end", gap: 8, padding: "14px 22px 20px" }}>
              {draft.id ? (
                <>
                  {/* Edit mode: no Save button — autosaves on every change. */}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: autoSaved ? STATUS_DOT.approved : "var(--w3)" }}>
                    <SaveIcon size={13} strokeWidth={1.8} />
                    {autoSaved ? L.autoSaved : L.autoSaving}
                  </span>
                  <Btn kind="primary" onClick={closeDraft}>{L.done}</Btn>
                </>
              ) : (
                <>
                  <Btn kind="quiet" onClick={() => !saving && setDraft(null)}>{L.cancel}</Btn>
                  <Btn kind="primary" onClick={save} disabled={saving}>
                    {saving ? "…" : <><SaveIcon size={14} strokeWidth={1.8} />{L.save}</>}
                  </Btn>
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

// ── the one design: small shared pieces of this page ─────────────────────────
const MODAL_BACK: React.CSSProperties = { background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" };
const MODAL_CARD: React.CSSProperties = {
  width: "100%", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 20,
  background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)",
  animation: "bvFadeRise .28s var(--ease-out)", maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)",
};
const MODAL_TITLE: React.CSSProperties = { margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 26, lineHeight: 1.15, color: "var(--w)" };
const ROW_NAME: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const ROW_META: React.CSSProperties = { fontSize: 12.5, color: "var(--w3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const STATE_WORD: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--w3)", whiteSpace: "nowrap", flex: "none" };
const EMP_CSS = `
.bve-g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:end}
.bve-split{display:grid;grid-template-columns:1.5fr 1fr;gap:12px;align-items:start}
@media (max-width:640px){.bve-split{grid-template-columns:1fr}}`;

/** a list that flips instead of scrolling (components/fx/kit: usePaged + Pager) */
function Paged<T>({ items, per, perPhone, children }: { items: T[]; per: number; perPhone: number; children: (slice: T[]) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, per, perPhone);
  return <>{children(slice)}<Pager page={page} pages={pages} onPage={setPage} /></>;
}
