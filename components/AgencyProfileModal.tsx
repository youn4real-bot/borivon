"use client";

/**
 * Edit the admin's agency / employer profile. One row per admin user,
 * holds the section-C block (Firma, Strasse, Hausnummer, PLZ, Ort,
 * Kontaktperson, Telefon, E-Mail, Telefax, Betriebsnummer) that the
 * AutoFillReviewModal pulls from. Enter once → reused for every candidate.
 *
 * Geometry follows LAW #36 (z-1105 — above AutoFillReviewModal which is
 * z-1100, blur 8, radius 20).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import FocusTrap from "focus-trap-react";
import type { AgencyProfile } from "@/lib/agencyFields";
import { Spinner } from "@/components/ui/states";

type Props = {
  accessToken: string;
  lang: "fr" | "en" | "de";
  onClose: () => void;
  onSaved?: (profile: AgencyProfile) => void;
};

const FIELDS: { key: keyof AgencyProfile; de: string; en: string; fr: string }[] = [
  { key: "firma",          de: "Firma",         en: "Company",         fr: "Société" },
  { key: "strasse",        de: "Straße",        en: "Street",          fr: "Rue" },
  { key: "hausnummer",     de: "Hausnummer",    en: "House no.",       fr: "N°" },
  { key: "plz",            de: "PLZ",           en: "Postal code",     fr: "Code postal" },
  { key: "ort",            de: "Ort",           en: "City",            fr: "Ville" },
  { key: "kontaktperson",  de: "Kontaktperson", en: "Contact person",  fr: "Personne de contact" },
  { key: "telefon",        de: "Telefon",       en: "Phone",           fr: "Téléphone" },
  { key: "email",          de: "E-Mail",        en: "Email",           fr: "Email" },
  { key: "telefax",        de: "Telefax",       en: "Fax",             fr: "Fax" },
  { key: "betriebsnummer", de: "Betriebsnummer",en: "Establishment #", fr: "N° d'établissement" },
];

export function AgencyProfileModal({ accessToken, lang, onClose, onSaved }: Props) {
  const [profile, setProfile] = useState<AgencyProfile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portal/admin/agency-profile", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return;
        const { profile: ap } = await res.json() as { profile: AgencyProfile | null };
        if (!cancelled && ap) setProfile(ap);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/portal/admin/agency-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(profile),
      });
      if (!res.ok) {
        alert(lang === "de" ? "Speichern fehlgeschlagen." : lang === "fr" ? "Échec de la sauvegarde." : "Save failed.");
        return;
      }
      onSaved?.(profile);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: true, onDeactivate: onClose }}>
      <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1105] flex items-stretch sm:items-center justify-center p-2 sm:p-4 pb-[88px] sm:pb-4"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
        onClick={onClose}>
        <div className="w-full max-w-md flex flex-col overflow-hidden"
          style={{
            background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20,
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)", maxHeight: "100%",
          }}
          onClick={e => e.stopPropagation()}>

          <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "var(--w)" }}>
                {lang === "de" ? "Arbeitgeber-Profil" : lang === "fr" ? "Profil employeur" : "Employer profile"}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>
                {lang === "de" ? "Einmal eingeben — für jedes Formular wiederverwendet."
                  : lang === "fr" ? "Saisi une fois — réutilisé pour chaque formulaire."
                  : "Enter once — reused for every form."}
              </p>
            </div>
            <button onClick={onClose} disabled={saving} aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:opacity-80"
              style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-10"><Spinner size="sm" /></div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {FIELDS.map(f => (
                  <label key={f.key} className="flex flex-col gap-1">
                    <span className="text-[11px]" style={{ color: "var(--w3)" }}>
                      {lang === "de" ? f.de : lang === "fr" ? f.fr : f.en}
                    </span>
                    <input type="text" value={profile[f.key] ?? ""}
                      onChange={e => setProfile(p => ({ ...p, [f.key]: e.target.value }))}
                      className="text-[12px] px-3 py-2 rounded-lg"
                      style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex-shrink-0 px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
            <button onClick={onClose} disabled={saving}
              className="px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-opacity hover:opacity-80"
              style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
              {lang === "de" ? "Abbrechen" : lang === "fr" ? "Annuler" : "Cancel"}
            </button>
            <button onClick={handleSave} disabled={saving || loading}
              className="px-4 py-1.5 rounded-full text-[12px] font-semibold transition-all disabled:opacity-50"
              style={{ background: "var(--gold)", color: "#131312", border: "none" }}>
              {saving ? <Spinner size="xs" /> : (lang === "de" ? "Speichern" : lang === "fr" ? "Enregistrer" : "Save")}
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>,
    document.body,
  );
}
