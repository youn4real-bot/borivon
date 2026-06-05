"use client";

/**
 * Passport-data review — the dashboard's approve/reject + edit flow, as a popup
 * over the pipeline peek so the admin never leaves the candidate.
 *
 * LAW #38: per-field confirmation is HUMAN-ONLY — boxes start unchecked every
 * open, are never auto-ticked, and Approve is blocked until every FILLED field
 * is confirmed (canApprove).
 * LAW #37: admin override is absolute — field edits AUTOSAVE per field (debounced
 * PATCH), re-queue on failure, and flush on exit/unmount so a keystroke is never
 * lost or silently reverted.
 * LAW #39: nothing here touches passport BYTES — values are candidate_profiles
 * TEXT columns; approve/reject/edit is a profiles PATCH.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X as XIcon, IdCard, FilePen, Save, Download } from "lucide-react";
import { CheckCircle2, XCircle } from "@/components/PortalIcons";
import { AdminRejectModal } from "@/components/AdminRejectModal";
import { useLang } from "@/components/LangContext";
import { natToLang, COUNTRY_MAP } from "@/lib/countries";
import { isIOSDevice } from "@/lib/platform";
import { triggerIosDownload } from "@/lib/iosDownload";
import { useDlToken, withDlt } from "@/lib/dlClient";
import {
  type PassportProfile, type PassportGroup,
  PASSPORT_SNAPSHOT_FIELDS, isFilled, canApprove, unconfirmedCount,
} from "@/lib/passportReview";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}
function computeFamilienstand(marital_status: string | null, children_ages: string | null): string {
  if (!marital_status) return "—";
  if (marital_status === "ledig") return marital_status;
  let ages: number[] = [];
  try { ages = JSON.parse(children_ages || "[]"); } catch { ages = []; }
  if (!Array.isArray(ages) || ages.length === 0) return marital_status;
  const sorted = [...ages].filter((a) => typeof a === "number" && a >= 0).sort((a, b) => b - a);
  if (sorted.length === 0) return marital_status;
  const kindStr = sorted.length === 1 ? "1 Kind" : `${sorted.length} Kinder`;
  return `${marital_status}, ${kindStr} (${sorted.join(", ")})`;
}
/** Stored nationality/country value (name in any lang OR ISO code) → ISO code. */
function toIsoCode(v: string | null | undefined): string {
  if (!v) return "";
  const up = v.trim().toUpperCase();
  if ((COUNTRY_MAP as Record<string, unknown>)[up]) return up;
  for (const [code, names] of Object.entries(COUNTRY_MAP)) {
    if ([names.fr.toUpperCase(), names.en.toUpperCase(), names.de.toUpperCase()].includes(up)) return code;
  }
  return "";
}
/** ASCII filename slug (matches the dashboard's passport-data PDF naming). */
function slug(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function buildPassportGroups(p: PassportProfile, lang: string): PassportGroup[] {
  const fmt = (iso: string | null) => (iso ? fmtDate(iso) : "—");
  const up = (s: string | null) => (s ?? "—").toUpperCase();
  const nat = (v: string | null) => (!v || v === "—" ? "—" : (natToLang(v, lang as "fr" | "en" | "de") || "—")).toUpperCase();
  const sex = p.sex === "M" ? (lang === "fr" ? "MASCULIN" : lang === "de" ? "MÄNNLICH" : "MALE")
    : p.sex === "F" ? (lang === "fr" ? "FÉMININ" : lang === "de" ? "WEIBLICH" : "FEMALE")
    : (p.sex ?? "—").toUpperCase();
  const G = lang === "fr"
    ? { personal: "Personnel", passport: "Passeport", address: "Adresse", ln: "Nom de famille", fn: "Prénom", dob: "Date de naissance", sex: "Sexe", nat: "Nationalité", cob: "Ville de naissance", cntob: "Pays de naissance", pno: "N° passeport", isd: "Date d'émission", exp: "Date d'expiration", iss: "Autorité émettrice", str: "Rue", num: "N°", post: "Code postal", cres: "Ville de résidence", cntres: "Pays de résidence", marital: "Situation familiale" }
    : lang === "de"
    ? { personal: "Persönlich", passport: "Reisepass", address: "Adresse", ln: "Nachname", fn: "Vorname", dob: "Geburtsdatum", sex: "Geschlecht", nat: "Staatsangehörigkeit", cob: "Geburtsort", cntob: "Geburtsland", pno: "Reisepassnummer", isd: "Ausstellungsdatum", exp: "Ablaufdatum", iss: "Ausstellungsbehörde", str: "Straße", num: "Hausnummer", post: "Postleitzahl", cres: "Wohnort", cntres: "Wohnland", marital: "Familienstand" }
    : { personal: "Personal", passport: "Passport", address: "Address", ln: "Last name", fn: "First name", dob: "Date of birth", sex: "Sex", nat: "Nationality", cob: "City of birth", cntob: "Country of birth", pno: "Passport No", isd: "Issue date", exp: "Expiry", iss: "Issuing authority", str: "Street", num: "Number", post: "Postal code", cres: "City of residence", cntres: "Country of residence", marital: "Marital status" };
  return [
    { title: G.personal, fields: [
      { label: G.ln, value: up(p.last_name) },
      { label: G.fn, value: up(p.first_name) },
      { label: G.dob, value: fmt(p.dob) },
      { label: G.sex, value: sex },
      { label: G.nat, value: nat(p.nationality) },
      { label: G.cob, value: up(p.city_of_birth) },
      { label: G.cntob, value: nat(p.country_of_birth) },
      ...(p.marital_status ? [{ label: G.marital, value: computeFamilienstand(p.marital_status, p.children_ages).toUpperCase() }] : []),
    ] },
    { title: G.passport, fields: [
      { label: G.pno, value: (p.passport_no ?? "—").toUpperCase() },
      { label: G.isd, value: fmt(p.issue_date) },
      { label: G.exp, value: fmt(p.passport_expiry) },
      { label: G.iss, value: up(p.issuing_authority) },
    ] },
    { title: G.address, fields: [
      { label: G.str, value: up(p.address_street) },
      { label: G.num, value: p.address_number ?? "—" },
      { label: G.post, value: p.address_postal ?? "—" },
      { label: G.cres, value: up(p.city_of_residence) },
      { label: G.cntres, value: nat(p.country_of_residence) },
    ] },
  ];
}

const CheckBox = ({ state }: { state: "empty" | "partial" | "done" }) =>
  state === "done" ? (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect width="16" height="16" rx="3.5" fill="var(--success)" /><path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ) : state === "partial" ? (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="var(--warning)" strokeWidth="1.5" /><path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="var(--warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.35" /></svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="var(--border)" strokeWidth="1.5" /></svg>
  );

export function PassportReviewModal({ profile, userId, accessToken, onClose, onReviewed, onProfileChange }: {
  profile: PassportProfile;
  userId: string;
  accessToken: string;
  onClose: () => void;
  onReviewed: (status: "approved" | "rejected", feedback: string | null) => void;
  /** Bubble saved field edits up so the parent's cached profile stays in sync. */
  onProfileChange?: (patch: Partial<PassportProfile>) => void;
}) {
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  // Local source of truth — seeded from the prop, advanced by saved edits so the
  // review view + approve snapshot always reflect the latest values.
  const [prof, setProf] = useState<PassportProfile>(profile);
  // LAW #38: confirmation starts EMPTY every open; only a human click fills it.
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [savedAs, setSavedAs] = useState<"approved" | "rejected" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // ── Edit mode (LAW #37 autosave) ──
  const [editMode, setEditMode] = useState(false);
  const [edits, setEdits] = useState<Partial<PassportProfile>>({});
  const [autoSaved, setAutoSaved] = useState(false);
  const editsRef = useRef<Partial<PassportProfile>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pdfDl, setPdfDl] = useState(false);
  // iOS can't download a client-side blob → it streams the PDF via GET with a
  // short-lived signed token. Desktop uses the POST blob path (no token needed).
  const dlt = useDlToken(isIOSDevice() ? accessToken : null);

  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);

  // Persist a snapshot of edits (the AUTOSAVE writer). Merges into local prof on
  // success; re-queues + retries on failure so nothing is lost (LAW #37).
  const flush = useCallback(async (snap: Partial<PassportProfile>) => {
    const keys = Object.keys(snap);
    if (keys.length === 0 || !accessToken) return;
    try {
      const res = await fetch("/api/portal/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId, profile: snap }),
      });
      if (res.ok) {
        setProf((p) => ({ ...p, ...snap }));
        onProfileChange?.(snap);
        for (const k of keys) {
          if ((editsRef.current as Record<string, unknown>)[k] === (snap as Record<string, unknown>)[k]) {
            delete (editsRef.current as Record<string, unknown>)[k];
          }
        }
        setAutoSaved(true);
        setTimeout(() => setAutoSaved(false), 1600);
      } else {
        editsRef.current = { ...snap, ...editsRef.current };
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { void flush({ ...editsRef.current }); }, 4000);
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        setErr(msg);
      }
    } catch {
      editsRef.current = { ...snap, ...editsRef.current };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void flush({ ...editsRef.current }); }, 4000);
    }
  }, [userId, accessToken, onProfileChange]);

  // Debounced per-field autosave: 600ms after the last keystroke.
  useEffect(() => {
    editsRef.current = { ...editsRef.current, ...edits };
    if (!editMode || Object.keys(edits).length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const snap = { ...edits };
    saveTimer.current = setTimeout(() => { void flush(snap); }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [edits, editMode, flush]);

  // Never lose the last keystrokes on close/unmount (LAW #37) — keepalive flush.
  useEffect(() => {
    const tok = accessToken; const uid = userId;
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const pending = { ...editsRef.current };
      editsRef.current = {};
      if (uid && tok && Object.keys(pending).length > 0) {
        fetch("/api/portal/admin", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ userId: uid, profile: pending }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [accessToken, userId]);

  function exitEdit() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const pending = { ...editsRef.current, ...edits };
    if (Object.keys(pending).length > 0) void flush(pending);
    editsRef.current = {};
    setEdits({});
    setEditMode(false);
  }

  const pst = prof.passport_status ?? null;
  const groups = buildPassportGroups(prof, lang);
  const approvable = canApprove(groups, confirmed);
  const remaining = unconfirmedCount(groups, confirmed);
  const isApproved = pst === "approved";

  const pstLabel = pst === "approved" ? T("Approved", "Genehmigt", "Approuvé")
    : pst === "rejected" ? T("Rejected", "Abgelehnt", "Refusé")
    : pst === "pending" ? T("Pending review", "In Prüfung", "En cours de vérification")
    : T("Not submitted", "Nicht eingereicht", "Non soumis");
  const pstColor = pst === "approved" ? "var(--success)" : pst === "rejected" ? "var(--danger)" : "#f59e0b";
  const pstBg = pst === "approved" ? "var(--success-bg)" : pst === "rejected" ? "var(--danger-bg)" : "var(--gdim)";
  const pstBdr = pst === "approved" ? "var(--success-border)" : pst === "rejected" ? "var(--danger-border)" : "var(--border-gold)";

  async function review(status: "approved" | "rejected", feedback: string | null) {
    if (submitting) return;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    setSubmitting(true);
    setErr(null);
    try {
      const profileUpdate: Record<string, unknown> = { passport_status: status };
      if (status === "rejected") profileUpdate.passport_feedback = feedback || null;
      if (status === "approved") {
        // Snapshot confirmed values (merged: saved prof + any unsaved edits).
        const merged = { ...prof, ...editsRef.current, ...edits } as PassportProfile;
        for (const k of PASSPORT_SNAPSHOT_FIELDS) {
          const v = merged[k as keyof PassportProfile];
          if (v != null && v !== "") profileUpdate[k] = v;
        }
        editsRef.current = {};
      }
      const res = await fetch("/api/portal/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId, profile: profileUpdate }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        setErr(msg);
        return;
      }
      setRejectOpen(false);
      setSavedAs(status);
      onReviewed(status, status === "rejected" ? (feedback || null) : null);
      setTimeout(onClose, 700);
    } catch {
      setErr(T("Network error — try again", "Netzwerkfehler", "Erreur réseau"));
    } finally {
      setSubmitting(false);
    }
  }

  // Download the confirmed passport data as a PDF (only meaningful once
  // approved). Desktop = POST → blob; iOS = GET with a signed token (it can't
  // download a client blob). Named exactly like the dashboard export.
  async function downloadDataPdf() {
    if (pdfDl) return;
    setPdfDl(true);
    try {
      const docTitle = T("Passport Data", "Reisepassdaten", "Données du passeport");
      const docSubtitle = T("Extracted and confirmed passport information", "Extrahierte und bestätigte Reisepassdaten", "Informations de passeport extraites et confirmées");
      const outName = `${slug(prof.first_name)}_${slug(prof.last_name)}_pflegekraft_reisepass_daten.pdf`;
      if (isIOSDevice() && accessToken) {
        if (!dlt) { setPdfDl(false); return; }
        const json = JSON.stringify({ groups, docTitle, docSubtitle, filename: outName });
        const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        triggerIosDownload(withDlt(`/api/portal/admin/passport-data-pdf?dl=1&d=${b64}`, dlt), outName, () => setPdfDl(false));
        return;
      }
      const res = await fetch("/api/portal/admin/passport-data-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ groups, filename: outName, docTitle, docSubtitle }),
      });
      if (!res.ok) throw new Error("pdf failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = outName; a.click(); URL.revokeObjectURL(url);
    } catch (e) { console.error("[passport data pdf]", e); }
    setPdfDl(false);
  }

  // ── Edit-mode field config (mirrors the dashboard) ──
  const L = lang === "fr"
    ? { fn: "Prénom", ln: "Nom de famille", dob: "Date de naissance", sex: "Sexe", nat: "Nationalité", cob: "Ville de naissance", cntob: "Pays de naissance", pno: "N° passeport", isd: "Date d'émission", exp: "Date d'expiration", iss: "Autorité émettrice", str: "Rue", num: "N°", post: "Code postal", cres: "Ville de résidence", cntres: "Pays de résidence" }
    : lang === "de"
    ? { fn: "Vorname", ln: "Nachname", dob: "Geburtsdatum", sex: "Geschlecht", nat: "Staatsangehörigkeit", cob: "Geburtsort", cntob: "Geburtsland", pno: "Reisepassnummer", isd: "Ausstellungsdatum", exp: "Ablaufdatum", iss: "Ausstellungsbehörde", str: "Straße", num: "Hausnummer", post: "Postleitzahl", cres: "Wohnort", cntres: "Wohnland" }
    : { fn: "First name", ln: "Last name", dob: "Date of birth", sex: "Sex", nat: "Nationality", cob: "City of birth", cntob: "Country of birth", pno: "Passport No", isd: "Issue date", exp: "Expiry", iss: "Issuing authority", str: "Street", num: "Number", post: "Postal code", cres: "City of residence", cntres: "Country of residence" };
  const modalFields: { key: keyof PassportProfile; label: string; type?: "date" | "select" | "country"; full?: boolean }[] = [
    { key: "first_name", label: L.fn }, { key: "last_name", label: L.ln },
    { key: "dob", label: L.dob, type: "date" }, { key: "sex", label: L.sex, type: "select" },
    { key: "nationality", label: L.nat, type: "country" }, { key: "city_of_birth", label: L.cob },
    { key: "country_of_birth", label: L.cntob, type: "country" }, { key: "passport_no", label: L.pno },
    { key: "issue_date", label: L.isd, type: "date" }, { key: "passport_expiry", label: L.exp, type: "date" },
    { key: "issuing_authority", label: L.iss, full: true }, { key: "address_street", label: L.str },
    { key: "address_number", label: L.num }, { key: "address_postal", label: L.post },
    { key: "city_of_residence", label: L.cres }, { key: "country_of_residence", label: L.cntres, type: "country" },
  ];
  const fieldVal = (key: keyof PassportProfile): string => ((edits[key] ?? prof[key]) as string | null) ?? "";
  const setField = (key: keyof PassportProfile, v: string | null) => setEdits((prev) => ({ ...prev, [key]: v }));
  const inputStyle: React.CSSProperties = { background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-x-0 z-[1200] flex items-center justify-center p-4"
      style={{ top: "calc(58px + var(--bv-subnav-h, 0px))", bottom: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      onClick={() => { if (!submitting) { exitEdit(); onClose(); } }}>
      <div className="w-full max-w-lg flex flex-col overflow-hidden"
        style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "20px", boxShadow: "var(--shadow-lg)", maxHeight: "calc(100dvh - 58px - 2rem)", animation: "bvFadeRise .26s var(--ease-out)" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] inline-flex items-center gap-1.5" style={{ color: "var(--gold)" }}>
              <IdCard size={12} strokeWidth={1.8} /> {T("Passport data", "Reisepassdaten", "Données du passeport")}
            </p>
            {!isApproved && (
              <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold tracking-wide uppercase" style={{ background: pstBg, color: pstColor, border: `1px solid ${pstBdr}` }}>
                {pstLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!savedAs && (
              <button onClick={() => { if (editMode) exitEdit(); else { editsRef.current = {}; setEdits({}); setEditMode(true); } }}
                className="h-7 px-2 rounded-lg flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                style={{ background: editMode ? "var(--info-bg)" : "var(--bg2)", color: editMode ? "var(--info)" : "var(--w3)", border: `1px solid ${editMode ? "var(--info-border)" : "var(--border)"}` }}>
                <FilePen size={11} strokeWidth={1.8} /> {editMode ? T("Editing", "Bearbeiten", "Édition") : T("Edit", "Bearbeiten", "Modifier")}
              </button>
            )}
            {savedAs && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: savedAs === "approved" ? "var(--success-bg)" : "var(--danger-bg)", color: savedAs === "approved" ? "var(--success)" : "var(--danger)", border: `1px solid ${savedAs === "approved" ? "var(--success-border)" : "var(--danger-border)"}` }}>
                {savedAs === "approved" ? <><CheckCircle2 size={13} strokeWidth={1.8} /> {pstLabel}</> : <><XCircle size={13} strokeWidth={1.8} /> {T("Rejected", "Abgelehnt", "Refusé")}</>}
              </span>
            )}
            {isApproved && (
              <button onClick={() => void downloadDataPdf()} disabled={pdfDl}
                aria-label={T("Download data", "Daten herunterladen", "Télécharger les données")} title={T("Download data", "Daten herunterladen", "Télécharger les données")}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40" style={{ color: "var(--w2)" }}>
                {pdfDl ? <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Download size={14} strokeWidth={1.8} />}
              </button>
            )}
            <button onClick={() => { exitEdit(); onClose(); }} aria-label={T("Close", "Schließen", "Fermer")} disabled={submitting} className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40" style={{ color: "var(--w3)" }}>
              <XIcon size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {editMode ? (
            /* ── Edit mode — every field autosaves (LAW #37) ── */
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              {modalFields.map((f) => (
                <div key={f.key} className={f.full ? "col-span-2" : ""}>
                  <label className="text-[10px] font-medium mb-1 block" style={{ color: "var(--w3)" }}>{f.label}</label>
                  {f.type === "country" ? (
                    <select value={toIsoCode(fieldVal(f.key))} onChange={(e) => setField(f.key, e.target.value || null)} className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none" style={inputStyle}>
                      <option value="">—</option>
                      {Object.entries(COUNTRY_MAP).map(([code, names]) => <option key={code} value={code}>{names[lang as "en" | "fr" | "de"]}</option>)}
                    </select>
                  ) : f.type === "select" ? (
                    <select value={fieldVal(f.key)} onChange={(e) => setField(f.key, e.target.value || null)} className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none" style={inputStyle}>
                      <option value="">—</option>
                      <option value="M">{T("Male", "Männlich", "Masculin")}</option>
                      <option value="F">{T("Female", "Weiblich", "Féminin")}</option>
                    </select>
                  ) : f.type === "date" ? (() => {
                    const raw = fieldVal(f.key).slice(0, 10);
                    const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
                    const ger = iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";
                    return (
                      <div className="relative">
                        <input readOnly value={ger} placeholder="TT.MM.JJJJ" className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none cursor-pointer" style={inputStyle} />
                        <input type="date" value={iso} onClick={(e) => { const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void }; el.showPicker?.(); }}
                          onChange={(e) => setField(f.key, e.target.value || null)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" style={{ colorScheme: "dark" }} aria-label={f.label} />
                      </div>
                    );
                  })() : (
                    <input type="text" value={fieldVal(f.key)} onChange={(e) => setField(f.key, e.target.value || null)} className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none" style={inputStyle} />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              {!isApproved && (
                <p className="text-[11px] mb-3" style={{ color: "var(--warning)" }}>
                  {T("Tick every filled field to confirm it matches the passport, then Approve. Use Edit to fix any value.", "Jedes ausgefüllte Feld bestätigen, dann Genehmigen. „Bearbeiten“ korrigiert Werte.", "Cochez chaque champ rempli, puis Approuver. « Modifier » corrige une valeur.")}
                </p>
              )}
              {groups.map((group, gi) => (
                <div key={group.title} className={gi > 0 ? "mt-4" : ""}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--w3)" }}>{group.title}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    {group.fields.map((f) => {
                      const filled = isFilled(f.value);
                      if (isApproved) {
                        return (
                          <div key={f.label} className="min-w-0">
                            <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] mb-0.5" style={{ color: "var(--w3)" }}>{f.label}</p>
                            <p className="text-[12.5px] font-medium" style={{ color: "var(--w)" }}>{f.value}</p>
                          </div>
                        );
                      }
                      const isDone = confirmed.has(f.label);
                      return (
                        <div key={f.label} className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-medium" style={{ color: "var(--w3)" }}>{f.label}</p>
                            <p className="text-xs font-semibold truncate" style={{ color: "var(--w)" }}>{f.value}</p>
                          </div>
                          <button type="button"
                            onClick={() => { if (!filled) return; setConfirmed((prev) => { const n = new Set(prev); if (n.has(f.label)) n.delete(f.label); else n.add(f.label); return n; }); }}
                            title={!filled ? "" : isDone ? T("Reviewed — click to undo", "Geprüft — zum Rückgängig klicken", "Vérifié — cliquez pour annuler") : T("Click to mark reviewed", "Zum Bestätigen klicken", "Cliquez pour confirmer")}
                            className="flex-shrink-0 grid place-items-center w-9 h-9 -my-1" style={{ cursor: filled ? "pointer" : "default" }}>
                            <CheckBox state={!filled ? "empty" : isDone ? "done" : "partial"} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {gi < groups.length - 1 && <div className="mt-3" style={{ height: 1, background: "var(--border)" }} />}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        {editMode ? (
          <div className="px-5 pb-4 pt-3 flex-shrink-0 flex items-center gap-2" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="flex-1 inline-flex items-center gap-1.5 text-xs" style={{ color: autoSaved ? "var(--success)" : "var(--w3)" }}>
              {autoSaved ? <><CheckCircle2 size={12} strokeWidth={1.8} /> {T("Auto-saved", "Automatisch gespeichert", "Enregistré automatiquement")}</> : <><Save size={12} strokeWidth={1.8} /> {T("Saves automatically", "Wird automatisch gespeichert", "Enregistrement automatique")}</>}
            </div>
            <button onClick={exitEdit} className="py-2 px-4 rounded-xl text-xs font-semibold" style={{ background: "var(--gold)", color: "#131312" }}>
              {T("Done", "Fertig", "Terminé")}
            </button>
          </div>
        ) : (!isApproved && !savedAs) ? (
          <div className="px-5 pb-4 pt-3 flex-shrink-0 flex flex-col gap-2" style={{ borderTop: "1px solid var(--border)" }}>
            {err && <span className="text-[11px] font-medium" style={{ color: "var(--danger)" }}>{err}</span>}
            <div className="flex items-center gap-2">
              <button onClick={() => void review("approved", null)} disabled={submitting || !approvable}
                title={!approvable ? T(`${remaining} field(s) not yet reviewed`, `${remaining} Feld(er) ungeprüft`, `${remaining} champ(s) non vérifié(s)`) : ""}
                className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center gap-1.5" style={{ background: "var(--success-bg)", color: "var(--success)" }}>
                {submitting ? "…" : <><CheckCircle2 size={13} strokeWidth={1.8} /> {T("Approve", "Genehmigen", "Approuver")}</>}
              </button>
              <button onClick={() => setRejectOpen(true)} disabled={submitting || pst === "rejected"}
                className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center gap-1.5" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
                {submitting ? "…" : <><XCircle size={13} strokeWidth={1.8} /> {T("Reject", "Ablehnen", "Refuser")}</>}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {rejectOpen && (
        <AdminRejectModal
          target={{ label: T("Passport data", "Reisepassdaten", "Données du passeport"), initialFeedback: prof.passport_feedback ?? "" }}
          onCancel={() => setRejectOpen(false)}
          onSubmit={(text: string) => review("rejected", text)}
        />
      )}
    </div>,
    document.body,
  );
}
