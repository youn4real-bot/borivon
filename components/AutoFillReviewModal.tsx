"use client";

/**
 * Auto-fill review modal — appears when admin uploads a PDF that already has
 * native AcroForm fields. The PDF is rendered live with pdfjs; every detected
 * field is overlaid with a clickable hotspot showing its current value (or a
 * pulse if unmapped). Click any hotspot → inline popover with a candidate-
 * field dropdown + a literal text input. The PDF preview re-fills live as
 * mappings change.
 *
 * Three layers of intelligence:
 *   1. Name heuristic (`suggestBinding`) — auto-maps unambiguous fields.
 *   2. Template memory — per-PDF-signature mappings persisted in
 *      `pdf_field_mappings`. Map a form once → every future upload pre-fills.
 *   3. Manual override — click any field directly in the preview.
 *
 * Geometry follows LAW #36 (z-1100, blur 8, radius 20).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FocusTrap from "focus-trap-react";
import { FIELD_CATALOG, fieldLabel, resolveFieldValue } from "@/lib/candidateFields";
import type { CandidateFieldId } from "@/lib/candidateFields";
import { AGENCY_FIELD_CATALOG, agencyFieldLabel, resolveAgencyField, type AgencyProfile } from "@/lib/agencyFields";
import type { BindingId, DetectedField, FieldMapping } from "@/lib/pdfAcroFormFill";
import { fillAcroFormFields } from "@/lib/pdfAcroFormFill";

function isAgencyId(id: BindingId): boolean {
  return id.startsWith("agency_");
}

function resolveBinding(
  id: BindingId,
  profile: Partial<CandidateProfile> | null | undefined,
  cv: { phone?: string | null; email?: string | null } | null | undefined,
  agency: AgencyProfile | null,
): string {
  if (isAgencyId(id)) {
    return resolveAgencyField(id as Parameters<typeof resolveAgencyField>[0], agency);
  }
  return resolveFieldValue(id as CandidateFieldId, profile, cv);
}

function bindingLabel(id: BindingId, lang: "fr" | "en" | "de"): string {
  if (isAgencyId(id)) return agencyFieldLabel(id as Parameters<typeof agencyFieldLabel>[0], lang);
  return fieldLabel(id as CandidateFieldId, lang);
}
import type { CandidateProfile } from "@/types";
import { Spinner } from "@/components/ui/states";
import { PdfViewer } from "@/components/PdfViewer";
import { AgencyProfileModal } from "@/components/AgencyProfileModal";

type Props = {
  slotId: string;
  pdfBytes: ArrayBuffer;
  detected: DetectedField[];
  profile: Partial<CandidateProfile> | null;
  cv: { phone?: string | null; email?: string | null } | null;
  lang: "fr" | "en" | "de";
  accessToken: string;
  onSubmit: (filledPdfBytes: Uint8Array, opts: { letCandidateComplete: boolean }) => Promise<void>;
  onClose: () => void;
};

async function computeSignature(detected: DetectedField[]): Promise<string> {
  const sorted = Array.from(new Set(detected.map(d => d.name))).sort();
  const buf = new TextEncoder().encode(sorted.join("|"));
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .slice(0, 16)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export function AutoFillReviewModal({
  slotId, pdfBytes, detected, profile, cv, lang, accessToken, onSubmit, onClose,
}: Props) {
  void slotId;

  const [mappings, setMappings] = useState<FieldMapping[]>(() =>
    detected.map(d => ({ name: d.name, binding: d.suggested, literal: "" })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [memoryHit, setMemoryHit] = useState(false);
  const [agency, setAgency] = useState<AgencyProfile | null>(null);
  const [agencyEditOpen, setAgencyEditOpen] = useState(false);
  const [letCandidateComplete, setLetCandidateComplete] = useState(false);

  // Load agency profile (one row per admin user). Used by the resolver to
  // fill section C of forms (Firma, Strasse, etc.).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portal/admin/agency-profile", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return;
        const { profile: ap } = await res.json() as { profile: AgencyProfile | null };
        if (!cancelled) setAgency(ap);
      } catch (e) {
        console.warn("[AutoFillReviewModal] agency profile fetch failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  // Build a one-shot blob URL for the ORIGINAL PDF — pdfjs renders it once,
  // never re-fills. The overlay hotspots display the live resolved values
  // on top of the blank form. Final fill happens at submit only.
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  useEffect(() => {
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    setPdfSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfBytes]);

  // Template memory: fetch saved mappings for this PDF signature.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sig = await computeSignature(detected);
        if (cancelled) return;
        setSignature(sig);
        const res = await fetch(`/api/portal/admin/pdf-mappings?signature=${sig}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return;
        const { mappings: saved } = await res.json() as { mappings: FieldMapping[] | null };
        if (cancelled || !Array.isArray(saved)) return;
        setMemoryHit(true);
        const byName = new Map(saved.map(m => [m.name, m]));
        setMappings(prev => prev.map(m => {
          const hit = byName.get(m.name);
          return hit ? { name: m.name, binding: hit.binding ?? null, literal: hit.literal ?? "" } : m;
        }));
      } catch (e) {
        console.warn("[AutoFillReviewModal] memory fetch failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [detected, accessToken]);

  const resolved = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of mappings) {
      if (m.literal) map[m.name] = m.literal;
      else if (m.binding) map[m.name] = resolveBinding(m.binding, profile, cv, agency);
      else map[m.name] = "";
    }
    return map;
  }, [mappings, profile, cv, agency]);

  const matchedCount = useMemo(
    () => mappings.filter(m => resolved[m.name]).length,
    [mappings, resolved],
  );

  const candidateName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");

  function updateMapping(idx: number, patch: Partial<FieldMapping>) {
    setMappings(prev => prev.map((m, i) => i === idx ? { ...m, ...patch } : m));
  }
  function removeMapping(idx: number) {
    updateMapping(idx, { binding: null, literal: "" });
  }

  async function persistMemory() {
    if (!signature) return;
    const persisted = mappings
      .map(m => ({ name: m.name, binding: m.binding, literal: m.literal ?? "" }))
      .filter(m => m.binding || m.literal);
    try {
      await fetch("/api/portal/admin/pdf-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ signature, mappings: persisted, fieldCount: mappings.length }),
      });
    } catch (e) {
      console.warn("[AutoFillReviewModal] memory save failed:", e);
    }
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const filledBytes = await fillAcroFormFields(
        pdfBytes,
        mappings,
        (id: BindingId) => resolveBinding(id, profile, cv, agency),
      );
      void persistMemory();
      await onSubmit(filledBytes, { letCandidateComplete });
    } catch (err) {
      console.error("[AutoFillReviewModal] submit failed:", err);
      alert(lang === "de" ? "Fehler beim Ausfüllen des PDF."
        : lang === "fr" ? "Échec du remplissage du PDF."
        : "Failed to fill the PDF.");
    } finally {
      setSubmitting(false);
    }
  }

  const t = TR[lang] ?? TR.de;

  // Bucket fields by page for the overlay renderer.
  const fieldsByPage = useMemo(() => {
    const m = new Map<number, number[]>();
    detected.forEach((d, i) => {
      if (!d.rect || !d.pageSize) return;
      const arr = m.get(d.page) ?? [];
      arr.push(i);
      m.set(d.page, arr);
    });
    return m;
  }, [detected]);

  return createPortal(
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: true, onDeactivate: onClose }}>
      <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-stretch sm:items-center justify-center p-2 sm:p-4 pb-[88px] sm:pb-4"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
        onClick={() => { setEditingIdx(null); onClose(); }}>
        <div className="w-full max-w-5xl flex flex-col overflow-hidden"
          style={{
            background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20,
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)", height: "100%", maxHeight: "100%",
          }}
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "var(--w)" }}>
                {matchedCount === 0 ? t.headlineNone : t.headline(matchedCount, detected.length)}
              </p>
              <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>
                {candidateName && (<>{t.fromCandidate} <span style={{ color: "var(--gold)" }}>{candidateName}</span></>)}
                {memoryHit && <span style={{ marginLeft: candidateName ? 8 : 0, opacity: 0.7 }}>· {t.memory}</span>}
                <span style={{ marginLeft: 8, opacity: 0.7 }}>· {t.clickHint}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={handleSubmit} disabled={submitting}
                className="px-4 py-1.5 rounded-full text-[12px] font-semibold transition-all disabled:opacity-50"
                style={{ background: "var(--gold)", color: "#131312", border: "none" }}>
                {submitting ? <Spinner size="xs" /> : t.submit(matchedCount)}
              </button>
              <button onClick={onClose} disabled={submitting} aria-label="Close"
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:opacity-80"
                style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                ✕
              </button>
            </div>
          </div>

          {/* PDF + overlay */}
          <div className="flex-1 min-h-0 relative" style={{ background: "var(--bg2)" }}>
            {!pdfSrc ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner size="sm" />
              </div>
            ) : (
              <PdfViewer
                src={pdfSrc}
                hideRotate
                pageOverlay={({ pageNum, dispW, dispH }) => {
                  const indices = fieldsByPage.get(pageNum) ?? [];
                  if (indices.length === 0) return null;
                  return (
                    <>
                      {indices.map(idx => {
                        const d = detected[idx];
                        if (!d.rect || !d.pageSize) return null;
                        const m = mappings[idx];
                        const value = resolved[d.name] ?? "";
                        const sx = dispW / d.pageSize.w;
                        const sy = dispH / d.pageSize.h;
                        const cssLeft   = d.rect.x * sx;
                        const cssTop    = (d.pageSize.h - d.rect.y - d.rect.h) * sy;
                        const cssWidth  = d.rect.w * sx;
                        const cssHeight = d.rect.h * sy;
                        const isFilled = !!value;
                        const isEditing = editingIdx === idx;
                        return (
                          <FieldHotspot
                            key={d.name}
                            left={cssLeft}
                            top={cssTop}
                            width={cssWidth}
                            height={cssHeight}
                            value={value}
                            filled={isFilled}
                            isEditing={isEditing}
                            disabled={d.kind !== "text"}
                            mapping={m}
                            lang={lang}
                            tr={t}
                            onClick={() => setEditingIdx(isEditing ? null : idx)}
                            onPickBinding={binding => {
                              updateMapping(idx, { binding, literal: "" });
                              setEditingIdx(null);
                            }}
                            onPickLiteral={literal => {
                              updateMapping(idx, { literal, binding: literal ? null : m.binding });
                            }}
                            onClear={() => {
                              removeMapping(idx);
                              setEditingIdx(null);
                            }}
                            profile={profile}
                            cv={cv}
                            agency={agency}
                          />
                        );
                      })}
                    </>
                  );
                }}
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 px-5 py-2 border-t flex items-center justify-between gap-3" style={{ borderColor: "var(--border)" }}>
            <button onClick={() => setAgencyEditOpen(true)}
              className="text-[10px] transition-opacity hover:opacity-80 flex-shrink-0"
              style={{ background: "transparent", color: "var(--gold)", border: "none", cursor: "pointer" }}>
              {agency ? t.agencyEdit : t.agencySetup} →
            </button>
            <label className="text-[10px] flex items-center gap-1.5 cursor-pointer flex-shrink-0" style={{ color: "var(--w2)" }}>
              <input type="checkbox" checked={letCandidateComplete}
                onChange={e => setLetCandidateComplete(e.target.checked)}
                className="accent-[var(--gold)]" />
              {t.letCandidateComplete}
            </label>
            <p className="text-[10px] text-right flex-1 min-w-0 truncate" style={{ color: "var(--w3)" }}>{t.hint}</p>
          </div>

          {agencyEditOpen && (
            <AgencyProfileModal
              accessToken={accessToken}
              lang={lang}
              onClose={() => setAgencyEditOpen(false)}
              onSaved={ap => setAgency(ap)}
            />
          )}
        </div>
      </div>
    </FocusTrap>,
    document.body,
  );
}

