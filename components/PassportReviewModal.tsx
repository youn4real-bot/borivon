"use client";

/**
 * Passport-data review — the dashboard's approve/reject flow, as a popup over
 * the pipeline peek so the admin never leaves the candidate. Faithful to the
 * dashboard: read-only extracted fields, per-field HUMAN-ONLY confirm checkboxes
 * (LAW #38 — start unchecked every session, never auto-ticked; approve is blocked
 * until every filled field is confirmed), approve / reject (reason required).
 *
 * LAW #39: this never touches passport bytes — the values are profile TEXT
 * columns (candidate_profiles), and approve/reject is a candidate_profiles PATCH.
 * Inline field editing + the data-PDF export stay in the full profile.
 */

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X as XIcon, IdCard } from "lucide-react";
import { CheckCircle2, XCircle } from "@/components/PortalIcons";
import { AdminRejectModal } from "@/components/AdminRejectModal";
import { useLang } from "@/components/LangContext";
import { natToLang } from "@/lib/countries";
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

export function PassportReviewModal({ profile, userId, accessToken, onClose, onReviewed }: {
  profile: PassportProfile;
  userId: string;
  accessToken: string;
  onClose: () => void;
  onReviewed: (status: "approved" | "rejected", feedback: string | null) => void;
}) {
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  // LAW #38: confirmation starts EMPTY every open and is only ever filled by a
  // human clicking a field. It is never seeded from any stored value.
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [savedAs, setSavedAs] = useState<"approved" | "rejected" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);

  const pst = profile.passport_status ?? null;
  const groups = buildPassportGroups(profile, lang);
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
    setSubmitting(true);
    setErr(null);
    try {
      const profileUpdate: Record<string, unknown> = { passport_status: status };
      if (status === "rejected") profileUpdate.passport_feedback = feedback || null;
      // On approve, snapshot the confirmed field values into the row (mirrors
      // the dashboard reviewPassport) — raw profile columns, never bytes.
      if (status === "approved") {
        for (const k of PASSPORT_SNAPSHOT_FIELDS) {
          const v = profile[k as keyof PassportProfile];
          if (v != null && v !== "") profileUpdate[k] = v;
        }
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

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-x-0 z-[1200] flex items-center justify-center p-4"
      style={{ top: "calc(58px + var(--bv-subnav-h, 0px))", bottom: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      onClick={() => { if (!submitting) onClose(); }}>
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
          <div className="flex items-center gap-2 flex-shrink-0">
            {savedAs && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: savedAs === "approved" ? "var(--success-bg)" : "var(--danger-bg)", color: savedAs === "approved" ? "var(--success)" : "var(--danger)", border: `1px solid ${savedAs === "approved" ? "var(--success-border)" : "var(--danger-border)"}` }}>
                {savedAs === "approved" ? <><CheckCircle2 size={13} strokeWidth={1.8} /> {pstLabel}</> : <><XCircle size={13} strokeWidth={1.8} /> {T("Rejected", "Abgelehnt", "Refusé")}</>}
              </span>
            )}
            <button onClick={onClose} aria-label={T("Close", "Schließen", "Fermer")} disabled={submitting} className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40" style={{ color: "var(--w3)" }}>
              <XIcon size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* Fields */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {!isApproved && (
            <p className="text-[11px] mb-3" style={{ color: "var(--warning)" }}>
              {T("Tick every filled field to confirm it matches the passport, then Approve.", "Jedes ausgefüllte Feld bestätigen, dann Genehmigen.", "Cochez chaque champ rempli pour confirmer, puis Approuver.")}
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
        </div>

        {/* Footer */}
        {!isApproved && !savedAs && (
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
        )}
      </div>

      {rejectOpen && (
        <AdminRejectModal
          target={{ label: T("Passport data", "Reisepassdaten", "Données du passeport"), initialFeedback: profile.passport_feedback ?? "" }}
          onCancel={() => setRejectOpen(false)}
          onSubmit={(text: string) => review("rejected", text)}
        />
      )}
    </div>,
    document.body,
  );
}