// ── Field hotspot with inline edit popover ───────────────────────────────────

type ModalT = {
  headline: (m: number, total: number) => string;
  headlineNone: string;
  fromCandidate: string;
  memory: string;
  clickHint: string;
  submit: (n: number) => string;
  leaveBlank: string;
  literalPlaceholder: string;
  clear: string;
  popoverTitle: string;
  hint: string;
  candidateGroup: string;
  agencyGroup: string;
  agencySetup: string;
  agencyEdit: string;
  letCandidateComplete: string;
};

function FieldHotspot({
  left, top, width, height, value, filled, isEditing, disabled, mapping,
  lang, tr, onClick, onPickBinding, onPickLiteral, onClear, profile, cv, agency,
}: {
  left: number; top: number; width: number; height: number;
  value: string;
  filled: boolean;
  isEditing: boolean;
  disabled: boolean;
  mapping: FieldMapping;
  lang: "fr" | "en" | "de";
  tr: ModalT;
  onClick: () => void;
  onPickBinding: (b: BindingId | null) => void;
  onPickLiteral: (literal: string) => void;
  onClear: () => void;
  profile: Partial<CandidateProfile> | null;
  cv: { phone?: string | null; email?: string | null } | null;
  agency: AgencyProfile | null;
}) {
  // Anchor the popover above when there's room, otherwise below.
  const openUpward = top > 200;
  return (
    <div style={{
      position: "absolute",
      left, top, width, height,
      pointerEvents: "auto",
    }}>
      {/* Hotspot rectangle. Gold tint when filled. Subtle hover. */}
      <button
        onClick={e => { e.stopPropagation(); if (!disabled) onClick(); }}
        disabled={disabled}
        className="w-full h-full rounded-[3px] transition-colors"
        style={{
          background: filled
            ? "rgba(201, 162, 64, 0.18)"
            : "rgba(201, 162, 64, 0.06)",
          border: `1.5px solid ${filled ? "rgba(201,162,64,0.7)" : "rgba(201,162,64,0.3)"}`,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "flex-start",
          paddingInline: 4,
          overflow: "hidden",
        }}>
        <span style={{
          fontSize: Math.min(12, Math.max(9, height * 0.6)),
          color: filled ? "#131312" : "transparent",
          fontWeight: 500,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
          maxWidth: "100%",
          textAlign: "left",
        }}>{value}</span>
      </button>

      {/* Inline popover */}
      {isEditing && !disabled && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "absolute",
            left: 0,
            [openUpward ? "bottom" : "top"]: "calc(100% + 6px)",
            zIndex: 50,
            minWidth: 260,
            maxWidth: 320,
            background: "var(--card)",
            border: "1px solid var(--border-gold)",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            padding: 10,
          }}>
          <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--w3)", letterSpacing: "0.08em" }}>
            {tr.popoverTitle}
          </p>
          <select
            value={mapping.binding ?? ""}
            onChange={e => onPickBinding((e.target.value || null) as BindingId | null)}
            className="w-full text-[11px] px-2 py-1.5 rounded-md mb-2"
            style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
            <option value="">{tr.leaveBlank}</option>
            <optgroup label={tr.candidateGroup}>
              {FIELD_CATALOG.map(f => {
                const preview = resolveFieldValue(f.id, profile, cv);
                return (
                  <option key={f.id} value={f.id}>
                    {fieldLabel(f.id, lang)}{preview ? ` — ${preview}` : ""}
                  </option>
                );
              })}
            </optgroup>
            <optgroup label={tr.agencyGroup}>
              {AGENCY_FIELD_CATALOG.map(f => {
                const preview = resolveAgencyField(f.id, agency);
                return (
                  <option key={f.id} value={f.id}>
                    {agencyFieldLabel(f.id, lang)}{preview ? ` — ${preview}` : ""}
                  </option>
                );
              })}
            </optgroup>
          </select>
          <input
            type="text"
            value={mapping.literal ?? ""}
            placeholder={tr.literalPlaceholder}
            onChange={e => onPickLiteral(e.target.value)}
            className="w-full text-[11px] px-2 py-1.5 rounded-md mb-2"
            style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}
          />
          <div className="flex gap-2 items-center">
            <button onClick={onClear}
              className="text-[10px] px-2 py-1 rounded-md transition-opacity hover:opacity-80"
              style={{ background: "transparent", color: "var(--w3)", border: "1px solid var(--border)" }}>
              {tr.clear}
            </button>
            <p className="text-[10px] flex-1 truncate" style={{ color: "var(--w3)" }} title={mapping.name}>
              {mapping.name}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const TR: Record<"de" | "en" | "fr", ModalT> = {
  de: {
    headline: (m: number, total: number) => `${m} von ${total} Feldern werden ausgefüllt`,
    headlineNone: "Keine passenden Daten gefunden",
    fromCandidate: "aus dem Profil von",
    memory: "Vorlage erkannt",
    clickHint: "Klick auf ein Feld zum Bearbeiten",
    submit: (n: number) => n > 0 ? `${n} Felder ausfüllen` : "Leer speichern",
    leaveBlank: "— Aus dem Profil wählen —",
    literalPlaceholder: "Oder eigenen Text eingeben…",
    clear: "Leeren",
    popoverTitle: "Feld zuordnen",
    hint: "Der Arbeitgeber druckt das PDF und unterschreibt von Hand. Felder ohne Zuordnung bleiben leer.",
    candidateGroup: "Kandidat",
    agencyGroup: "Arbeitgeber / Agentur",
    agencySetup: "Arbeitgeber-Profil einrichten",
    agencyEdit: "Arbeitgeber-Profil bearbeiten",
    letCandidateComplete: "Kandidat darf restliche Felder ausfüllen",
  },
  en: {
    headline: (m: number, total: number) => `${m} of ${total} fields will be filled`,
    headlineNone: "No matching data found",
    fromCandidate: "from the profile of",
    memory: "template recognised",
    clickHint: "Click a field to edit",
    submit: (n: number) => n > 0 ? `Fill ${n} fields` : "Save empty",
    leaveBlank: "— Pick from profile —",
    literalPlaceholder: "Or type custom text…",
    clear: "Clear",
    popoverTitle: "Map field",
    hint: "Employer prints the PDF and signs by hand. Unmapped fields stay blank.",
    candidateGroup: "Candidate",
    agencyGroup: "Employer / Agency",
    agencySetup: "Set up employer profile",
    agencyEdit: "Edit employer profile",
    letCandidateComplete: "Let candidate fill the rest",
  },
  fr: {
    headline: (m: number, total: number) => `${m} sur ${total} champs seront remplis`,
    headlineNone: "Aucune donnée correspondante",
    fromCandidate: "depuis le profil de",
    memory: "modèle reconnu",
    clickHint: "Cliquez sur un champ pour le modifier",
    submit: (n: number) => n > 0 ? `Remplir ${n} champs` : "Enregistrer vide",
    leaveBlank: "— Choisir depuis le profil —",
    literalPlaceholder: "Ou tapez un texte personnalisé…",
    clear: "Effacer",
    popoverTitle: "Mapper le champ",
    hint: "L'employeur imprime le PDF et signe à la main. Les champs non mappés restent vides.",
    candidateGroup: "Candidat",
    agencyGroup: "Employeur / Agence",
    agencySetup: "Configurer le profil employeur",
    agencyEdit: "Modifier le profil employeur",
    letCandidateComplete: "Laisser le candidat finir",
  },
};
