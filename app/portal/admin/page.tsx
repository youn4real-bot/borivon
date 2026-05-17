"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { translations } from "@/lib/translations";
import { useLang } from "@/components/LangContext";
import { AdminDocPreviewModal } from "@/components/AdminDocPreviewModal";
import { isIOSDevice } from "@/lib/platform";
import { triggerIosDownload } from "@/lib/iosDownload";
import { PdfViewer } from "@/components/PdfViewer";
import { IosPdfFrame } from "@/components/IosPdfFrame";
import { AdminRejectModal } from "@/components/AdminRejectModal";
import { natToLang, COUNTRY_MAP as NAT_MAP } from "@/lib/countries";
import {
  PhaseIcon, type PhaseKind,
  Lock, Unlock, IdCard, FileText, Folder, FilePen, Save, Eye,
  CheckCircle2, XCircle, AlertTriangle, PartyPopper,
} from "@/components/PortalIcons";
import { X as XIcon, RotateCcw, Download, Upload, ArrowLeft, MoreHorizontal, ChevronDown, Search, Trash2, Building2, Plus, Send, User, Save as SaveIcon, Zap } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Spinner, PageLoader, EmptyState } from "@/components/ui/states";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { CandidateStagePreview, type JourneyMode } from "@/components/JourneyView";
import { PdfZonePicker, type SigZone } from "@/components/PdfZonePicker";
import { detectAcroFormFields, type DetectedField } from "@/lib/pdfAcroFormFill";
import { AutoFillReviewModal } from "@/components/AutoFillReviewModal";
import { SignaturePad } from "@/components/SignaturePad";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { PortalTopNav } from "@/components/PortalTopNav";
import { FILE_KEY_ALL_LABELS } from "@/lib/fileKeys";
import { removeImageBg } from "@/lib/removeImageBg";
import { stampSigOnPdf } from "@/lib/stampSigOnPdf";

const ADMIN_PHASES: { title: string; shortTitle: string; kind: PhaseKind; keys: string[] }[] = [
  { title: "ID & CV",     shortTitle: "ID",      kind: "id",          keys: ["id", "cv_de", "letter", "langcert", "other"] },
  { title: "Nursing",     shortTitle: "Nursing", kind: "nursing",     keys: [
    "diploma", "studyprog", "transcript", "abitur", "abitur_transcript", "praktikum", "workcert", "work_experience", "impfung",
    "diploma_de", "studyprog_de", "transcript_de", "abitur_de", "abitur_transcript_de", "praktikum_de", "workcert_de", "work_experience_de", "impfung_de",
  ]},
];

function getPhaseIdx(fileType: string): number {
  for (let i = 0; i < ADMIN_PHASES.length; i++) {
    for (const key of ADMIN_PHASES[i].keys) {
      if (FILE_KEY_ALL_LABELS[key]?.has(fileType)) return i;
    }
  }
  return ADMIN_PHASES.length - 1;
}

type OrgBasic = { id: string; name: string };

type Doc = {
  id: string;
  user_id: string;
  file_name: string;
  file_type: string;
  uploaded_at: string;
  status: string;
  feedback: string | null;
  drive_file_id: string | null;
  uploaded_by_admin: boolean;
};
type UserInfo = { email: string; name: string };
type CandidateProfile = {
  first_name: string | null; last_name: string | null;
  dob: string | null; sex: string | null; nationality: string | null;
  passport_no: string | null; passport_expiry: string | null;
  city_of_birth: string | null; country_of_birth: string | null;
  issuing_authority: string | null; issue_date: string | null;
  address_street: string | null; address_number: string | null;
  address_postal: string | null; city_of_residence: string | null;
  country_of_residence: string | null;
  passport_status: string | null;
  passport_feedback: string | null;
  marital_status: string | null;
  children_ages: string | null;
  manually_verified: boolean | null;
  profile_photo: string | null;
  payment_tier: string | null;
  placement_ready: boolean | null;
};

type AdminPipeline = {
  interview_link: string;
  interview_date: string;
  interview_status: string;
  recognition_unlocked: boolean;
  embassy_unlocked: boolean;
  visa_granted: boolean;
  visa_date: string;
  flight_date: string;
  flight_info: string;
  docs_approved: boolean;
  integration_unlocked: boolean;
  start_unlocked: boolean;
  interview_type: string;
  interview_notes: string;
};
const DEFAULT_PIPELINE: AdminPipeline = {
  interview_link: "", interview_date: "", interview_status: "pending",
  recognition_unlocked: false, embassy_unlocked: false,
  visa_granted: false, visa_date: "", flight_date: "", flight_info: "",
  docs_approved: false, integration_unlocked: false, start_unlocked: false,
  interview_type: "", interview_notes: "",
};

// Editable passport fields for the admin edit form
const PASSPORT_FIELDS: { key: keyof CandidateProfile; label: string; type?: "date" | "select"; full?: boolean }[] = [
  { key: "first_name",           label: "First name" },
  { key: "last_name",            label: "Last name" },
  { key: "dob",                  label: "Date of birth",     type: "date" },
  { key: "sex",                  label: "Sex",               type: "select" },
  { key: "nationality",          label: "Nationality" },
  { key: "city_of_birth",        label: "City of birth" },
  { key: "country_of_birth",     label: "Country of birth" },
  { key: "passport_no",          label: "Passport No" },
  { key: "issue_date",           label: "Issue date",        type: "date" },
  { key: "passport_expiry",      label: "Expiry",            type: "date" },
  { key: "issuing_authority",    label: "Issuing authority", full: true },
  { key: "address_street",       label: "Street" },
  { key: "address_number",       label: "Number" },
  { key: "address_postal",       label: "Postal code" },
  { key: "city_of_residence",    label: "City of residence" },
  { key: "country_of_residence", label: "Country of residence" },
];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}.${d.getUTCFullYear()}`;
}

function natToLangAdmin(v: string | null, lang: "fr"|"en"|"de"): string {
  if (!v || v === "—") return "—";
  return natToLang(v, lang) || "—";
}
function computeFamilienstandAdmin(marital_status: string | null, children_ages: string | null): string {
  if (!marital_status) return "—";
  if (marital_status === "ledig") return marital_status;
  let ages: number[] = [];
  try { ages = JSON.parse(children_ages || "[]"); } catch { ages = []; }
  if (!Array.isArray(ages) || ages.length === 0) return marital_status;
  const sorted = [...ages].filter(a => typeof a === "number" && a >= 0).sort((a, b) => b - a);
  if (sorted.length === 0) return marital_status;
  const kindStr = sorted.length === 1 ? "1 Kind" : `${sorted.length} Kinder`;
  return `${marital_status}, ${kindStr} (${sorted.join(", ")})`;
}

function timeAgo(iso: string, lang?: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = diff / 3_600_000;
  const d = diff / 86_400_000;
  const justNow = lang === "fr" ? "À l'instant" : lang === "de" ? "Gerade eben" : "Just now";
  const hAgo = (n: number) => lang === "fr" ? `il y a ${n}h` : lang === "de" ? `vor ${n}h` : `${n}h ago`;
  const dAgo = (n: number) => lang === "fr" ? `il y a ${n}j` : lang === "de" ? `vor ${n}d` : `${n}d ago`;
  if (h < 48) return { isNew: true,  label: h < 1 ? justNow : hAgo(Math.floor(h)) };
  if (d < 7)  return { isNew: false, label: dAgo(Math.floor(d)) };
  return           { isNew: false, label: fmtDate(iso) };
}

// Name a merged (original+translated) PDF EXACTLY like the source docs but
// without the trailing language/type word (…_original / …_uebersetzt).
// Falls back to the slot label when the source filename is unavailable.
function mergedPdfName(srcFileName: string | null | undefined, label: string): string {
  const SUFFIX_RE = /_(original|originale|originel|uebersetzt|uebersetzung|ubersetzt|translated|translation|traduit|traduction)$/i;
  if (srcFileName) {
    const base = srcFileName.replace(/\.[^.]+$/, "").replace(SUFFIX_RE, "");
    if (base) return `${base}.pdf`;
  }
  return `${label.replace(/\s+/g, "_")}.pdf`;
}

// ── Preview modal moved to components/AdminDocPreviewModal.tsx ────────────────

const SIG_PARTY_META = {
  admin: { accent: "#5b9bd5", bg: "rgba(91,155,213,0.08)", border: "rgba(91,155,213,0.3)", storageKey: "borivon_admin_sig" },
};

function AdminSigSection({ lang, sig, wantSave, bgRemoving, onSig, onWantSave, onUpload, onDropFile }: {
  lang: string;
  party?: "admin";
  sig: string | null;
  wantSave: boolean;
  bgRemoving: boolean;
  onSig: (s: string | null) => void;
  onWantSave: (v: boolean) => void;
  onUpload: () => void;
  onDropFile: (file: File) => void;
}) {
  const lbl = (en: string, fr: string, de: string) => lang === "fr" ? fr : lang === "de" ? de : en;
  const meta = SIG_PARTY_META.admin;
  const title = lbl("Your signature (Admin)", "Votre signature (Admin)", "Ihre Unterschrift (Admin)");
  const [dragOver, setDragOver] = useState(false);

  // Crop state
  const [cropMode, setCropMode]         = useState(false);
  const [cropDrag, setCropDrag]         = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null);
  const [cropDragging, setCropDragging] = useState(false);
  const cropImgRef       = useRef<HTMLImageElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);

  // Saved sig — reactive so "Use Saved" always reflects the latest saved value
  const [savedSig, setSavedSig] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(meta.storageKey) : null
  );
  // Auto-sync: when sig changes and wantSave is on, persist immediately so
  // "Use Saved" on the next sign request loads the freshest sig (not a stale one).
  useEffect(() => {
    if (wantSave && sig) {
      localStorage.setItem(meta.storageKey, sig);
      setSavedSig(sig);
    }
  }, [sig, wantSave]);

  function applyCrop() {
    if (!cropDrag || !cropImgRef.current || !cropContainerRef.current || !sig) return;
    const cw = cropContainerRef.current.offsetWidth;
    const ch = cropContainerRef.current.offsetHeight;
    const img = cropImgRef.current;
    const scaleX = img.naturalWidth / cw;
    const scaleY = img.naturalHeight / ch;
    const x = Math.max(0, Math.round(Math.min(cropDrag.sx, cropDrag.ex) * scaleX));
    const y = Math.max(0, Math.round(Math.min(cropDrag.sy, cropDrag.ey) * scaleY));
    const w = Math.min(img.naturalWidth - x, Math.round(Math.abs(cropDrag.ex - cropDrag.sx) * scaleX));
    const h = Math.min(img.naturalHeight - y, Math.round(Math.abs(cropDrag.ey - cropDrag.sy) * scaleY));
    if (w < 5 || h < 5) return;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, w, h);
    onSig(canvas.toDataURL("image/png"));
    setCropMode(false); setCropDrag(null);
  }

  const cropPortal = cropMode && sig ? createPortal(
    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-4"
      style={{ background: "rgba(0,0,0,0.92)" }}
      onClick={e => { if (e.target === e.currentTarget) { setCropMode(false); setCropDrag(null); } }}>
      <p className="text-[12px] font-semibold select-none" style={{ color: "rgba(255,255,255,0.6)" }}>
        {lbl("Drag to select crop area", "Faites glisser pour sélectionner", "Bereich ziehen zum Zuschneiden")}
      </p>
      <div ref={cropContainerRef} className="relative select-none"
        style={{ cursor: "crosshair", background: "#fff" }}
        onMouseDown={e => {
          const r = cropContainerRef.current!.getBoundingClientRect();
          const sx = e.clientX - r.left, sy = e.clientY - r.top;
          setCropDrag({ sx, sy, ex: sx, ey: sy }); setCropDragging(true);
        }}
        onMouseMove={e => {
          if (!cropDragging) return;
          const r = cropContainerRef.current!.getBoundingClientRect();
          setCropDrag(d => d ? { ...d, ex: e.clientX - r.left, ey: e.clientY - r.top } : null);
        }}
        onMouseUp={() => setCropDragging(false)}
        onMouseLeave={() => setCropDragging(false)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={cropImgRef} src={sig} alt="crop" draggable={false}
          style={{ display: "block", maxWidth: "80vw", maxHeight: "65vh", userSelect: "none", pointerEvents: "none" }} />
        {cropDrag && (
          <div style={{
            position: "absolute",
            left: Math.min(cropDrag.sx, cropDrag.ex), top: Math.min(cropDrag.sy, cropDrag.ey),
            width: Math.abs(cropDrag.ex - cropDrag.sx), height: Math.abs(cropDrag.ey - cropDrag.sy),
            border: "2px solid #fff", background: "rgba(255,255,255,0.08)",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)", pointerEvents: "none",
          }} />
        )}
      </div>
      <div className="flex gap-3">
        <button onClick={applyCrop}
          disabled={!cropDrag || Math.abs(cropDrag.ex - cropDrag.sx) < 5 || Math.abs(cropDrag.ey - cropDrag.sy) < 5}
          className="px-6 py-2 rounded-full text-[12.5px] font-semibold disabled:opacity-40 transition-opacity hover:opacity-80"
          style={{ background: meta.accent, color: "#fff" }}>
          {lbl("Apply crop", "Appliquer", "Zuschneiden")}
        </button>
        <button onClick={() => { setCropMode(false); setCropDrag(null); }}
          className="px-6 py-2 rounded-full text-[12.5px] font-semibold transition-opacity hover:opacity-80"
          style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}>
          {lbl("Cancel", "Annuler", "Abbrechen")}
        </button>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
    <div className="rounded-2xl p-4 space-y-3" style={{ background: meta.bg, border: `1.5px solid ${meta.border}` }}>
        <p className="text-[11.5px] font-semibold" style={{ color: meta.accent }}>
          ✍ {title}
        </p>

        {/* Upload dropzone — shown when no sig yet */}
        {!sig && (
          <>
          {savedSig && (
            <button type="button"
              onClick={() => onSig(savedSig)}
              className="w-full py-2 text-[12px] font-semibold rounded-xl transition-opacity hover:opacity-80"
              style={{ background: "rgba(91,155,213,0.14)", color: meta.accent, border: `1.5px solid ${meta.border}` }}>
              ✓ {lbl("Use saved", "Utiliser enregistrée", "Gespeicherte nutzen")}
            </button>
          )}
          <div
            onClick={() => { if (!bgRemoving) onUpload(); }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file && file.type.startsWith("image/")) onDropFile(file);
            }}
            className="rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
            style={{
              minHeight: 110,
              border: `2px dashed ${dragOver ? meta.accent : meta.border}`,
              background: dragOver ? meta.bg : "#fff",
            }}
          >
            {bgRemoving ? (
              <span className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" style={{ color: meta.accent }} />
            ) : (
              <>
                <Upload size={20} strokeWidth={1.5} style={{ color: meta.accent, opacity: 0.7 }} />
                <p className="text-[12px] text-center px-4" style={{ color: "var(--w3)" }}>
                  {lbl("Drop signature photo or click to upload", "Déposez ou cliquez pour importer", "Unterschrift ablegen oder klicken")}
                </p>
              </>
            )}
          </div>
          </>
        )}

        {/* Action buttons when sig exists */}
        {sig && !bgRemoving && (
          <div className="flex items-center gap-2 flex-wrap">
            {savedSig && sig !== savedSig && (
              <button
                type="button"
                onClick={() => onSig(savedSig)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
                style={{ background: meta.bg, color: meta.accent, border: `1px solid ${meta.border}` }}>
                {lbl("Use saved", "Utiliser enregistrée", "Gespeicherte nutzen")}
              </button>
            )}
            <button
              type="button"
              onClick={onUpload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: meta.bg, color: meta.accent, border: `1px solid ${meta.border}` }}>
              <Upload size={11} strokeWidth={2} />
              {lbl("Replace", "Remplacer", "Ersetzen")}
            </button>
            <button
              type="button"
              onClick={() => { setCropMode(true); setCropDrag(null); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: meta.bg, color: meta.accent, border: `1px solid ${meta.border}` }}>
              ✂ {lbl("Crop", "Recadrer", "Zuschneiden")}
            </button>
            <button
              type="button"
              onClick={() => onSig(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: meta.bg, color: meta.accent, border: `1px solid ${meta.border}` }}>
              ✕ {lbl("Clear", "Effacer", "Löschen")}
            </button>
          </div>
        )}

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={wantSave}
            onChange={e => {
              onWantSave(e.target.checked);
              if (e.target.checked && sig) { localStorage.setItem(meta.storageKey, sig); setSavedSig(sig); }
              else if (!e.target.checked) { localStorage.removeItem(meta.storageKey); setSavedSig(null); }
            }}
            className="rounded"
            style={{ accentColor: meta.accent }}
          />
          <span className="text-[11px]" style={{ color: "var(--w3)" }}>
            {lbl("Save for next time", "Enregistrer pour la prochaine fois", "Für nächstes Mal speichern")}
          </span>
        </label>
    </div>
    {cropPortal}
    </>
  );
}

// ── Sortable slot wrapper (dnd-kit) ───────────────────────────────────────────
function SortableSlotItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? "transform 200ms cubic-bezier(0.2,0,0,1)",
        position: "relative",
        zIndex: isDragging ? 999 : undefined,
        opacity: isDragging ? 0.45 : 1,
        boxShadow: isDragging ? "0 20px 48px rgba(0,0,0,0.22), 0 6px 16px rgba(0,0,0,0.12)" : undefined,
        borderRadius: isDragging ? 12 : undefined,
        touchAction: "none",
        cursor: isDragging ? "grabbing" : "grab",
      }}
    >
      {children}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter();
  const { lang } = useLang();
  const t = translations[lang];
  const [accessToken, setAccessToken] = useState("");
  /** Supabase auth user ID of the currently logged-in admin */
  const [currentUserId, setCurrentUserId] = useState("");
  /** true only for the supreme admin (ADMIN_EMAIL) — org/sub-admins cannot grant/revoke the blue tick */
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  /** false while /api/portal/me/role is still resolving on initial load.
   *  LAW #31: lock-toggle buttons must render as clickable while role is unknown
   *  to prevent the race where supreme admin clicks during the resolution window
   *  and hits a non-interactive span. Server is authoritative — it rejects
   *  unauthorized toggles with 403. */
  const [roleResolved, setRoleResolved] = useState(false);
  /** Candidate invite generation state */
  const [inviteGenerating, setInviteGenerating] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  /** Org-admin invite generation state — separate flow, requires picking
   *  the org the new admin will be tied to. */
  const [orgInviteOrgId, setOrgInviteOrgId]       = useState("");
  const [orgInviteGenerating, setOrgInviteGenerating] = useState(false);
  const [orgInviteUrl, setOrgInviteUrl]           = useState<string | null>(null);
  const [orgInviteDropdown, setOrgInviteDropdown] = useState(false);
  const [orgInviteCopied, setOrgInviteCopied]     = useState(false);
  const [subAdminInviteGenerating, setSubAdminInviteGenerating] = useState(false);
  const [subAdminInviteUrl, setSubAdminInviteUrl] = useState<string | null>(null);
  const [subAdminInviteCopied, setSubAdminInviteCopied] = useState(false);
  const [newOrgModal, setNewOrgModal]             = useState(false);
  const [newOrgName, setNewOrgName]               = useState("");
  const [newOrgCreating, setNewOrgCreating]       = useState(false);
  /** All orgs in the system — used for the "Place with org" dropdown */
  const [allOrgs, setAllOrgs] = useState<OrgBasic[]>([]);
  /** Currently selected org in the placement dropdown */
  const [placementOrgId, setPlacementOrgId] = useState("");
  /** In-flight placement request */
  const [placing, setPlacing] = useState(false);

  // ── Org needs panel ─────────────────────────────────────────────────────────
  type OrgNeed = {
    id: string;
    orgId: string;
    orgName: string;
    specialty: string | null;
    slots: number;
    location: string | null;
    startDate: string | null;
    notes: string | null;
    createdAt: string;
  };
  const [orgNeeds, setOrgNeeds]       = useState<OrgNeed[]>([]);
  /** needId → userId being assigned */
  const [needAssign, setNeedAssign]   = useState<Record<string, string>>({});
  const [needPlacing, setNeedPlacing] = useState<Record<string, boolean>>({});

  // ── Agencies (multi-tenancy) ─────────────────────────────────────────────────
  type Agency = { id: string; name: string; created_at: string; adminCount: number; memberCount: number; candidateCount: number };
  type AgencySubAdmin = { id: string; email: string; name: string; label: string; agency_id: string | null; is_agency_admin: boolean };
  const [agencies, setAgencies]               = useState<Agency[]>([]);
  const [agencySubAdmins, setAgencySubAdmins] = useState<AgencySubAdmin[]>([]);
  const [agenciesLoaded, setAgenciesLoaded]   = useState(false);
  const [newAgencyName, setNewAgencyName]     = useState("");
  const [agencyCreating, setAgencyCreating]   = useState(false);

  async function loadAgencies(token: string) {
    const [ra, rs] = await Promise.all([
      fetch("/api/portal/admin/agencies",   { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/portal/admin/sub-admins", { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (ra.ok) { const j = await ra.json(); setAgencies(j.agencies ?? []); }
    if (rs.ok) { const j = await rs.json(); setAgencySubAdmins(j.subAdmins ?? []); }
    setAgenciesLoaded(true);
  }

  async function createAgency() {
    if (!newAgencyName.trim()) return;
    setAgencyCreating(true);
    try {
      const res = await fetch("/api/portal/admin/agencies", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ name: newAgencyName.trim() }),
      });
      if (!res.ok) { showError(t.adErrNetwork); return; }
      setNewAgencyName("");
      await loadAgencies(accessToken);
    } catch {
      showError(t.adErrNetwork);
    } finally { setAgencyCreating(false); }
  }

  async function assignSubAdminAgency(email: string, agencyId: string | null, isAgencyAdmin: boolean) {
    // Snapshot for rollback if the server rejects the change.
    const prev = agencySubAdmins;
    // Optimistic update first so the UI feels instant.
    setAgencySubAdmins(p => p.map(sa =>
      sa.email === email ? { ...sa, agency_id: agencyId, is_agency_admin: isAgencyAdmin } : sa
    ));
    try {
      const res = await fetch("/api/portal/admin/agencies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ email, agencyId, isAgencyAdmin }),
      });
      if (!res.ok) {
        setAgencySubAdmins(prev); // rollback
        showError(t.adErrNetwork);
      }
    } catch {
      setAgencySubAdmins(prev);
      showError(t.adErrNetwork);
    }
  }

  // ── Org Requirements Manager ─────────────────────────────────────────────────
  type OrgReq = { id: string; specialty: string | null; slots: number; location: string | null; start_date: string | null; notes: string | null; active: boolean };
  const [orgReqSelOrg, setOrgReqSelOrg] = useState("");
  const [orgReqs, setOrgReqs]           = useState<OrgReq[]>([]);
  const [orgReqLoading, setOrgReqLoading] = useState(false);
  const [orgReqForm, setOrgReqForm]     = useState({ specialty: "", slots: "1", location: "", start_date: "", notes: "" });
  const [orgReqAdding, setOrgReqAdding] = useState(false);
  const [showOrgReqForm, setShowOrgReqForm] = useState(false);

  async function loadOrgReqs(orgId: string) {
    if (!orgId) { setOrgReqs([]); return; }
    setOrgReqLoading(true);
    try {
      const res = await fetch(`/api/portal/admin/organizations/${orgId}/requirements`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) { showError(t.adErrNetwork); return; }
      const j = await res.json() as { requirements: OrgReq[] };
      setOrgReqs(j.requirements ?? []);
    } catch {
      showError(t.adErrNetwork);
    } finally { setOrgReqLoading(false); }
  }

  async function addOrgReq() {
    if (!orgReqSelOrg) return;
    setOrgReqAdding(true);
    try {
      const res = await fetch(`/api/portal/admin/organizations/${orgReqSelOrg}/requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          specialty:  orgReqForm.specialty.trim()  || undefined,
          slots:      parseInt(orgReqForm.slots)   || 1,
          location:   orgReqForm.location.trim()   || undefined,
          start_date: orgReqForm.start_date        || undefined,
          notes:      orgReqForm.notes.trim()      || undefined,
        }),
      });
      if (!res.ok) { showError(t.adErrNetwork); return; }
      setOrgReqForm({ specialty: "", slots: "1", location: "", start_date: "", notes: "" });
      setShowOrgReqForm(false);
      await loadOrgReqs(orgReqSelOrg);
      fetch("/api/portal/admin/org-needs", { headers: { Authorization: `Bearer ${accessToken}` } })
        .then(r => r.json())
        .then((j: { needs?: OrgNeed[] }) => { if (j?.needs) setOrgNeeds(j.needs); })
        .catch(() => {});
    } finally { setOrgReqAdding(false); }
  }

  async function closeOrgReq(reqId: string) {
    if (!orgReqSelOrg) return;
    const prev = orgReqs;
    // Optimistic UI then verify with server.
    setOrgReqs(p => p.map(r => r.id === reqId ? { ...r, active: false } : r));
    try {
      const res = await fetch(`/api/portal/admin/organizations/${orgReqSelOrg}/requirements`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ requirementId: reqId }),
      });
      if (!res.ok) { setOrgReqs(prev); showError(t.adErrNetwork); }
    } catch {
      setOrgReqs(prev);
      showError(t.adErrNetwork);
    }
  }

  // ── Suggested matches inbox ──────────────────────────────────────────────────
  type SuggestedMatch = {
    id: string;
    candidateUserId: string;
    candidateName: string;
    candidateEmail: string;
    orgId: string;
    orgName: string;
    requirement: { specialty: string | null; slots: number; location: string | null; start_date: string | null } | null;
    suggestedAt: string;
  };
  const [suggestedMatches, setSuggestedMatches] = useState<SuggestedMatch[]>([]);
  const [matchDeciding, setMatchDeciding] = useState<Record<string, boolean>>({});
  const [docs, setDocs]             = useState<Doc[]>([]);
  const [users, setUsers]           = useState<Record<string, UserInfo>>({});
  const [profiles, setProfiles]     = useState<Record<string, CandidateProfile>>({});
  // Approved org links per candidate (filled from /api/portal/admin response).
  // Used to render a small "Calmaroi" tag under each candidate's email.
  const [candidateOrgs, setCandidateOrgs] = useState<Record<string, { id: string; name: string }[]>>({});
  const [loading, setLoading]       = useState(true);
  const [feedbacks, setFeedbacks]     = useState<Record<string, string>>({});
  const [dirtyFeedbacks, setDirtyFeedbacks] = useState<Set<string>>(new Set());
  const [saving, setSaving]           = useState<Record<string, boolean>>({});
  const [previewDoc, setPreviewDoc] = useState<Doc | null>(null);
  // Phone single-scroll: blob URL of the previewed passport so it can be
  // rendered as a strip at the top of the passport-info card (one page:
  // passport on top, data below — scroll freely to compare).
  const [ppStripUrl, setPpStripUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewDoc || !/pass/i.test(previewDoc.file_type) || !previewDoc.drive_file_id) {
      setPpStripUrl(null);
      return;
    }
    let revoked = false;
    let url = "";
    fetch(`/api/portal/file?id=${previewDoc.drive_file_id}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.ok ? r.blob() : null)
      .then(blob => { if (blob && !revoked) { url = URL.createObjectURL(blob); setPpStripUrl(url); } })
      .catch(() => {});
    return () => { revoked = true; if (url) URL.revokeObjectURL(url); setPpStripUrl(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDoc?.id]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [activePhase, setActivePhase]   = useState(0);
  const [expandedPairs, setExpandedPairs] = useState<Set<string>>(new Set());
  const [showArchive, setShowArchive]   = useState(false);
  const [expandedRow, setExpandedRow]   = useState<string | null>(null);
  const [rowDropdownPos, setRowDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const [rowPlacing, setRowPlacing]     = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery]   = useState("");
  const [filterMode, setFilterMode]     = useState<"all" | "pending" | "stuck" | "clear">("all");
  const [pipeline, setPipeline]         = useState<AdminPipeline>(DEFAULT_PIPELINE);
  const [pipelineSaving, setPipelineSaving] = useState(false);
  const [pipelineLoaded, setPipelineLoaded] = useState(false);
  const [pipelineSaved,  setPipelineSaved]  = useState(false);
  const [passportEditMode, setPassportEditMode] = useState(false);
  const [passportEdits, setPassportEdits]       = useState<Partial<CandidateProfile>>({});
  const [passportSaving, setPassportSaving]     = useState(false);
  const [profileSaved, setProfileSaved]         = useState(false);
  const [activePipelineStage, setActivePipelineStage] = useState<string | null>(null);

  // ── Dynamic phase slots (Bearbeitung / Visum) ──────────────────────────────
  type PhaseSlot = { id: string; org_id: string | null; phase: string; position: number; type: "simple" | "dual"; label: string; label_trans: string | null; action_type: string | null; instructions: string | null; template_pdf_path: string | null; form_fields: import("@/lib/pdfFieldEmbed").FormField[] | null; candidate_signature_zone: import("@/components/PdfZonePicker").SigZone | null; admin_signs: boolean; candidate_signs: boolean; admin_fills: boolean; candidate_fills: boolean; pdf_has_native_fields: boolean };
  const [phaseSlots, setPhaseSlots] = useState<Record<string, PhaseSlot[]>>({ bearbeitung: [], visum: [] });
  const [phaseSlotsLoaded, setPhaseSlotsLoaded] = useState<Record<string, boolean>>({ bearbeitung: false, visum: false });
  // Add-slot modal
  const [addSlotPhase, setAddSlotPhase]               = useState<string | null>(null);
  const [addSlotLabel, setAddSlotLabel]               = useState("");
  const [addSlotInstructions, setAddSlotInstructions] = useState("");
  const [addSlotSaving, setAddSlotSaving]             = useState(false);
  // Slot config popup — appears after admin uploads a PDF to a slot (LAW #34)
  type SlotConfigState = { slotId: string; admin_signs: boolean; candidate_signs: boolean; admin_fills: boolean; candidate_fills: boolean; pdf_has_native_fields: boolean };
  const [slotConfigPopup, setSlotConfigPopup]         = useState<SlotConfigState | null>(null);
  const [slotConfigSaving, setSlotConfigSaving]       = useState(false);
  // Admin's reusable signature (uploaded photo of handwriting, bg-removed via Otsu).
  // Loaded once on mount, edited inside the sig upload sub-popup, persisted via
  // /api/portal/admin/me/signature. One signature per admin reused across slots.
  const [adminSavedSig, setAdminSavedSig]             = useState<string | null>(null);
  const [adminSigUploading, setAdminSigUploading]     = useState(false);
  const adminSigUploadRef                              = useRef<HTMLInputElement | null>(null);
  // Signature setup sub-popup — opens when admin checks "Admin signs" for the
  // first time (no saved sig). Photo upload → Otsu → confirm/redo → returns to
  // the main flow which then opens the placement wizard.
  const [adminSigSubPopup, setAdminSigSubPopup]       = useState<{ slotId: string; pendingSig: string | null } | null>(null);
  // Placement wizard — opens after main popup Confirm. Walks admin through
  // drawing zones on the slot's PDF, one step per checked action.
  // Drawing form-field boxes was removed per user directive — creating fields
  // is now done in an external tool (Acrobat, etc.) one time, and the portal
  // only consumes PDFs that already have native AcroForm fields. The wizard
  // therefore handles signature placement only.
  type WizardStep = "admin_sig" | "candidate_sig";
  const [placementWizard, setPlacementWizard] = useState<{
    slotId: string;
    pdfB64: string;
    steps: WizardStep[];
    stepIdx: number;
    adminSigZone: import("@/components/PdfZonePicker").SigZone | null;
    candidateSigZone: import("@/components/PdfZonePicker").SigZone | null;
  } | null>(null);
  const [placementSubmitting, setPlacementSubmitting] = useState(false);
  // Auto-fill review modal: appears when admin uploads a PDF that already has
  // native AcroForm fields (e.g. the BA EzB form). Bypasses the
  // draw-a-box wizard and the slot config popup entirely.
  const [autoFillReview, setAutoFillReview] = useState<{
    slotId: string;
    file: File;
    pdfBytes: ArrayBuffer;
    detected: DetectedField[];
  } | null>(null);
  // Lock body scroll while the placement wizard is open — same idiom as
  // AdminDocPreviewModal. Without this, the underlying page can scroll/zoom
  // when the user pinches the PDF, making the wizard frame appear to drift.
  useEffect(() => {
    if (!placementWizard) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [placementWizard]);
  // Configure fields modal (fill-type slots)
  // Configure-fields modal removed: drawing form fields is no longer supported.
  // Expanded DUAL slot IDs (collapsed by default, like static paired rows)
  const [expandedDualSlots, setExpandedDualSlots] = useState<Set<string>>(new Set());
  // Inline slot label editing
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editingSlotLabel, setEditingSlotLabel] = useState("");
  const [editingSlotLabelTrans, setEditingSlotLabelTrans] = useState("");
  const [editingSlotInstructions, setEditingSlotInstructions] = useState("");
  // Drag-to-reorder (dnd-kit)
  const slotSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  // Admin upload on behalf of candidate
  const [adminUploadSlotId, setAdminUploadSlotId] = useState<string | null>(null);
  // Smooth 0→100 progress for Bearbeitung/Visum slot uploads (same UX as the
  // candidate passport bar): real bytes 0→85, then ease toward 99 while the
  // server does Drive + AcroForm work, snap to 100 on done.
  const [adminSlotProgress, setAdminSlotProgress] = useState(0);
  const adminProgressTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAdminProgressCreep = () => {
    if (adminProgressTimerRef.current) { clearInterval(adminProgressTimerRef.current); adminProgressTimerRef.current = null; }
  };
  const adminFileInputRef = React.useRef<HTMLInputElement>(null);
  const adminUploadTargetRef = React.useRef<string | null>(null);
  // Local cache of the File the admin just uploaded, keyed by slotId. Lets the
  // placement wizard render INSTANTLY without round-tripping to Supabase Storage
  // for the slot-template fetch — we already have the bytes client-side.
  // The background slot-template POST still runs so subsequent sessions / other
  // admins get the file from Storage on demand.
  const localTemplateFileRef = React.useRef<Map<string, File>>(new Map());
  const [showPassportInfo, setShowPassportInfo] = useState(false);
  // Auto-open passport data alongside the doc preview during the verification
  // phase. Once both the doc AND the data are approved, this stops triggering
  // and the data popup is opened only via the explicit "Passport data" button.
  React.useEffect(() => {
    if (!previewDoc) {
      setShowPassportInfo(false);
      return;
    }
    if (!/pass/i.test(previewDoc.file_type)) return;
    const docApproved  = previewDoc.status === "approved";
    const dataApproved = profiles[previewDoc.user_id]?.passport_status === "approved";
    if (!docApproved || !dataApproved) {
      setShowPassportInfo(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDoc?.id]);
  // Modal-specific edit/review states (separate from the profile-card edit mode)
  const [passportInfoEditMode, setPassportInfoEditMode] = useState(false);
  const [passportInfoEdits, setPassportInfoEdits]       = useState<Partial<CandidateProfile>>({});
  const [passportInfoSaving, setPassportInfoSaving]     = useState(false);
  // Admin-side per-field review checklist — same UX as candidate's confirmation
  // boxes (orange ring → green tick). The admin clicks each field to mark it as
  // reviewed; once all populated fields are ticked, an "Approve" hint highlights.
  const [adminConfirmedFields, setAdminConfirmedFields] = useState<Set<string>>(new Set());
  const [docHistory, setDocHistory] = useState<Doc[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // Which doc id has the revoke/reject context menu open (null = none)
  const [revokeMenu, setRevokeMenu] = useState<{ id: string; el: HTMLElement } | null>(null);
  // Passport FILE download state (pipeline view)
  const [passportPdfDl, setPassportPdfDl] = useState(false);
  // Merged-PDF download loading state keyed by paired item key
  const [mergePdfDl, setMergePdfDl] = useState<Set<string>>(new Set());
  // Merged-PDF preview state
  const [mergePreview, setMergePreview] = useState<{ origDocId: string; transDocId: string; label: string } | null>(null);
  // Passport DATA PDF download state (passport info modal)
  const [passportDataPdfDl, setPassportDataPdfDl] = useState(false);
  // Signature request modal
  const [sigModal, setSigModal] = useState<{ docId: string | null; driveFileId: string | null; label: string } | null>(null);
  const [sigNote, setSigNote] = useState("");
  const [sigSending, setSigSending] = useState(false);
  // iOS can't save a POST→blob; after the server stashes the signed PDF the
  // user taps this (fresh gesture) to actually download it.
  const [iosSignedDl, setIosSignedDl] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => { if (!sigModal) setIosSignedDl(null); }, [sigModal]);
  const [sigMode, setSigMode] = useState<"admin-only" | "with-candidate">("admin-only");
  const [sigZones, setSigZones] = useState<SigZone[]>([]);
  const [sigPdfBase64, setSigPdfBase64] = useState<string | null>(null);
  const [sigPdfLoading, setSigPdfLoading] = useState(false);
  const [sigManualPdf, setSigManualPdf] = useState<string | null>(null); // base64 when admin uploads PDF manually
  const [sigAdminSig, setSigAdminSig] = useState<string | null>(null);
  const [sigAdminWantSave, setSigAdminWantSave] = useState(true);
  const [sigAdminBgRemoving, setSigAdminBgRemoving] = useState(false);
  const [sigOrgSig, setSigOrgSig] = useState<string | null>(null);
  const [sigOrgWantSave, setSigOrgWantSave] = useState(true);
  const [sigOrgBgRemoving, setSigOrgBgRemoving] = useState(false);
  const [sigUploadTarget, setSigUploadTarget] = useState<"admin" | "org">("admin");
  const sigManualFileRef   = React.useRef<HTMLInputElement>(null);
  const sigAdminUploadRef  = React.useRef<HTMLInputElement>(null);

  // Fetch PDF for zone picker whenever sign modal opens
  useEffect(() => {
    if (!sigModal) {
      setSigPdfBase64(null); setSigZones([]); setSigManualPdf(null);
      setSigAdminSig(null); setSigAdminWantSave(true);
      setSigOrgSig(null); setSigOrgWantSave(true);
      setSigMode("admin-only");
      return;
    }
    setSigPdfBase64(null);
    setSigZones([]);
    setSigManualPdf(null);
    setSigAdminSig(localStorage.getItem("borivon_admin_sig"));
    setSigOrgSig(localStorage.getItem("borivon_org_sig"));
    setSigAdminWantSave(true);
    setSigOrgWantSave(true);
    // No source doc → skip fetch, go straight to upload drop zone
    if (!sigModal.driveFileId && !sigModal.docId) {
      setSigPdfLoading(false);
      return;
    }
    let cancelled = false;
    setSigPdfLoading(true);
    (async () => {
      try {
        // Match AdminDocPreviewModal exactly: prefer ?id=drive_file_id, fall back to ?docId
        const fetchUrl = sigModal.driveFileId
          ? `/api/portal/file?id=${encodeURIComponent(sigModal.driveFileId)}`
          : `/api/portal/file?docId=${encodeURIComponent(sigModal.docId!)}`;
        const res = await fetch(fetchUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok || cancelled) {
          if (!cancelled) console.warn("[sigModal] file fetch failed:", res.status, sigModal.driveFileId || sigModal.docId);
          return;
        }
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const bytes = new Uint8Array(buf);
        let binary = "";
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const b64 = btoa(binary);
        setSigPdfBase64(b64);
      } catch (e) {
        console.error("[sigModal] fetch exception:", e);
      }
      finally { if (!cancelled) setSigPdfLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [sigModal, accessToken]);

  // Delete candidate confirmation
  const [deleteCandidateConfirm, setDeleteCandidateConfirm] = useState(false);
  const [deleteCandidateInput, setDeleteCandidateInput] = useState("");
  const [deletingCandidate, setDeletingCandidate] = useState(false);
  // Passport Data row feedback
  const [passportDataFeedback, setPassportDataFeedback] = useState("");
  // Transient error toast (auto-dismisses after 4 s)
  const [adminToast, setAdminToast] = useState<{ msg: string; id: number } | null>(null);
  function showError(msg: string) {
    const id = Date.now();
    setAdminToast({ msg, id });
    setTimeout(() => setAdminToast(t => t?.id === id ? null : t), 4000);
  }

  // Keep accessToken fresh — Supabase silently refreshes JWTs every ~55 min.
  // Without this, any admin page open for >1h would get 401 on all API calls.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) setAccessToken(session.access_token);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // ── 1. Auth ─────────────────────────────────────────────────────────
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      if (cancelled) return;

      const token = session.access_token ?? "";
      setAccessToken(token);
      setCurrentUserId(session.user.id);

      // ── 2. Fire ALL critical fetches in parallel; reveal after all settle.
      //      Same FOUC fix as candidate dashboard — page renders ONCE with
      //      every section's data already in state instead of pop-in-by-pop-in.
      //
      //      Auth-failure (admin endpoint 401/403) is the only branch that
      //      short-circuits redirect; everything else logs and continues so
      //      a single slow endpoint can't deadlock the whole reveal.
      let authFailed = false;

      await Promise.allSettled([
        // a) Role check (supreme-admin flag)
        fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(j => { if (!cancelled && j?.isSuperAdmin) setIsSuperAdmin(true); })
          .catch(() => {})
          .finally(() => { if (!cancelled) setRoleResolved(true); }),
        // b) Org list (for org switcher)
        fetch("/api/portal/admin/organizations", { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(j => { if (!cancelled && j?.orgs) setAllOrgs(j.orgs); })
          .catch(() => {}),
        // c) Bearbeitung phase slots
        fetch("/api/portal/phase-slots?phase=bearbeitung", { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(j => {
            if (cancelled) return;
            if (j?.slots) {
              setPhaseSlots(prev => ({ ...prev, bearbeitung: j.slots }));
              setPhaseSlotsLoaded(prev => ({ ...prev, bearbeitung: true }));
            }
          })
          .catch(() => {}),
        // d) Visum phase slots
        fetch("/api/portal/phase-slots?phase=visum", { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(j => {
            if (cancelled) return;
            if (j?.slots) {
              setPhaseSlots(prev => ({ ...prev, visum: j.slots }));
              setPhaseSlotsLoaded(prev => ({ ...prev, visum: true }));
            }
          })
          .catch(() => {}),
        // e) Main admin data (docs, users, profiles, candidateOrgs)
        (async () => {
          try {
            const res = await fetch("/api/portal/admin", { headers: { Authorization: `Bearer ${token}` } });
            if (res.status === 401 || res.status === 403) { authFailed = true; return; }
            const json = await res.json();
            if (cancelled) return;
            setDocs(json.docs ?? []);
            setDocHistory(json.docHistory ?? []);
            setUsers(json.users ?? {});
            setProfiles(json.profiles ?? {});
            setCandidateOrgs(json.candidateOrgs ?? {});
            const fb: Record<string, string> = {};
            for (const d of json.docs ?? []) fb[d.id] = d.feedback ?? "";
            setFeedbacks(fb);

            // Deep-link from notification — same logic as before
            const params    = new URLSearchParams(window.location.search);
            const navEmail  = params.get("nav_email");
            const navDoc    = params.get("nav_doc");
            const navDocId  = params.get("nav_doc_id");
            if (navEmail) {
              const uid = Object.keys(json.users ?? {}).find(
                (id: string) => ((json.users[id]?.email as string) ?? "").toLowerCase() === navEmail.toLowerCase()
              );
              if (uid) {
                setSelectedUser(uid);
                window.scrollTo({ top: 0, behavior: "smooth" });
                if (navDoc) setActivePhase(getPhaseIdx(navDoc));
                if (navDocId) {
                  type AnyDoc = { id: string; user_id: string; file_type: string };
                  const all = [...((json.docs ?? []) as AnyDoc[]), ...((json.docHistory ?? []) as AnyDoc[])];
                  const doc = all.find(d => d.id === navDocId);
                  if (doc) {
                    setActivePhase(getPhaseIdx(doc.file_type));
                    setTimeout(() => setPreviewDoc(doc as Doc), 50);
                  }
                }
              }
              window.history.replaceState({}, "", window.location.pathname);
            }
          } catch (err) {
            console.error("Admin data fetch error:", err);
          }
        })(),
      ]);

      if (cancelled) return;
      if (authFailed) { router.replace("/portal/dashboard"); return; }

      // ── 3. Reveal the dashboard in a single render. ────────────────────
      setLoading(false);

      // ── 4. Background fetches (non-critical, after reveal) ─────────────
      fetch("/api/portal/admin/me/signature", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (!cancelled && j?.signature) setAdminSavedSig(j.signature); })
        .catch(() => {});
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for notification deep-link events. Fires when AdminBell.handleClick
  // dispatches `bv-admin-deep-link` — handles the case where the admin is
  // already on /portal/admin and router.push doesn't re-run the URL-param
  // effect above. Picks the user, jumps to the right phase, and opens the
  // doc preview using the SAME state as a normal row click.
  useEffect(() => {
    function onDeepLink(e: Event) {
      const ce = e as CustomEvent<{ email?: string; docId?: string | null; userId?: string; fileType?: string }>;
      const detail = ce.detail || {};
      // Resolve user id — prefer explicit userId, else lookup by email
      let uid = detail.userId;
      if (!uid && detail.email) {
        uid = Object.keys(users).find(
          id => ((users[id]?.email as string) ?? "").toLowerCase() === (detail.email ?? "").toLowerCase()
        );
      }
      if (!uid) return;
      setSelectedUser(uid);
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (!detail.docId) return;
      const all = [...docs, ...docHistory];
      const doc = all.find(d => d.id === detail.docId);
      if (doc) {
        setActivePhase(getPhaseIdx(doc.file_type));
        // Small delay so the candidate panel mounts first
        setTimeout(() => setPreviewDoc(doc), 80);
      }
    }
    window.addEventListener("bv-admin-deep-link", onDeepLink);
    return () => window.removeEventListener("bv-admin-deep-link", onDeepLink);
  }, [users, docs, docHistory]);

  // Reset dirty + passport + pipeline stage when switching candidates
  useEffect(() => {
    setDirtyFeedbacks(new Set());
    setPassportEditMode(false);
    setPassportInfoEditMode(false);
    setPassportInfoEdits({});
    setRevokeMenu(null);
    setPassportEdits({});
    setActivePipelineStage(null);
    setAdminConfirmedFields(new Set());
  }, [selectedUser]);

  // Load pipeline whenever a candidate is selected
  useEffect(() => {
    if (!selectedUser || !accessToken) return;
    let mounted = true;
    const controller = new AbortController();
    setPipelineLoaded(false);
    setPipeline(DEFAULT_PIPELINE);
    fetch(`/api/portal/pipeline?userId=${selectedUser}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(({ pipeline: p }) => {
        if (!mounted) return;
        setPipeline(p ? {
          interview_link: p.interview_link ?? "",
          interview_date: p.interview_date ? p.interview_date.slice(0, 16) : "",
          interview_status: p.interview_status ?? "pending",
          recognition_unlocked: p.recognition_unlocked ?? false,
          embassy_unlocked: p.embassy_unlocked ?? false,
          visa_granted: p.visa_granted ?? false,
          visa_date: p.visa_date ? p.visa_date.slice(0, 16) : "",
          flight_date: p.flight_date ?? "",
          flight_info: p.flight_info ?? "",
          docs_approved: p.docs_approved ?? false,
          integration_unlocked: p.integration_unlocked ?? false,
          start_unlocked: p.start_unlocked ?? false,
          interview_type: p.interview_type ?? "",
          interview_notes: p.interview_notes ?? "",
        } : DEFAULT_PIPELINE);
        setPipelineLoaded(true);
      })
      .catch(err => { if (err.name !== "AbortError") console.error("Pipeline fetch error:", err); });
    return () => { mounted = false; controller.abort(); };
  }, [selectedUser, accessToken]);

  /** Immediately persist a single-field pipeline toggle without waiting for Send.
   *  Merges `update` with current pipeline so stale-closure state is never sent. */
  async function savePipelineField(update: Partial<AdminPipeline>) {
    if (!selectedUser) return;
    const prev = pipeline;
    setPipeline(p => ({ ...p, ...update }));
    try {
      const res = await fetch("/api/portal/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: selectedUser, ...update }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error("[savePipelineField] HTTP", res.status, detail);
        setPipeline(prev); // rollback optimistic update
        // LAW #31: surface lock/unlock failures explicitly so silent drops are
        // never mistaken for "click did nothing".
        showError(`Update failed (${res.status}). ${detail.slice(0, 80)}`);
      }
    } catch (err) {
      setPipeline(prev);
      console.error("[savePipelineField] network error", err);
      showError("Network error — check your connection and try again.");
    }
  }

  async function savePipeline() {
    if (!selectedUser) return;
    setPipelineSaving(true);
    try {
      await fetch("/api/portal/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: selectedUser, ...pipeline }),
      });
      setPipelineSaved(true);
      setTimeout(() => setPipelineSaved(false), 2500);
    } catch (err) {
      console.error("Save pipeline error:", err);
      showError(t.adErrPipeline);
    } finally {
      setPipelineSaving(false);
    }
  }

  async function savePassport() {
    if (!selectedUser) return;
    setPassportSaving(true);
    try {
      const res = await fetch("/api/portal/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: selectedUser, profile: passportEdits }),
      });
      if (res.ok) {
        setProfiles(prev => ({ ...prev, [selectedUser]: { ...prev[selectedUser], ...passportEdits } }));
        setProfileSaved(true);
        setTimeout(() => { setProfileSaved(false); setPassportEditMode(false); }, 1500);
      }
    } catch (err) {
      console.error("Save passport error:", err);
      showError(t.adErrProfile);
    } finally {
      setPassportSaving(false);
    }
  }

  /** Approve or reject passport data — updates passport_status + optional feedback */
  async function reviewPassport(status: "approved" | "rejected" | "pending", feedback?: string) {
    if (!selectedUser) return;
    setPassportInfoSaving(true);
    try {
      const profileUpdate: Partial<CandidateProfile> = { passport_status: status };
      if (feedback !== undefined) profileUpdate.passport_feedback = feedback || null;
      const res = await fetch("/api/portal/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: selectedUser, profile: profileUpdate }),
      });
      if (res.ok) {
        setProfiles(prev => ({ ...prev, [selectedUser]: { ...prev[selectedUser], ...profileUpdate } }));
      }
    } catch (err) {
      console.error("reviewPassport error:", err);
      showError(t.adErrPassportStatus);
    } finally {
      setPassportInfoSaving(false);
    }
  }

  /** Push the selected candidate into an org (admin-initiated placement). */
  async function placeWithOrg(orgId: string) {
    if (!selectedUser || !orgId) return;
    setPlacing(true);
    try {
      const res = await fetch(`/api/portal/admin/organizations/${orgId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ candidateUserId: selectedUser, status: "approved" }),
      });
      if (!res.ok) { showError(t.adErrNetwork); return; }
      const org = allOrgs.find(o => o.id === orgId);
      if (org) {
        // Optimistic update — no need to re-fetch the whole admin payload.
        setCandidateOrgs(prev => ({
          ...prev,
          [selectedUser]: [
            ...(prev[selectedUser] ?? []).filter(o => o.id !== orgId),
            { id: org.id, name: org.name },
          ],
        }));
      }
      setPlacementOrgId("");
    } catch {
      showError(t.adErrNetwork);
    } finally {
      setPlacing(false);
    }
  }

  /** Assign a candidate to an org need directly from the org-needs panel. */
  async function assignNeedCandidate(need: { id: string; orgId: string }, userId: string) {
    if (!userId) return;
    setNeedPlacing(p => ({ ...p, [need.id]: true }));
    try {
      const res = await fetch(`/api/portal/admin/organizations/${need.orgId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ candidateUserId: userId, status: "approved" }),
      });
      if (!res.ok) { showError(t.adErrNetwork); return; }
      const org = allOrgs.find(o => o.id === need.orgId);
      if (org) {
        setCandidateOrgs(prev => ({
          ...prev,
          [userId]: [...(prev[userId] ?? []).filter(o => o.id !== need.orgId), { id: org.id, name: org.name }],
        }));
      }
      setNeedAssign(p => ({ ...p, [need.id]: "" }));
    } catch {
      showError(t.adErrNetwork);
    } finally {
      setNeedPlacing(p => ({ ...p, [need.id]: false }));
    }
  }

  /** Remove a candidate from an org. */
  async function removeFromOrg(orgId: string) {
    if (!selectedUser) return;
    const prev = candidateOrgs;
    // Optimistic removal first.
    setCandidateOrgs(p => ({
      ...p,
      [selectedUser]: (p[selectedUser] ?? []).filter(o => o.id !== orgId),
    }));
    try {
      const res = await fetch(`/api/portal/admin/organizations/${orgId}/candidates`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ candidateUserId: selectedUser }),
      });
      if (!res.ok) { setCandidateOrgs(prev); showError(t.adErrNetwork); }
    } catch {
      setCandidateOrgs(prev);
      showError(t.adErrNetwork);
    }
  }

  async function decideMatch(matchId: string, action: "accepted" | "skipped") {
    setMatchDeciding(p => ({ ...p, [matchId]: true }));
    try {
      const res = await fetch("/api/portal/admin/suggested-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ matchId, action }),
      });
      if (!res.ok) { showError(t.adErrNetwork); return; }
      setSuggestedMatches(prev => prev.filter(m => m.id !== matchId));
      // If accepted, refresh candidateOrgs map so the org tag appears under the candidate
      if (action === "accepted") {
        const m = suggestedMatches.find(x => x.id === matchId);
        if (m) {
          setCandidateOrgs(prev => ({
            ...prev,
            [m.candidateUserId]: [...(prev[m.candidateUserId] ?? []).filter(o => o.id !== m.orgId), { id: m.orgId, name: m.orgName }],
          }));
        }
      }
    } catch {
      showError(t.adErrNetwork);
    } finally {
      setMatchDeciding(p => ({ ...p, [matchId]: false }));
    }
  }

  /** Toggle the manual verified-tick override for the currently-selected candidate. */
  async function toggleManualVerify() {
    if (!selectedUser) return;
    const current = !!profiles[selectedUser]?.manually_verified;
    const next = !current;
    // Optimistic update — flip immediately so the badge reflects the click
    setProfiles(prev => ({
      ...prev,
      [selectedUser]: { ...prev[selectedUser], manually_verified: next },
    }));
    try {
      const res = await fetch("/api/portal/admin/verify-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: selectedUser, verified: next }),
      });
      if (!res.ok) {
        // Revert on failure
        setProfiles(prev => ({
          ...prev,
          [selectedUser]: { ...prev[selectedUser], manually_verified: current },
        }));
        showError(t.adErrVerify);
      }
    } catch (err) {
      console.error("toggleManualVerify error:", err);
      setProfiles(prev => ({
        ...prev,
        [selectedUser]: { ...prev[selectedUser], manually_verified: current },
      }));
      showError(t.adErrNetwork);
    }
  }

  /** Save edits made inside the passport info modal */
  async function savePassportInfo() {
    if (!selectedUser) return;
    setPassportInfoSaving(true);
    try {
      const res = await fetch("/api/portal/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: selectedUser, profile: passportInfoEdits }),
      });
      if (res.ok) {
        setProfiles(prev => ({ ...prev, [selectedUser]: { ...prev[selectedUser], ...passportInfoEdits } }));
        setPassportInfoEditMode(false);
        setPassportInfoEdits({});
      }
    } catch (err) {
      console.error("savePassportInfo error:", err);
      showError(t.adErrPassportSave);
    } finally {
      setPassportInfoSaving(false);
    }
  }

  async function review(docId: string, status: string, feedbackOverride?: string | null) {
    setSaving(s => ({ ...s, [docId]: true }));
    const fb = feedbackOverride !== undefined ? (feedbackOverride || null) : (feedbacks[docId] || null);
    try {
      const res = await fetch("/api/portal/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ docId, status, feedback: fb }),
      });
      if (res.ok) {
        setDocs(prev => prev.map(d => d.id === docId ? { ...d, status, feedback: fb } : d));
        setFeedbacks(f => ({ ...f, [docId]: fb || "" }));
        setDirtyFeedbacks(d => { const n = new Set(d); n.delete(docId); return n; });
      }
    } catch (err) {
      console.error("Review error:", err);
      showError(t.adErrDocStatus);
    } finally {
      setSaving(s => ({ ...s, [docId]: false }));
    }
  }

  // ── Phase slot CRUD ───────────────────────────────────────────────────────
  async function loadPhaseSlots(phase: string) {
    if (!accessToken || phaseSlotsLoaded[phase]) return;
    // Mark in-flight immediately to prevent concurrent fetches; reset on failure so retry is possible.
    setPhaseSlotsLoaded(prev => ({ ...prev, [phase]: true }));
    try {
      const res = await fetch(`/api/portal/phase-slots?phase=${phase}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        setPhaseSlots(prev => ({ ...prev, [phase]: j.slots ?? [] }));
      } else {
        setPhaseSlotsLoaded(prev => ({ ...prev, [phase]: false }));
      }
    } catch {
      setPhaseSlotsLoaded(prev => ({ ...prev, [phase]: false }));
    }
  }

  async function addPhaseSlot(phase: string, label: string, instructions: string) {
    if (!accessToken || !label.trim()) return;
    setAddSlotSaving(true);
    try {
      const res = await fetch("/api/portal/phase-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          phase, type: "simple", label: label.trim(),
          instructions: instructions.trim() || undefined,
        }),
      });
      if (res.ok) {
        const j = await res.json();
        setPhaseSlots(prev => ({ ...prev, [phase]: [...(prev[phase] ?? []), j.slot] }));
        setAddSlotPhase(null);
        setAddSlotLabel("");
        setAddSlotInstructions("");
      }
    } catch { /* network error */ }
    setAddSlotSaving(false);
  }

  async function saveSlotLabel(slotId: string, label: string, labelTrans: string, instructions: string) {
    if (!accessToken || !label.trim()) return;
    try {
      const res = await fetch("/api/portal/phase-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id: slotId, label: label.trim(), label_trans: labelTrans.trim() || null, instructions: instructions.trim() || null }),
      });
      if (res.ok) {
        setPhaseSlots(prev => {
          const updated: Record<string, typeof prev.bearbeitung> = {};
          for (const [ph, slots] of Object.entries(prev)) {
            updated[ph] = (slots ?? []).map(s => s.id === slotId ? { ...s, label: label.trim(), label_trans: labelTrans.trim() || null, instructions: instructions.trim() || null } : s);
          }
          return updated as typeof prev;
        });
      }
    } catch { /* network error */ }
    setEditingSlotId(null);
  }

  async function deletePhaseSlot(slotId: string, phase: string) {
    if (!accessToken) return;
    // Optimistic remove
    setPhaseSlots(prev => ({ ...prev, [phase]: (prev[phase] ?? []).filter(s => s.id !== slotId) }));
    try {
      await fetch("/api/portal/phase-slots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id: slotId }),
      });
    } catch { /* network error */ }
  }

  function openAdminUploadPicker(slotId: string) {
    if (!selectedUser) return;
    adminUploadTargetRef.current = slotId;
    adminFileInputRef.current?.click();
  }

  async function adminUploadFile(file: File, slotId: string) {
    if (!selectedUser || !accessToken) return;
    // Capture whether this slot is brand-new (no previous PDF) BEFORE upload.
    // The action popup auto-fires only on the first upload — never on re-uploads.
    const isFirstUpload = !Object.values(phaseSlots).flat().find(s => s.id === slotId)?.template_pdf_path;
    setAdminUploadSlotId(slotId);
    setAdminSlotProgress(0);
    stopAdminProgressCreep();
    const fd = new FormData();
    fd.append("file", file);
    // fileKey = slotId UUID → upload API hits the wizard-slot branch which
    // slugifies the slot label for the filename (e.g. pflegekraft_calmaroi_form.pdf).
    // fileType = slotId so the DB row is queryable by slot ID.
    fd.append("fileKey", slotId);
    fd.append("fileType", slotId);
    fd.append("forUserId", selectedUser);
    try {
      // 1) Drive upload (candidate doc, primary action — awaited so spinner
      // covers the visible work). On localhost without real Drive creds this
      // fails — we log + warn but DO NOT bail, so the popup still opens.
      const res = await new Promise<{ ok: boolean; status: number; text: string } | null>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 85);
          setAdminSlotProgress(p => (pct > p ? pct : p));
        });
        // Bytes sent — server now does Drive + AcroForm work. Ease toward 99%
        // (decelerating) so the bar always moves, never freezes at 85.
        xhr.upload.addEventListener("load", () => {
          stopAdminProgressCreep();
          adminProgressTimerRef.current = setInterval(() => {
            setAdminSlotProgress(p => {
              if (p < 85) return p;
              const next = p + (99 - p) * 0.06;
              return next > 98.6 ? 98.6 : next;
            });
          }, 60);
        });
        xhr.addEventListener("load", () => {
          stopAdminProgressCreep();
          setAdminSlotProgress(100);
          resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText });
        });
        xhr.addEventListener("error", () => { stopAdminProgressCreep(); resolve(null); });
        xhr.addEventListener("abort", () => { stopAdminProgressCreep(); resolve(null); });
        xhr.open("POST", "/api/portal/upload");
        if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        xhr.send(fd);
      });
      const driveOk = !!res?.ok;
      if (!driveOk) {
        let body: { error?: string } = {};
        try { body = res ? JSON.parse(res.text) : {}; } catch { /* non-JSON */ }
        console.warn("[adminUploadFile] Drive upload failed (non-fatal):", body);
      }

      // 2) Cache the file locally so the placement wizard can render INSTANTLY
      //    without round-tripping to Supabase Storage. Optimistically mark the
      //    slot as having a template so saveSlotConfig's gate passes.
      localTemplateFileRef.current.set(slotId, file);
      const templatePath = `slot-templates/${slotId}.pdf`;
      setPhaseSlots(prev => {
        const updated: typeof prev = {};
        for (const [ph, slots] of Object.entries(prev))
          updated[ph] = (slots ?? []).map(s => s?.id === slotId ? { ...s, template_pdf_path: templatePath } : s);
        return updated;
      });

      // 3) Detect native AcroForm fields. If the PDF was authored with > 3
      //    fillable fields (BA EzB, government forms, etc.), branch to the
      //    auto-fill review modal — admin doesn't need to draw boxes or
      //    configure signatures, since the form is meant to be printed +
      //    physically signed by the employer.
      let nativeFields: DetectedField[] = [];
      let pdfBytesForReview: ArrayBuffer | null = null;
      try {
        pdfBytesForReview = await file.arrayBuffer();
        nativeFields = await detectAcroFormFields(pdfBytesForReview);
      } catch (e) {
        console.warn("[adminUploadFile] AcroForm detection failed (non-fatal):", e);
      }
      const hasManyNativeFields = nativeFields.length > 3;

      // 4) Auto-open the appropriate popup IMMEDIATELY on first upload.
      if (isFirstUpload) {
        if (hasManyNativeFields && pdfBytesForReview) {
          setAutoFillReview({ slotId, file, pdfBytes: pdfBytesForReview, detected: nativeFields });
        } else {
          setSlotConfigPopup({ slotId, admin_signs: false, candidate_signs: false, admin_fills: false, candidate_fills: false, pdf_has_native_fields: false });
        }
      }

      // 4) Everything else runs in the background — doesn't block the spinner /
      //    popup. By the time the user picks options + clicks Confirm, these
      //    have usually finished. If they're fast and Confirm beats the
      //    slot-template POST, the wizard falls back to the local file cache.
      void (async () => {
        if (driveOk && selectedUser) {
          const res2 = await fetch(`/api/portal/admin?userId=${selectedUser}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }).catch(() => null);
          if (res2?.ok) {
            const json2 = await res2.json();
            const freshDocs: Doc[] = json2.docs ?? [];
            setDocs(prev => [
              ...prev.filter(d => d.user_id !== selectedUser),
              ...freshDocs,
            ]);
          }
        }
        const tplFd = new FormData();
        tplFd.append("file", file);
        tplFd.append("slotId", slotId);
        await fetch("/api/portal/admin/slot-template", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: tplFd,
        }).catch(err => console.warn("[adminUploadFile] slot-template background upload failed:", err));
      })();
    } catch (err) {
      showError("Upload failed — check your connection and try again.");
      console.error("[adminUploadFile]", err);
    } finally {
      stopAdminProgressCreep();
      setAdminUploadSlotId(null);
      setAdminSlotProgress(0);
    }
  }

  async function saveSlotConfig(cfg: NonNullable<typeof slotConfigPopup>) {
    if (!accessToken) return;
    setSlotConfigSaving(true);
    try {
      await fetch("/api/portal/phase-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          id: cfg.slotId,
          admin_signs: cfg.admin_signs, candidate_signs: cfg.candidate_signs,
          admin_fills: cfg.admin_fills, candidate_fills: cfg.candidate_fills,
          pdf_has_native_fields: cfg.pdf_has_native_fields,
        }),
      });
      // Update local state
      setPhaseSlots(prev => {
        const updated: typeof prev = {};
        for (const [ph, slots] of Object.entries(prev)) {
          updated[ph] = (slots ?? []).map(s => s.id === cfg.slotId
            ? { ...s, admin_signs: cfg.admin_signs, candidate_signs: cfg.candidate_signs, admin_fills: cfg.admin_fills, candidate_fills: cfg.candidate_fills, pdf_has_native_fields: cfg.pdf_has_native_fields }
            : s);
        }
        return updated;
      });
      const slot = Object.values(phaseSlots).flat().find(s => s?.id === cfg.slotId) ?? null;
      setSlotConfigPopup(null);

      // Branch 1: admin checked "Admin signs" but has no saved signature yet →
      // open the signature setup sub-popup first. Once they confirm a signature,
      // the sub-popup's flow re-enters the placement chain below.
      if (cfg.admin_signs && !adminSavedSig) {
        setAdminSigSubPopup({ slotId: cfg.slotId, pendingSig: null });
        return;
      }

      // Branch 2: signature placement is needed → open the placement wizard.
      // Field drawing was removed; PDFs ship with native AcroForm fields that
      // are auto-filled at upload time via AutoFillReviewModal.
      const needsAdminSig = !!(cfg.admin_signs && slot);
      const needsCandidateSig = !!(cfg.candidate_signs && slot);
      if ((needsAdminSig || needsCandidateSig) && slot) {
        await openPlacementWizard(cfg.slotId, { admin: needsAdminSig, candidate: needsCandidateSig });
      }
    } finally { setSlotConfigSaving(false); }
  }

  /**
   * Open the placement wizard for a slot. Fetches the slot's template PDF,
   * builds the ordered step list (signatures only — drawing form fields was
   * removed per user directive), and shows the wizard modal.
   */
  async function openPlacementWizard(
    slotId: string,
    needs: { admin?: boolean; candidate?: boolean },
  ) {
    if (!accessToken) return;
    try {
      // PDF resolution order (first hit wins):
      //   1. Local cache from the most recent client-side upload (instant).
      //   2. Supabase Storage `slot-templates` bucket (recent uploads).
      //   3. Drive — the admin-uploaded doc for this slot (legacy slots that
      //      pre-date the slot-templates bucket). We also backfill Storage on
      //      this path so the next open is fast.
      const cachedFile = localTemplateFileRef.current.get(slotId);
      const cvResPromise = selectedUser
        ? fetch(`/api/portal/admin/cv-draft?candidateId=${selectedUser}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }).then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null);
      let buf: ArrayBuffer | null = null;
      let cvRes: unknown = null;
      if (cachedFile) {
        [buf, cvRes] = await Promise.all([cachedFile.arrayBuffer(), cvResPromise]);
      } else {
        const [tplRes, resolvedCv] = await Promise.all([
          fetch(`/api/portal/admin/slot-template?slotId=${slotId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }).catch(() => null),
          cvResPromise,
        ]);
        cvRes = resolvedCv;
        if (tplRes?.ok) {
          buf = await tplRes.arrayBuffer();
        } else {
          // Drive fallback for legacy slots: pull the admin-uploaded doc for
          // this slot from Drive via the file proxy. `docs` is the global state
          // — scoped to the current candidate (or whichever the slot belongs to).
          const adminDoc = docs.find(d => d.file_type === slotId && d.uploaded_by_admin && d.drive_file_id);
          if (adminDoc?.drive_file_id) {
            const driveRes = await fetch(`/api/portal/file?id=${adminDoc.drive_file_id}`, {
              headers: { Authorization: `Bearer ${accessToken}` },
            }).catch(() => null);
            if (driveRes?.ok) {
              buf = await driveRes.arrayBuffer();
              // Backfill: mirror to slot-template Storage so next open is fast.
              try {
                const tplFd = new FormData();
                tplFd.append("file", new Blob([buf], { type: "application/pdf" }), `${slotId}.pdf`);
                tplFd.append("slotId", slotId);
                void fetch("/api/portal/admin/slot-template", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${accessToken}` },
                  body: tplFd,
                });
              } catch { /* non-fatal */ }
            }
          }
        }
        if (!buf) {
          showError("Could not load PDF template — please upload a PDF for this slot first.");
          return;
        }
      }
      // Chunked base64 encoding — spreading a Uint8Array as function args
      // overflows the JS call stack for PDFs > ~100KB. Process in 32KB slices.
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
      }
      const b64 = btoa(bin);
      // Step order: admin sig → candidate sig.
      const steps: WizardStep[] = [];
      if (needs.admin) steps.push("admin_sig");
      if (needs.candidate) steps.push("candidate_sig");
      if (steps.length === 0) return;
      void cvRes; // legacy: previously used to resolve field bindings
      // Pre-fill from saved slot data so re-opening the popup edits the
      // previous setup instead of starting blank. Admin sig zone isn't
      // recovered (the signature is already baked into the PDF on first
      // submit) — admin can draw a new one if they want a second placement.
      const existingSlot = Object.values(phaseSlots).flat().find(s => s?.id === slotId);
      setPlacementWizard({
        slotId, pdfB64: b64, steps, stepIdx: 0,
        adminSigZone: null,
        candidateSigZone: existingSlot?.candidate_signature_zone ?? null,
      });
    } catch (err) {
      console.error("[openPlacementWizard] error:", err);
      showError("Could not open placement wizard.");
    }
  }

  async function saveSlotOrder(phase: string, slots: { id: string; position: number }[]) {
    if (!accessToken) return;
    try {
      await fetch("/api/portal/phase-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ positions: slots }),
      });
    } catch { /* network error */ }
  }

  // ── Rejection modal ──────────────────────────────────────────────────────
  // Pops up when admin clicks reject on any doc/passport row. Lets them write
  // optional feedback + attach an optional screenshot (sent to the candidate
  // chat thread as an admin message).
  const [rejectTarget, setRejectTarget] = useState<
    | { kind: "doc"; docId: string; label: string; initialFeedback: string }
    | { kind: "passport"; label: string; initialFeedback: string }
    | null
  >(null);
  function openRejectModal(target: NonNullable<typeof rejectTarget>) {
    setRejectTarget(target);
  }
  function closeRejectModal() {
    setRejectTarget(null);
  }
  async function submitReject(text: string, shot: string | null) {
    if (!rejectTarget) return;
    if (rejectTarget.kind === "doc") {
      await review(rejectTarget.docId, "rejected", text);
    } else {
      setPassportDataFeedback(text);
      await reviewPassport("rejected", text);
    }
    if (shot && selectedUser) {
      try {
        const rejectedLabel = lang === "fr" ? "Refusé" : lang === "de" ? "Abgelehnt" : "Rejected";
        const msgBody = text.trim() ? text.trim() : `${rejectedLabel}: ${rejectTarget.label}`;
        await fetch("/api/portal/admin/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ threadUserId: selectedUser, body: msgBody, attachment: shot }),
        });
      } catch (e) {
        console.error("[reject] attach send failed:", e);
      }
    }
    closeRejectModal();
  }

  // ── Keyboard shortcuts in the candidate panel ─────────────────────────────
  // J / K (or ← / →) — prev / next phase
  // 1–4               — jump to phase index
  // Escape            — back to candidate list
  // Suppressed when focus is inside an input / textarea / contenteditable.
  // CRITICAL: must be declared BEFORE any conditional return to satisfy the
  // Rules of Hooks (otherwise React error #310 — hooks count diverges).
  React.useEffect(() => {
    if (!selectedUser) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const PHASE_COUNT = 2; // ID & CV, Nursing (translations merged into Nursing)
      if (e.key === "Escape") { e.preventDefault(); setSelectedUser(null); return; }
      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "j") {
        e.preventDefault();
        setActivePipelineStage(null);
        setActivePhase(p => Math.max(0, p - 1));
        return;
      }
      if (e.key === "ArrowRight" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        setActivePipelineStage(null);
        setActivePhase(p => Math.min(PHASE_COUNT - 1, p + 1));
        return;
      }
      if (e.key >= "1" && e.key <= "2") {
        e.preventDefault();
        setActivePipelineStage(null);
        setActivePhase(parseInt(e.key, 10) - 1);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedUser]);

  if (loading) return <PageLoader />;

  const grouped = docs.reduce<Record<string, Doc[]>>((acc, doc) => {
    if (!acc[doc.user_id]) acc[doc.user_id] = [];
    acc[doc.user_id].push(doc);
    return acc;
  }, {});

  // Candidates with at least one pending doc (sorted by most recent upload)
  const pendingUserIds = Object.keys(grouped)
    .filter(uid => grouped[uid].some(d => d.status === "pending"))
    .sort((a, b) => {
      const la = Math.max(...grouped[a].map(d => new Date(d.uploaded_at).getTime()));
      const lb = Math.max(...grouped[b].map(d => new Date(d.uploaded_at).getTime()));
      return lb - la;
    });

  // Archived: candidates with no pending docs OR who signed up but haven't uploaded yet
  const zeroDogUserIds = Object.keys(users).filter(uid => !grouped[uid]);
  const archivedUserIds = [
    ...Object.keys(grouped).filter(uid => !grouped[uid].some(d => d.status === "pending")),
    ...zeroDogUserIds,
  ].sort((a, b) => {
    const la = grouped[a] ? Math.max(...grouped[a].map(d => new Date(d.uploaded_at).getTime())) : 0;
    const lb = grouped[b] ? Math.max(...grouped[b].map(d => new Date(d.uploaded_at).getTime())) : 0;
    return lb - la;
  });

  const totalPending = docs.filter(d => d.status === "pending").length;

  // ── DETAIL VIEW ──────────────────────────────────────────────────────────────
  if (selectedUser) {
    const allDocs     = grouped[selectedUser] ?? [];
    const user        = users[selectedUser] ?? { name: selectedUser, email: selectedUser };
    const pendingDocs = allDocs.filter(d => d.status === "pending");

    // ── Same phase/item structure as candidate portal ──────────────────────────
    const PHASE_ITEMS: { title: string; shortTitle: string; kind: PhaseKind; items: { key: string; label: string; optional?: boolean; transKey?: string }[] }[] = [
      { title: t.pWizardPhase1, shortTitle: t.pSideID, kind: "id", items: [
        { key: "id",       label: t.pTypeID },
        { key: "cv_de",    label: t.pTypeCVde },
        { key: "letter",   label: t.pTypeLetter },
        { key: "langcert", label: t.pTypeLangCert },
        { key: "other",    label: t.pTypeOther },
      ]},
      { title: t.pWizardPhase2, shortTitle: t.pSideNursing, kind: "nursing", items: [
        { key: "diploma",           transKey: "diploma_de",           label: t.pTypeDiploma,          optional: false },
        { key: "studyprog",         transKey: "studyprog_de",         label: t.pTypeStudyProg,        optional: false },
        { key: "transcript",        transKey: "transcript_de",        label: t.pTypeTranscript,       optional: false },
        { key: "abitur",            transKey: "abitur_de",            label: t.pTypeAbitur,           optional: false },
        { key: "abitur_transcript", transKey: "abitur_transcript_de", label: t.pTypeAbiturTranscript, optional: false },
        { key: "praktikum",         transKey: "praktikum_de",         label: t.pTypePraktikum,        optional: false },
        { key: "workcert",          transKey: "workcert_de",          label: t.pTypeWorkCert,         optional: false },
        { key: "work_experience",   transKey: "work_experience_de",   label: t.pTypeWorkExp,          optional: true  },
        { key: "impfung",           transKey: "impfung_de",           label: t.pTypeImpfung,          optional: false },
      ]},
    ];

    // Helper: get all docs for a file key (supports static keys + dynamic slot IDs)
    function getAdminDocs(key: string): Doc[] {
      if (key === "passport_data_pdf") {
        const p = profiles[selectedUser ?? ""];
        if (!p || !p.passport_status) return [];
        const fn = (p.first_name ?? "vorname").toLowerCase().replace(/\s+/g, "_");
        const ln = (p.last_name  ?? "nachname").toLowerCase().replace(/\s+/g, "_");
        return [{ id: "passport_data_pdf", user_id: selectedUser ?? "", file_name: `${fn}_${ln}_reisepass_daten.pdf`, file_type: "Reisepass Daten", uploaded_at: new Date().toISOString(), status: p.passport_status, feedback: null, drive_file_id: null, uploaded_by_admin: false }];
      }
      const labels = FILE_KEY_ALL_LABELS[key];
      if (labels) return allDocs.filter(d => labels.has(d.file_type));
      // Dynamic slot IDs stored directly as file_type
      return allDocs.filter(d => d.file_type === key);
    }

    // Sidebar color per phase (same logic as candidate portal)
    function phaseColor(pi: number): "empty" | "pending" | "approved" | "rejected" {
      const items = PHASE_ITEMS[pi].items;
      let anySubmitted = false, anyRejected = false, anyPending = false, allApproved = true;
      for (const item of items) {
        const ds = [
          ...getAdminDocs(item.key),
          ...(item.transKey ? getAdminDocs(item.transKey) : []),
        ];
        if (ds.length > 0) {
          anySubmitted = true;
          if (ds.some(d => d.status === "rejected")) anyRejected = true;
          if (ds.some(d => d.status === "pending"))  anyPending  = true;
          if (!ds.every(d => d.status === "approved")) allApproved = false;
        } else { allApproved = false; }
      }
      if (!anySubmitted) return "empty";
      if (anyRejected)   return "rejected";
      if (allApproved)   return "approved";
      return "pending";
    }

    const currentItems = PHASE_ITEMS[activePhase].items;

    function downloadDoc(doc: Doc) {
      if (!doc.drive_file_id) return;
      // iOS can't save a client blob — it must navigate to a server route
      // that streams an octet-stream attachment, which triggers the native
      // "Do you want to download…" prompt. Same fix as the candidate side.
      if (isIOSDevice()) {
        triggerIosDownload(
          `/api/portal/file?id=${encodeURIComponent(doc.drive_file_id)}` +
            `&dl=1&name=${encodeURIComponent(doc.file_name)}` +
            `&access_token=${encodeURIComponent(accessToken)}`,
          doc.file_name,
        );
        return;
      }
      fetch(`/api/portal/file?id=${doc.drive_file_id}`, { headers: { Authorization: `Bearer ${accessToken}` } })
        .then(r => r.blob())
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = doc.file_name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        })
        .catch(err => console.error("Download error:", err));
    }

    // ── Passport Info Modal helpers ──────────────────────────────────────────
    const p_info = profiles[selectedUser];
    const fmt_info = (iso: string | null) => iso ? fmtDate(iso) : "—";
    const up_info  = (s: string | null) => (s ?? "—").toUpperCase();
    const nat_info = (v: string | null) => natToLangAdmin(v, lang).toUpperCase();
    const sex_info = p_info?.sex === "M" ? (lang==="fr"?"MASCULIN":lang==="de"?"MÄNNLICH":"MALE") : p_info?.sex === "F" ? (lang==="fr"?"FÉMININ":lang==="de"?"WEIBLICH":"FEMALE") : (p_info?.sex ?? "—").toUpperCase();

    // Pre-computed display groups — used by read-only view AND the download button
    const passportDisplayGroups = (() => {
      if (!p_info) return [];
      const G = lang==="fr"
        ? { personal:"Personnel",passport:"Passeport",address:"Adresse",
            ln:"Nom de famille",fn:"Prénom",dob:"Date de naissance",sex:"Sexe",nat:"Nationalité",cob:"Ville de naissance",cntob:"Pays de naissance",
            pno:"N° passeport",isd:"Date d'émission",exp:"Date d'expiration",iss:"Autorité émettrice",
            str:"Rue",num:"N°",post:"Code postal",cres:"Ville de résidence",cntres:"Pays de résidence",
            marital: "Situation familiale" }
        : lang==="de"
        ? { personal:"Persönlich",passport:"Reisepass",address:"Adresse",
            ln:"Nachname",fn:"Vorname",dob:"Geburtsdatum",sex:"Geschlecht",nat:"Staatsangehörigkeit",cob:"Geburtsort",cntob:"Geburtsland",
            pno:"Reisepassnummer",isd:"Ausstellungsdatum",exp:"Ablaufdatum",iss:"Ausstellungsbehörde",
            str:"Straße",num:"Hausnummer",post:"Postleitzahl",cres:"Wohnort",cntres:"Wohnland",
            marital: "Familienstand" }
        : { personal:"Personal",passport:"Passport",address:"Address",
            ln:"Last name",fn:"First name",dob:"Date of birth",sex:"Sex",nat:"Nationality",cob:"City of birth",cntob:"Country of birth",
            pno:"Passport No",isd:"Issue date",exp:"Expiry",iss:"Issuing authority",
            str:"Street",num:"Number",post:"Postal code",cres:"City of residence",cntres:"Country of residence",
            marital: "Marital status" };
      const familienstand_info = computeFamilienstandAdmin(p_info.marital_status, p_info.children_ages).toUpperCase();
      return [
        { title: G.personal, fields: [
          { label: G.ln,    value: up_info(p_info.last_name) },
          { label: G.fn,    value: up_info(p_info.first_name) },
          { label: G.dob,   value: fmt_info(p_info.dob) },
          { label: G.sex,   value: sex_info },
          { label: G.nat,   value: nat_info(p_info.nationality) },
          { label: G.cob,   value: up_info(p_info.city_of_birth) },
          { label: G.cntob, value: nat_info(p_info.country_of_birth) },
          ...(p_info.marital_status ? [{ label: G.marital, value: familienstand_info }] : []),
        ]},
        { title: G.passport, fields: [
          { label: G.pno, value: (p_info.passport_no ?? "—").toUpperCase() },
          { label: G.isd, value: fmt_info(p_info.issue_date) },
          { label: G.exp, value: fmt_info(p_info.passport_expiry) },
          { label: G.iss, value: up_info(p_info.issuing_authority) },
        ]},
        { title: G.address, fields: [
          { label: G.str,    value: up_info(p_info.address_street) },
          { label: G.num,    value: p_info.address_number ?? "—" },
          { label: G.post,   value: p_info.address_postal ?? "—" },
          { label: G.cres,   value: up_info(p_info.city_of_residence) },
          { label: G.cntres, value: nat_info(p_info.country_of_residence) },
        ]},
      ];
    })();

    async function deleteCandidate() {
      if (!selectedUser || deleteCandidateInput !== "DELETE") return;
      setDeletingCandidate(true);
      try {
        const res = await fetch("/api/portal/admin/delete-user", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ userId: selectedUser }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          showError(j.error ?? t.adErrDelete);
          return;
        }
        // Remove from local state
        setUsers(prev => { const n = { ...prev }; delete n[selectedUser]; return n; });
        setDocs(prev => prev.filter(d => d.user_id !== selectedUser));
        setDocHistory(prev => prev.filter(d => d.user_id !== selectedUser));
        setProfiles(prev => { const n = { ...prev }; delete n[selectedUser]; return n; });
        setDeleteCandidateConfirm(false);
        setSelectedUser(null);
      } finally {
        setDeletingCandidate(false);
      }
    }

    /** Normalize stored nationality / country value to its ISO code for the dropdown */
    function toIsoCodeAdmin(v: string | null | undefined): string {
      if (!v) return "";
      const up = v.trim().toUpperCase();
      if (NAT_MAP[up]) return up; // already ISO
      // Match by any language display name
      for (const [code, names] of Object.entries(NAT_MAP)) {
        if ([names.fr.toUpperCase(), names.en.toUpperCase(), names.de.toUpperCase()].includes(up)) return code;
      }
      return "";
    }

    return (
      <>
        {/* ── Error toast (auto-dismisses) ── */}
        {adminToast && (
          <div
            style={{
              position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
              zIndex: 2147483601, pointerEvents: "none",
              background: "var(--danger-bg)", color: "var(--danger)",
              border: "1px solid var(--danger-border)", borderRadius: 10,
              padding: "10px 16px", fontSize: 12.5, fontWeight: 600,
              boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
              animation: "bvFadeRise 0.2s var(--ease-out)",
            }}>
            {adminToast.msg}
          </div>
        )}

        {previewDoc && (
          <AdminDocPreviewModal
            doc={previewDoc}
            accessToken={accessToken}
            onClose={() => { setPreviewDoc(null); setShowPassportInfo(false); }}
            noPreviewText={t.aNoPreview}
            onUpdated={(d) => setDocs(prev => prev.map(x => x.id === d.id ? { ...x, status: d.status, feedback: d.feedback } : x))}
            onShowPassportData={() => setShowPassportInfo(true)}
            sideBySide={
              /pass/i.test(previewDoc.file_type)
              && showPassportInfo
              // Fully approved (PDF + data both green) → data pops centered
              // ON TOP, never docked side-by-side.
              && !(previewDoc.status === "approved"
                   && profiles[previewDoc.user_id]?.passport_status === "approved")
            }
          />
        )}

        {mergePreview && (
          <AdminDocPreviewModal
            doc={{
              id: mergePreview.origDocId,
              user_id: "",
              file_name: `${mergePreview.label.replace(/\s+/g, "_")}_merged.pdf`,
              file_type: mergePreview.label,
              uploaded_at: new Date().toISOString(),
              status: "pending",
              feedback: null,
              drive_file_id: null,
            }}
            accessToken={accessToken}
            overrideFetchUrl={`/api/portal/documents/merge-pdf?origDocId=${mergePreview.origDocId}&transDocId=${mergePreview.transDocId}`}
            onClose={() => setMergePreview(null)}
            noPreviewText={t.aNoPreview}
          />
        )}

        {/* Passport Info Modal — with approve / reject / edit */}
        {showPassportInfo && (() => {
          const pst = p_info?.passport_status ?? null;
          const pstBg    = pst === "approved" ? "var(--success-bg)"   : pst === "rejected" ? "var(--danger-bg)"  : "var(--gdim)";
          const pstColor = pst === "approved" ? "var(--success)"                : pst === "rejected" ? "var(--danger)"               : "#f59e0b";
          const pstBdr   = pst === "approved" ? "var(--success-border)"   : pst === "rejected" ? "var(--danger-border)"   : "var(--border-gold)";
          const pstLabel = pst === "approved"
            ? (lang === "fr" ? "Approuvé" : lang === "de" ? "Genehmigt" : "Approved")
            : pst === "rejected"
            ? (lang === "fr" ? "Refusé" : lang === "de" ? "Abgelehnt" : "Rejected")
            : pst === "pending"
            ? (lang === "fr" ? "En cours de vérification" : lang === "de" ? "In Prüfung" : "Pending review")
            : (lang === "fr" ? "Non soumis" : lang === "de" ? "Nicht eingereicht" : "Not submitted");

          // Guard: all filled fields must be confirmed before approving
          const filledFieldLabels = passportDisplayGroups.flatMap(g =>
            g.fields.filter(f => f.value && f.value !== "—" && f.value.trim() !== "").map(f => f.label)
          );
          const allFilledConfirmed = filledFieldLabels.length > 0 && filledFieldLabels.every(lbl => adminConfirmedFields.has(lbl));
          const unconfirmedCount   = filledFieldLabels.filter(lbl => !adminConfirmedFields.has(lbl)).length;

          // Editable fields config for this modal — labels translated per active language
          const L = lang === "fr"
            ? { fn:"Prénom",ln:"Nom de famille",dob:"Date de naissance",sex:"Sexe",nat:"Nationalité",cob:"Ville de naissance",cntob:"Pays de naissance",pno:"N° passeport",isd:"Date d'émission",exp:"Date d'expiration",iss:"Autorité émettrice",str:"Rue",num:"N°",post:"Code postal",cres:"Ville de résidence",cntres:"Pays de résidence" }
            : lang === "de"
            ? { fn:"Vorname",ln:"Nachname",dob:"Geburtsdatum",sex:"Geschlecht",nat:"Staatsangehörigkeit",cob:"Geburtsort",cntob:"Geburtsland",pno:"Reisepassnummer",isd:"Ausstellungsdatum",exp:"Ablaufdatum",iss:"Ausstellungsbehörde",str:"Straße",num:"Hausnummer",post:"Postleitzahl",cres:"Wohnort",cntres:"Wohnland" }
            : { fn:"First name",ln:"Last name",dob:"Date of birth",sex:"Sex",nat:"Nationality",cob:"City of birth",cntob:"Country of birth",pno:"Passport No",isd:"Issue date",exp:"Expiry",iss:"Issuing authority",str:"Street",num:"Number",post:"Postal code",cres:"City of residence",cntres:"Country of residence" };
          const modalFields: { key: keyof CandidateProfile; label: string; type?: "date" | "select" | "country"; full?: boolean }[] = [
            { key: "first_name",           label: L.fn },
            { key: "last_name",            label: L.ln },
            { key: "dob",                  label: L.dob,  type: "date" },
            { key: "sex",                  label: L.sex,  type: "select" },
            { key: "nationality",          label: L.nat,  type: "country" },
            { key: "city_of_birth",        label: L.cob },
            { key: "country_of_birth",     label: L.cntob, type: "country" },
            { key: "passport_no",          label: L.pno },
            { key: "issue_date",           label: L.isd,  type: "date" },
            { key: "passport_expiry",      label: L.exp,  type: "date" },
            { key: "issuing_authority",    label: L.iss,  full: true },
            { key: "address_street",       label: L.str },
            { key: "address_number",       label: L.num },
            { key: "address_postal",       label: L.post },
            { key: "city_of_residence",    label: L.cres },
            { key: "country_of_residence", label: L.cntres, type: "country" },
          ];

          function fieldVal(key: keyof CandidateProfile): string {
            const v = passportInfoEditMode
              ? ((passportInfoEdits[key] ?? p_info?.[key]) as string | null)
              : (p_info?.[key] as string | null);
            return v ?? "";
          }

          // ── Side-by-side layout rule ──
          // Whenever the passport DOC preview is open alongside this data
          // modal, dock them side-by-side regardless of status. Applies
          // before submit, after submit (pending), after reject, AND after
          // approve — admin can compare the data against the image at every
          // phase. Phone: doc on top, data on bottom. Laptop: doc left,
          // data right.
          // Fully approved (PDF + data both green) → the data renders as a
          // centered popup ON TOP of the PDF, not a docked review pane.
          const isVerificationPhase = !!previewDoc && /pass/i.test(previewDoc.file_type)
            && !(previewDoc.status === "approved"
                 && profiles[previewDoc.user_id]?.passport_status === "approved");
          void p_info; // status check intentionally dropped

          return (
            <div className={`fixed inset-x-0 z-[750] flex justify-center p-4 bv-passport-info-outer ${isVerificationPhase ? "bv-side-data" : "items-center"}`}
              style={{
                top: isVerificationPhase ? undefined : "calc(58px + var(--bv-subnav-h, 0px))",
                bottom: isVerificationPhase ? undefined : "0",
                background: isVerificationPhase ? "transparent" : "rgba(0,0,0,0.45)",
                backdropFilter: isVerificationPhase ? undefined : "blur(8px)",
                pointerEvents: isVerificationPhase ? "none" : "auto",
              }}
              onClick={() => { setShowPassportInfo(false); setPassportInfoEditMode(false); setPassportInfoEdits({}); }}>
              {/* Side-by-side rule:
                    Laptop → data form sits in the RIGHT half, centered
                    Phone  → data form takes the BOTTOM half (passport above) */}
              <style>{`
                @media (max-width: 639.98px) {
                  .bv-passport-info-outer { padding-bottom: calc(1rem + 72px) !important; }
                  /* Phone single-scroll: ONE page = passport strip (inside
                     the card) on top, data below. The data modal IS the
                     scroll container; the card flows. Scroll up → passport,
                     down → data, freely (compare). The separate fixed
                     preview pane is hidden — passport lives in this scroll. */
                  .bv-side-data {
                    top: calc(58px + var(--bv-subnav-h, 0px)) !important;
                    /* End above the bottom nav with a gap + small side gaps
                       so the card reads as a rounded POPUP, not a page. */
                    bottom: calc(72px + 6px + env(safe-area-inset-bottom, 0px)) !important;
                    padding: 6px 10px !important;
                    align-items: flex-start !important;
                    overflow-y: auto !important;
                    -webkit-overflow-scrolling: touch !important;
                    pointer-events: auto !important;
                  }
                  .bv-side-data .bv-passport-info-card {
                    height: auto !important;
                    max-height: none !important;
                    min-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 72px - 12px) !important;
                    border-radius: var(--r-2xl) !important;
                    overflow: hidden !important;
                  }
                  /* Shorter PDF on phone so the data dominates the view. */
                  .bv-side-data .bv-pp-passport-strip {
                    height: 36dvh !important;
                  }
                  .bv-side-data .bv-pp-fields {
                    overflow: visible !important;
                    flex: 0 0 auto !important;
                  }
                }
                @media (min-width: 640px) {
                  .bv-side-data {
                    top: calc(58px + var(--bv-subnav-h, 0px));
                    bottom: 0;
                    align-items: center;
                    justify-content: flex-start !important;
                    padding-left: 50vw;
                    padding-right: 1rem;
                  }
                  /* Identical size to the PDF pane — same as candidate. */
                  .bv-side-data .bv-passport-info-card {
                    height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 1rem) !important;
                    max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 1rem) !important;
                  }
                }
              `}</style>
              <div className={`bv-passport-info-card w-full overflow-hidden flex flex-col ${isVerificationPhase ? "sm:max-w-[480px]" : "max-w-lg"}`}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-2xl)",
                  boxShadow: "var(--shadow-lg)",
                  maxHeight: "88vh",
                  animation: "bvFadeRise .28s var(--ease-out)",
                  pointerEvents: "auto",
                }}
                onClick={e => e.stopPropagation()}>

                {/* Phone single-scroll: passport renders as the FIRST block
                    inside this scrolling card → one page (passport on top,
                    data below). Scroll up/down to compare. Phone only. */}
                {isVerificationPhase && (
                  <div className="bv-pp-passport-strip sm:hidden flex-shrink-0 flex flex-col"
                    style={{ width: "100%", height: "52dvh", background: "#525659", borderBottom: "1px solid var(--border)" }}>
                    {/* Same header as the doc-preview modal: title + X. */}
                    <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
                      style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
                      <div className="min-w-0 flex-1 mr-3">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-0.5" style={{ color: "var(--w3)" }}>{previewDoc!.file_type}</p>
                        <p className="text-[13.5px] font-semibold truncate tracking-tight" style={{ color: "var(--w)" }}>{previewDoc!.file_name}</p>
                      </div>
                      {/* Phone: the ONLY close button — dismisses BOTH the
                          passport strip AND the data card (the data header's
                          own X is hidden on phone to avoid a duplicate). */}
                      <button onClick={() => { setPreviewDoc(null); setShowPassportInfo(false); setPassportInfoEditMode(false); setPassportInfoEdits({}); }}
                        className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ color: "var(--w3)" }}>
                        <XIcon size={14} strokeWidth={1.8} />
                      </button>
                    </div>
                    {/* Opens INSTANTLY with a spinner; the PDF fills in place
                        once the blob loads — same model as the admin laptop. */}
                    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                      {!ppStripUrl ? (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#525659" }}>
                          <Spinner size="md" />
                        </div>
                      ) : /\.pdf$/i.test(previewDoc?.file_name ?? "") ? (
                        // iOS: pdf.js canvas is blank in WebKit → native iframe
                        // straight from the server route (token in query).
                        isIOSDevice() && previewDoc?.drive_file_id ? (
                          <IosPdfFrame
                            src={`/api/portal/file?id=${encodeURIComponent(previewDoc.drive_file_id)}&access_token=${encodeURIComponent(accessToken)}`}
                            title={previewDoc?.file_name}
                          />
                        ) : (
                          <PdfViewer src={ppStripUrl} />
                        )
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ppStripUrl} alt="passport"
                          style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      )}
                    </div>
                  </div>
                )}

                {/* ── Header ── */}
                <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
                  style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] inline-flex items-center gap-1.5" style={{ color: "var(--gold)" }}>
                      <IdCard size={12} strokeWidth={1.8} /> {lang === "fr" ? "Données du passeport" : lang === "de" ? "Reisepassdaten" : "Passport data"}
                    </p>
                    {/* Status badge — hidden when approved */}
                    {pst !== "approved" && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold tracking-wide uppercase"
                        style={{ background: pstBg, color: pstColor, border: `1px solid ${pstBdr}` }}>
                        {pst === "rejected" ? <XCircle size={11} strokeWidth={2} />
                          : pst === "pending"  ? <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
                          : null}
                        {pstLabel}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Edit toggle */}
                    {p_info && (
                      <button
                        onClick={() => {
                          if (passportInfoEditMode) {
                            setPassportInfoEditMode(false); setPassportInfoEdits({});
                          } else {
                            setPassportInfoEditMode(true); setPassportInfoEdits({});
                          }
                        }}
                        className="h-7 px-2 rounded-lg flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                        style={{ background: passportInfoEditMode ? "var(--info-bg)" : "var(--bg2)", color: passportInfoEditMode ? "var(--info)" : "var(--w3)", border: `1px solid ${passportInfoEditMode ? "var(--info-border)" : "var(--border)"}` }}>
                        <FilePen size={11} strokeWidth={1.8} /> {passportInfoEditMode ? "Editing" : "Edit"}
                      </button>
                    )}
                    {/* Approved: minimalist download icon next to X — mirrors
                        the passport PDF header. Replaces the old big footer
                        "Download data PDF" button. */}
                    {pst === "approved" && (
                      <button
                        onClick={async () => {
                          if (!selectedUser) return;
                          if (isIOSDevice()) flushSync(() => setPassportDataPdfDl(true));
                          else setPassportDataPdfDl(true);
                          try {
                            const cp = profiles[selectedUser];
                            const docTitle = lang==="fr" ? "Données du passeport" : lang==="de" ? "Reispassdaten" : "Passport Data";
                            const docSubtitle = lang==="fr" ? "Informations de passeport extraites et confirmées" : lang==="de" ? "Extrahierte und bestätigte Reisepassdaten" : "Extracted and confirmed passport information";
                            // Name EXACTLY like the passport file (German:
                            // firstname_lastname_pflegekraft_reisepass) + "_daten".
                            const passDoc = docs
                              .filter(d => d.user_id === selectedUser && /pass/i.test(d.file_type) && !!d.drive_file_id && !/dat(en|a)/i.test(d.file_name))
                              .sort((a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""))[0];
                            const slug = (s?: string | null) => (s ?? "").trim().toLowerCase()
                              .replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")
                              .normalize("NFKD").replace(/[̀-ͯ]/g, "")
                              .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
                            const base = passDoc?.file_name
                              ? passDoc.file_name.replace(/\.[^.]+$/, "")
                              : `${slug(cp?.first_name)}_${slug(cp?.last_name)}_pflegekraft_reisepass`;
                            const outName = `${base}_daten.pdf`;

                            // iOS can't download a client blob — stream via
                            // GET (small payload in query), in-gesture anchor.
                            if (isIOSDevice() && accessToken) {
                              const json = JSON.stringify({ groups: passportDisplayGroups, docTitle, docSubtitle, filename: outName });
                              const b64 = btoa(unescape(encodeURIComponent(json)))
                                .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
                              triggerIosDownload(
                                `/api/portal/admin/passport-data-pdf?dl=1&d=${b64}&access_token=${encodeURIComponent(accessToken)}`,
                                outName,
                                () => setPassportDataPdfDl(false),
                              );
                              return;
                            }

                            const res = await fetch("/api/portal/admin/passport-data-pdf", {
                              method: "POST",
                              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                              body: JSON.stringify({ groups: passportDisplayGroups, filename: outName, docTitle, docSubtitle }),
                            });
                            if (!res.ok) throw new Error("Failed");
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url; a.download = outName; a.click(); URL.revokeObjectURL(url);
                          } catch (e) { console.error(e); }
                          setPassportDataPdfDl(false);
                        }}
                        disabled={passportDataPdfDl}
                        aria-label={lang==="fr" ? "Télécharger les données" : lang==="de" ? "Daten herunterladen" : "Download data"}
                        title={lang==="fr" ? "Télécharger les données" : lang==="de" ? "Daten herunterladen" : "Download data"}
                        className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40"
                        style={{ color: "var(--w2)" }}>
                        {passportDataPdfDl
                          ? <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                          : <Download size={14} strokeWidth={1.8} />}
                      </button>
                    )}
                    <button onClick={() => { setShowPassportInfo(false); setPassportInfoEditMode(false); setPassportInfoEdits({}); }}
                      className={`bv-icon-btn w-8 h-8 rounded-full ${isVerificationPhase ? "hidden sm:flex" : "flex"} items-center justify-center flex-shrink-0`}
                      style={{ color: "var(--w3)" }}>
                      <XIcon size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>

                {/* ── Fields / empty state ── */}
                <div className="overflow-y-auto flex-1 px-5 py-4 bv-pp-fields">
                  {!p_info ? (
                    <div className="py-10 text-center">
                      <span className="mx-auto mb-4 flex items-center justify-center w-12 h-12 rounded-full"
                        style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)", color: "var(--gold)" }}>
                        <IdCard size={22} strokeWidth={1.6} />
                      </span>
                      <p className="text-sm font-medium" style={{ color: "var(--w2)" }}>{lang === "fr" ? "Pas encore de données de passeport" : lang === "de" ? "Noch keine Reisepassdaten" : "No passport data yet"}</p>
                      <p className="text-xs mt-1" style={{ color: "var(--w3)" }}>{lang === "fr" ? "Les données apparaîtront une fois que le candidat aura confirmé ses informations." : lang === "de" ? "Daten erscheinen, sobald der Kandidat seine Reisepassdaten bestätigt hat." : "Data will appear once the candidate confirms their passport details"}</p>
                    </div>
                  ) : passportInfoEditMode ? (
                    /* ── Edit mode ── */
                    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                      {modalFields.map(f => (
                        <div key={f.key} className={f.full ? "col-span-2" : ""}>
                          <label className="text-[10px] font-medium mb-1 block" style={{ color: "var(--w3)" }}>{f.label}</label>
                          {f.type === "country" ? (
                            <select
                              value={toIsoCodeAdmin(fieldVal(f.key))}
                              onChange={e => setPassportInfoEdits(prev => ({ ...prev, [f.key]: e.target.value || null }))}
                              className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
                              style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }}>
                              <option value="">—</option>
                              {Object.entries(NAT_MAP).map(([code, names]) => (
                                <option key={code} value={code}>{names[lang]}</option>
                              ))}
                            </select>
                          ) : f.type === "select" ? (
                            <select
                              value={fieldVal(f.key)}
                              onChange={e => setPassportInfoEdits(prev => ({ ...prev, [f.key]: e.target.value || null }))}
                              className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
                              style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }}>
                              <option value="">—</option>
                              <option value="M">{lang==="fr"?"Masculin":lang==="de"?"Männlich":"Male"}</option>
                              <option value="F">{lang==="fr"?"Féminin":lang==="de"?"Weiblich":"Female"}</option>
                            </select>
                          ) : f.type === "date" ? (
                            (() => {
                              const raw = fieldVal(f.key).slice(0, 10);
                              const deM = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
                              const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw
                                : (deM ? `${deM[3]}-${deM[2]}-${deM[1]}` : "");
                              const ger = iso ? `${iso.slice(8,10)}.${iso.slice(5,7)}.${iso.slice(0,4)}` : "";
                              return (
                                <div className="relative">
                                  {/* Visible German DD.MM.YYYY; transparent
                                      native date input on top = calendar. */}
                                  <input readOnly value={ger} placeholder="TT.MM.JJJJ"
                                    className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none cursor-pointer"
                                    style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }} />
                                  <input type="date" value={iso}
                                    onClick={e => { const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void }; el.showPicker?.(); }}
                                    onWheel={e => {
                                      e.preventDefault();
                                      const isoCur = iso || `${new Date().getFullYear()}-01-01`;
                                      const y = parseInt(isoCur.slice(0, 4), 10) + (e.deltaY < 0 ? 1 : -1);
                                      if (y < 1900 || y > 2100) return;
                                      setPassportInfoEdits(prev => ({ ...prev, [f.key]: `${y}-${isoCur.slice(5,7)}-${isoCur.slice(8,10)}` }));
                                    }}
                                    onChange={e => setPassportInfoEdits(prev => ({ ...prev, [f.key]: e.target.value || null }))}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    style={{ colorScheme: "dark" }}
                                    aria-label={f.label} />
                                </div>
                              );
                            })()
                          ) : (
                            <input
                              type={f.type ?? "text"}
                              value={fieldVal(f.key)}
                              onChange={e => setPassportInfoEdits(prev => ({ ...prev, [f.key]: e.target.value || null }))}
                              className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
                              style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* ── Read-only mode — uses pre-computed passportDisplayGroups ── */
                    <>
                    {pst !== "approved" && (
                      <div className="mb-3 px-1 space-y-1">
                        <p className="text-[10px]" style={{ color: "var(--warning)" }}>
                          {lang === "fr" ? "Comparez chaque champ avec le document passeport." : lang === "de" ? "Vergleichen Sie jedes Feld mit dem Reisepassdokument." : "Compare each field against the passport document."}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <rect x="1" y="1" width="14" height="14" rx="3" stroke="var(--warning)" strokeWidth="1.5"/>
                          </svg>
                          <span style={{ color: "#aaa", fontSize: 9 }}>→</span>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <rect width="16" height="16" rx="3.5" fill="var(--success)"/>
                            <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <p className="text-[10px]" style={{ color: "var(--warning)" }}>
                            {lang === "fr" ? "Cochez toutes les cases pour confirmer, puis Approuver." : lang === "de" ? "Aktivieren Sie alle Kästchen zur Bestätigung, dann Genehmigen." : "Tick every box to confirm, then Approve."}
                          </p>
                        </div>
                      </div>
                    )}
                    {passportDisplayGroups.map((group, gi) => (
                      <div key={group.title} className={gi > 0 ? "mt-4" : ""}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--w3)" }}>{group.title}</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                          {group.fields.map(f => {
                            if (pst === "approved") {
                              return (
                                <div key={f.label} className="min-w-0">
                                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] mb-0.5" style={{ color: "var(--w3)" }}>{f.label}</p>
                                  <p className="text-[12.5px] font-medium" style={{ color: "var(--w)" }}>{f.value}</p>
                                </div>
                              );
                            }
                            // Per-field review checkbox — empty/orange/green
                            const filled = !!(f.value && f.value !== "—" && f.value.trim() !== "");
                            const fieldKey = f.label;
                            const confirmed = adminConfirmedFields.has(fieldKey);
                            return (
                              <div key={f.label} className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] font-medium" style={{ color: "var(--w3)" }}>{f.label}</p>
                                  <p className="text-xs font-semibold" style={{ color: "warn" in f && f.warn ? "var(--danger)" : "var(--w)" }}>
                                    {f.value}{"warn" in f && f.warn ? <AlertTriangle size={11} strokeWidth={1.8} className="inline ml-1 -mt-0.5" /> : ""}
                                  </p>
                                </div>
                                {/* Confirm checkbox — sibling on the RIGHT, big
                                    tap target, never overlaps the value. Same
                                    design + placement as the candidate side. */}
                                <button type="button"
                                  onClick={() => {
                                    if (!filled) return;
                                    setAdminConfirmedFields(prev => {
                                      const n = new Set(prev);
                                      if (n.has(fieldKey)) n.delete(fieldKey); else n.add(fieldKey);
                                      return n;
                                    });
                                  }}
                                  title={!filled ? "" : confirmed ? "Reviewed — click to undo" : "Click to mark as reviewed"}
                                  className="flex-shrink-0 grid place-items-center w-9 h-9 -my-1 transition-all"
                                  style={{ cursor: filled ? "pointer" : "default" }}>
                                  {!filled ? (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                      <rect x="1" y="1" width="14" height="14" rx="3" stroke="var(--border2)" strokeWidth="1.5"/>
                                    </svg>
                                  ) : confirmed ? (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                      <rect width="16" height="16" rx="3.5" fill="var(--success)"/>
                                      <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  ) : (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                      <rect x="1" y="1" width="14" height="14" rx="3" stroke="var(--warning)" strokeWidth="1.5"/>
                                      <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="var(--warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.35"/>
                                    </svg>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        {gi < passportDisplayGroups.length - 1 && <div className="mt-3" style={{ height: 1, background: "var(--border)" }} />}
                      </div>
                    ))}
                    </>
                  )}
                </div>

                {/* ── Footer: approve / reject / save ── */}
                {p_info && (
                  <div className="px-5 pb-4 pt-3 flex-shrink-0 flex flex-col gap-2"
                    style={{ borderTop: "1px solid var(--border)" }}>
                  {/* Manual "Verify" pill removed — granting/revoking the gold
                      tick now lives ONLY in the supreme-admin Users panel. */}
                  <div className="flex items-center gap-2">
                    {passportInfoEditMode ? (
                      <>
                        <button
                          onClick={savePassportInfo}
                          disabled={passportInfoSaving || Object.keys(passportInfoEdits).length === 0}
                          className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                          style={{ background: "var(--info-bg)", color: "var(--info)" }}>
                          {passportInfoSaving ? "Saving…" : <><Save size={12} strokeWidth={1.8} /> Save changes</>}
                        </button>
                        <button
                          onClick={() => { setPassportInfoEditMode(false); setPassportInfoEdits({}); }}
                          className="bv-row-hover py-2 px-3 text-xs"
                          style={{ color: "var(--w3)" }}>
                          Cancel
                        </button>
                      </>
                    ) : pst !== "approved" ? (
                      <>
                        <button
                          onClick={() => reviewPassport("approved")}
                          disabled={passportInfoSaving || !allFilledConfirmed}
                          title={!allFilledConfirmed ? `${unconfirmedCount} field${unconfirmedCount !== 1 ? "s" : ""} not yet reviewed` : ""}
                          className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                          style={{ background: "var(--success-bg)", color: "var(--success)" }}>
                          {passportInfoSaving ? "…" : <><CheckCircle2 size={13} strokeWidth={1.8} /> Approve</>}
                        </button>
                        <button
                          onClick={() => reviewPassport("rejected")}
                          disabled={passportInfoSaving || pst === "rejected"}
                          className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                          style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
                          {passportInfoSaving ? "…" : <><XCircle size={13} strokeWidth={1.8} /> Reject</>}
                        </button>
                      </>
                    ) : null /* approved: download moved to header icon */}
                  </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
          <PortalTopNav />
          <div className="max-w-[780px] mx-auto px-4 pt-8 pb-16">

            {/* ── Back + premium candidate header ──
                Top-of-detail hero: round photo (or initial) on the left, name
                + email centered, status pills + actions clustered on the
                right. Sits on a CV-builder-style card surface (20px rounded,
                soft 1px shadow). */}
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => { setSelectedUser(null); }}
                aria-label={lang === "de" ? "Zurück" : lang === "fr" ? "Retour" : "Back"}
                className="bv-icon-btn w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ color: "var(--w2)" }}>
                <ArrowLeft size={15} strokeWidth={1.8} />
              </button>
              <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                {(() => {
                  const historyForUser = docHistory.filter(d => d.user_id === selectedUser);
                  if (historyForUser.length === 0) return null;
                  return (
                    <button onClick={() => setShowHistory(v => !v)}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-80"
                      style={{ background: showHistory ? "var(--gdim)" : "var(--bg2)", color: showHistory ? "var(--gold)" : "var(--w3)", border: `1px solid ${showHistory ? "var(--border-gold)" : "var(--border)"}` }}>
                      <Folder size={11} strokeWidth={1.8} /> {historyForUser.length} {lang === "de" ? "alt" : lang === "fr" ? "anciens" : "old"}
                    </button>
                  );
                })()}
              </div>
            </div>

            <div className="mb-8 px-5 py-5 flex items-center gap-4 flex-wrap"
              style={{
                background: "var(--card)",
                borderRadius: "20px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}>
              {/* Photo or initial — same circular avatar language as the public profile */}
              {(() => {
                const photo = selectedUser ? profiles[selectedUser]?.profile_photo : null;
                if (photo) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt={user.name}
                      className="w-14 h-14 rounded-full object-cover flex-shrink-0"
                      style={{ border: "1px solid var(--border-gold)" }} />
                  );
                }
                return (
                  <div className="w-14 h-14 rounded-full flex items-center justify-center text-[18px] font-bold flex-shrink-0"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                );
              })()}
              <div className="flex-1 min-w-0">
                <h1 className="text-[20px] font-semibold tracking-[-0.015em] inline-flex items-center gap-1.5 flex-wrap max-w-full" style={{ color: "var(--w)" }}>
                  <span className="truncate">{user.name}</span>
                  <VerifiedBadge verified={!!profiles[selectedUser]?.manually_verified} size="sm" color="gold" />
                  {/* Org tags inline next to the gold tick — minimalist, no × */}
                  {(candidateOrgs[selectedUser] ?? []).map(org => (
                    <span key={org.id}
                      className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full align-middle"
                      style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
                      </svg>
                      {org.name}
                    </span>
                  ))}
                </h1>
                <p className="text-[12.5px] mt-1 truncate" style={{ color: "var(--w3)" }}>{user.email}</p>
              </div>
            </div>


            {/* Always two-column: sidebar + content */}
            <div className="flex gap-4 sm:gap-6 items-start">

              {/* Sidebar — doc phases + journey stages */}
              <aside className="shrink-0 w-[44px] sm:w-[52px]"
                style={{ position: "sticky", top: "calc(61px + 1.5rem)" }}>

                {/* Doc phase circles — blue only on active, plain otherwise */}
                {PHASE_ITEMS.map((ph, i) => {
                  const isActive   = i === activePhase && !activePipelineStage;
                  const pendingCnt = ph.items.reduce((n, item) => {
                    let cnt = getAdminDocs(item.key).filter(d => d.status === "pending").length;
                    if (item.transKey) cnt += getAdminDocs(item.transKey).filter(d => d.status === "pending").length;
                    return n + cnt;
                  }, 0);

                  return (
                    <div key={i} className="flex flex-col items-center">
                      <button onClick={() => { setActivePhase(i); setActivePipelineStage(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                        title={ph.title}
                        className="bv-lift-hover w-full flex flex-col items-center gap-1 py-1 cursor-pointer">
                        <span className="relative flex items-center justify-center w-8 h-8 rounded-full leading-none select-none transition-all duration-300"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: isActive ? "var(--gold)" : "var(--w3)",
                            transform: isActive ? "scale(1.08)" : "scale(1)",
                            transition: "color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease)",
                          }}>
                          <PhaseIcon kind={ph.kind} size={14} />
                        </span>
                        <span className="text-[8px] text-center leading-tight font-medium px-0.5 w-full"
                          style={{ color: isActive ? "var(--gold)" : "var(--w3)" }}>{ph.shortTitle}</span>
                      </button>
                      <div className="w-px" style={{ height: 18, background: "var(--border)" }} />
                    </div>
                  );
                })}

                {/* Journey stage icons — click to show that stage on the right */}
                {([
                  { key: "interview",   kind: "interview"   as PhaseKind, label: "Gespräch",    active: pipeline.docs_approved },
                  { key: "recognition", kind: "recognition" as PhaseKind, label: "Bearbeitung", active: pipeline.recognition_unlocked },
                  { key: "visum",       kind: "embassy"     as PhaseKind, label: "Visum",       active: pipeline.embassy_unlocked },
                  { key: "reise",       kind: "flight"      as PhaseKind, label: "Reise",       active: !!pipeline.flight_date },
                  { key: "integration", kind: "integration" as PhaseKind, label: "Integration", active: pipeline.integration_unlocked },
                  { key: "start",       kind: "start"       as PhaseKind, label: "Start",       active: pipeline.start_unlocked },
                ]).map((js, ji, arr) => {
                  const isSel = activePipelineStage === js.key;
                  return (
                    <div key={js.label} className="flex flex-col items-center">
                      <button
                        onClick={() => {
                          const next = isSel ? null : js.key;
                          setActivePipelineStage(next);
                          if (next === "recognition") loadPhaseSlots("bearbeitung");
                          if (next === "visum") loadPhaseSlots("visum");
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        title={js.label}
                        className="bv-lift-hover w-full flex flex-col items-center gap-1 py-1 cursor-pointer"
                        style={{ background: "transparent", border: "none" }}>
                        <span className="relative flex items-center justify-center w-8 h-8 rounded-full leading-none select-none transition-all duration-300"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: isSel ? "var(--gold)" : "var(--w3)",
                            transform: isSel ? "scale(1.08)" : "scale(1)",
                            transition: "color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease)",
                          }}>
                          <PhaseIcon kind={js.kind} size={13} />
                          {!js.active && (
                            <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full"
                              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                              <Lock size={7} strokeWidth={2.2} style={{ color: "var(--w3)" }} />
                            </span>
                          )}
                        </span>
                        <span className="text-[8px] text-center leading-tight font-medium"
                          style={{ color: isSel ? "var(--gold)" : "var(--w3)" }}>
                          {js.label}
                        </span>
                      </button>
                      {ji < arr.length - 1 && <div className="w-px" style={{ height: 14, background: "var(--border)" }} />}
                    </div>
                  );
                })}
              </aside>

              {/* Main content — doc phase or pipeline stage */}
              <div className="flex-1 min-w-0">
                {activePipelineStage ? (
                  <div key={activePipelineStage} className="bv-enter">
                    {activePipelineStage === "interview" && (
                      <div className="overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
                        <div className="flex items-center gap-3 px-4 py-3.5">
                          <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-md)" }}>
                            <PhaseIcon kind="interview" size={16} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{t.pJourneyInterview}</p>
                            <p className="text-[11.5px] mt-0.5 inline-flex items-center gap-1" style={{ color: pipeline.interview_status === "passed" ? "var(--success)" : pipeline.interview_status === "failed" ? "var(--danger)" : pipeline.interview_link ? "var(--gold)" : "var(--w3)" }}>
                              {pipeline.interview_status === "passed" ? <><CheckCircle2 size={11} strokeWidth={2} /> {t.aInterviewPassedLabel}</>
                                : pipeline.interview_status === "failed" ? <><XCircle size={11} strokeWidth={2} /> {t.aInterviewFailedLabel}</>
                                : pipeline.interview_link ? t.aInterviewScheduled : t.aInterviewNotScheduled}
                            </p>
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0">
                            {(["passed","failed","pending"] as const).map(s => (
                              <button key={s} onClick={() => savePipelineField({ interview_status: s })}
                                title={s} aria-label={s}
                                className="w-7 h-7 flex items-center justify-center font-semibold transition-all"
                                style={{ background: pipeline.interview_status === s ? s === "passed" ? "var(--success-border)" : s === "failed" ? "var(--danger-bg)" : "var(--gdim)" : "var(--bg2)", color: pipeline.interview_status === s ? s === "passed" ? "var(--success)" : s === "failed" ? "var(--danger)" : "var(--gold)" : "var(--w3)", border: `1px solid ${pipeline.interview_status === s ? s === "passed" ? "var(--success-border)" : s === "failed" ? "var(--danger-bg)" : "var(--border-gold)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                                {s === "passed" ? <CheckCircle2 size={13} strokeWidth={1.8} /> : s === "failed" ? <XCircle size={13} strokeWidth={1.8} /> : <RotateCcw size={12} strokeWidth={1.8} />}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="px-4 pb-3.5 pt-2 space-y-2.5" style={{ borderTop: "1px solid var(--border)" }}>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>{t.aInterviewLink}</label>
                              <input type="url" value={pipeline.interview_link} onChange={e => setPipeline(p => ({ ...p, interview_link: e.target.value }))} onBlur={e => savePipelineField({ interview_link: e.target.value })} placeholder="https://meet.google.com/..." className="w-full px-2.5 py-2 text-[11.5px] outline-none transition-colors" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "var(--r-sm)" }} />
                            </div>
                            <div>
                              <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>{t.aInterviewDate}</label>
                              <input type="datetime-local" value={pipeline.interview_date} onChange={e => setPipeline(p => ({ ...p, interview_date: e.target.value }))} onBlur={e => savePipelineField({ interview_date: e.target.value })} className="w-full px-2.5 py-2 text-[11.5px] outline-none transition-colors" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "var(--r-sm)" }} />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>{t.aInterviewType}</label>
                            <div className="flex gap-2">
                              {(["video", "phone", "in-person"] as const).map(tp => (
                                <button key={tp} type="button" onClick={() => savePipelineField({ interview_type: pipeline.interview_type === tp ? "" : tp })}
                                  className="flex-1 py-1.5 text-[11px] font-medium transition-all"
                                  style={{ background: pipeline.interview_type === tp ? "var(--gdim)" : "var(--bg2)", color: pipeline.interview_type === tp ? "var(--gold)" : "var(--w3)", border: `1px solid ${pipeline.interview_type === tp ? "var(--border-gold)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                                  {tp === "video" ? t.aInterviewTypeVideo : tp === "phone" ? t.aInterviewTypePhone : t.aInterviewTypeInPerson}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>{t.aInterviewNotes}</label>
                            <textarea value={pipeline.interview_notes} onChange={e => setPipeline(p => ({ ...p, interview_notes: e.target.value }))} onBlur={e => savePipelineField({ interview_notes: e.target.value })} placeholder={t.aInterviewNotesPlaceholder} rows={3} className="w-full px-2.5 py-2 text-[11.5px] outline-none transition-colors resize-none" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "var(--r-sm)" }} />
                          </div>
                        </div>
                      </div>
                    )}
                    {activePipelineStage === "reise" && (
                      <div className="overflow-hidden" style={{ background: "var(--card)", border: `1px solid ${pipeline.flight_date ? "var(--border-gold)" : "var(--border)"}`, borderRadius: "var(--r-lg)" }}>
                        <div className="px-4 py-3.5 grid grid-cols-2 gap-2.5">
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>{t.aFlightDate}</label>
                            <input type="date" value={pipeline.flight_date} onChange={e => setPipeline(p => ({ ...p, flight_date: e.target.value }))} onBlur={e => savePipelineField({ flight_date: e.target.value })} className="w-full px-2.5 py-2 text-[11.5px] outline-none transition-colors" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "var(--r-sm)" }} />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>{t.aFlightInfo}</label>
                            <input type="text" value={pipeline.flight_info} onChange={e => setPipeline(p => ({ ...p, flight_info: e.target.value }))} onBlur={e => savePipelineField({ flight_info: e.target.value })} placeholder="e.g. RAM 704, CDG → FRA" className="w-full px-2.5 py-2 text-[11.5px] outline-none transition-colors" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "var(--r-sm)" }} />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Dynamic slot management — Bearbeitung / Visum ─────────────────── */}
                    {(activePipelineStage === "recognition" || activePipelineStage === "visum") && (() => {
                      const slotPhase = activePipelineStage === "recognition" ? "bearbeitung" : "visum";
                      const slots = (phaseSlots[slotPhase] ?? []).filter((s): s is PhaseSlot => s != null && !!s.id);
                      return (
                        <div className="mt-4" style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                          <div className="px-2 py-2">
                          {/* Slot rows */}
                          {slots.length === 0 ? (
                            <div className="px-3 py-5 text-center">
                              <p className="text-[11px]" style={{ color: "var(--w3)" }}>No document slots — click <span style={{ color: "var(--gold)", fontWeight: 600 }}>+</span> to add one.</p>
                            </div>
                          ) : (
                            <DndContext
                              sensors={slotSensors}
                              collisionDetection={closestCenter}
                              onDragEnd={async (event: DragEndEvent) => {
                                const { active, over } = event;
                                if (!over || active.id === over.id) return;
                                const oldIdx = slots.findIndex(s => s.id === active.id);
                                const newIdx = slots.findIndex(s => s.id === over.id);
                                if (oldIdx === -1 || newIdx === -1) return;
                                const reordered = arrayMove(slots, oldIdx, newIdx).map((s, i) => ({ ...s, position: i }));
                                setPhaseSlots(prev => ({ ...prev, [slotPhase]: reordered }));
                                await saveSlotOrder(slotPhase, reordered.map(s => ({ id: s.id, position: s.position })));
                              }}
                            >
                            <SortableContext items={slots.map(s => s.id)} strategy={verticalListSortingStrategy}>
                            <div>
                              {slots.map((slot, si) => {
                                const origDocs = getAdminDocs(slot.id);
                                const transDocs = slot.type === "dual" ? getAdminDocs(slot.id + "_de") : [];
                                const allSlotDocs = [...origDocs, ...transDocs];

                                if (slot.type === "simple") {
                                  const doc = origDocs[0] ?? null;
                                  const submitted = !!doc;
                                  // LAW #15 lifecycle. Distinguish admin's template upload
                                  // (uploaded_by_admin=true, auto-approved at insert) from
                                  // the candidate's actual submission. When admin has
                                  // configured candidate actions and only the template
                                  // exists, we're still WAITING the candidate → ORANGE.
                                  const hasCandidateActions = slot.candidate_signs || slot.candidate_fills;
                                  const candidateSubmitted = submitted && !doc!.uploaded_by_admin;
                                  const awaitingCandidate = hasCandidateActions && !candidateSubmitted;
                                  const rowSt = candidateSubmitted
                                    ? (doc!.status === "approved" ? "approved"
                                       : doc!.status === "rejected" ? "rejected" : "pending")
                                    : awaitingCandidate ? "pending"
                                    : submitted ? "approved"  // admin-uploaded, no candidate action expected
                                    : null;
                                  const rowColor = rowSt === "approved" ? "#16a34a"
                                    : rowSt === "rejected" ? "#ef4444"
                                    : rowSt === "pending" ? "#f59e0b" : null;
                                  const rowClickable = submitted && !!doc?.drive_file_id;
                                  const menuId = doc?.id ?? slot.id;
                                  return (
                                    <SortableSlotItem key={slot.id} id={slot.id}>
                                      {si > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                                      <div
                                        onClick={rowClickable ? () => setPreviewDoc(doc!) : undefined}
                                        // Silent drag-and-drop — admin can drop a PDF onto the row
                                        // (Bearbeitung / Visum) and it uploads as if they clicked
                                        // the Upload button. No visual indicator on drag-over.
                                        onDragOver={e => { if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); }}
                                        onDrop={e => {
                                          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                                          e.preventDefault();
                                          const file = e.dataTransfer.files?.[0];
                                          if (file && file.type === "application/pdf") adminUploadFile(file, slot.id);
                                        }}
                                        className={`px-3 py-3 transition-colors${rowClickable ? " bv-row-hover cursor-pointer" : ""}`}
                                        style={{ minHeight: 60, ...(revokeMenu?.id === menuId ? { position: "relative", zIndex: 10 } : {}) }}>
                                        <div className="flex items-center gap-3">
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <p className="text-[11.5px] font-medium tracking-tight" style={{ color: rowColor ?? "var(--w)" }}>{slot.label}</p>
                                              {(slot.candidate_signs || slot.candidate_fills) && (
                                                <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0"
                                                  style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                                                  {slot.candidate_signs && slot.candidate_fills ? "Sign + Fill" : slot.candidate_signs ? "Sign" : "Fill fields"}
                                                </span>
                                              )}
                                            </div>
                                            {slot.instructions && (
                                              <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: "var(--w3)" }}>{slot.instructions}</p>
                                            )}
                                            {!submitted && <p className="text-[10px] mt-0.5" style={{ color: "var(--w3)" }}>Not submitted yet</p>}
                                            {doc && doc.status === "rejected" && doc.feedback && (
                                              <p className="text-[11px] mt-1" style={{ color: "var(--danger)" }}>{doc.feedback}</p>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1.5 flex-shrink-0"
                                            onClick={e => e.stopPropagation()}
                                            onMouseDown={e => e.stopPropagation()}>
                                            {/* Admin upload spinner — shows for the FULL upload pipeline
                                                (Drive + slot-template + state updates + popup open).
                                                Without this top-level guard, `submitted` flips true after
                                                Drive completes mid-pipeline and the spinner vanishes for
                                                ~3s until the popup pops, leaving the admin staring at a
                                                static row wondering if anything's happening. */}
                                            {adminUploadSlotId === slot.id ? (
                                              <span className="w-9 h-9 flex flex-col items-center justify-center gap-0.5">
                                                <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" style={{ color: "var(--w3)" }} />
                                                <span className="text-[8px] font-semibold tabular-nums" style={{ color: "var(--w3)" }}>{Math.round(adminSlotProgress)}%</span>
                                              </span>
                                            ) : (!submitted && (
                                              <button type="button"
                                                onClick={e => { e.stopPropagation(); openAdminUploadPicker(slot.id); }}
                                                className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                                style={{ color: "var(--w3)" }}>
                                                <Upload size={13} strokeWidth={1.8} />
                                              </button>
                                            ))}
                                            {doc?.drive_file_id && (
                                              <button type="button"
                                                onClick={e => { e.stopPropagation(); downloadDoc(doc!); }}
                                                className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                                style={{ color: "var(--w2)" }}>
                                                <Download size={13} strokeWidth={1.8} />
                                              </button>
                                            )}
                                            {rowSt === "pending" && doc && !doc.uploaded_by_admin && (
                                              <>
                                                <button type="button"
                                                  onClick={e => { e.stopPropagation(); openRejectModal({ kind: "doc", docId: doc!.id, label: slot.label, initialFeedback: doc!.feedback ?? "" }); }}
                                                  disabled={saving[doc!.id]}
                                                  className="bv-icon-btn bv-icon-btn--reject w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40">
                                                  <XCircle size={15} strokeWidth={1.8} />
                                                </button>
                                                <button type="button"
                                                  onClick={e => { e.stopPropagation(); review(doc!.id, "approved"); }}
                                                  disabled={saving[doc!.id]}
                                                  className="bv-icon-btn bv-icon-btn--approve w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40">
                                                  <CheckCircle2 size={15} strokeWidth={1.8} />
                                                </button>
                                              </>
                                            )}
                                            <div className="relative flex-shrink-0">
                                              <button
                                                onClick={e => { e.stopPropagation(); setRevokeMenu(prev => prev?.id === menuId ? null : { id: menuId, el: e.currentTarget as HTMLElement }); }}
                                                className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                                style={{ color: "var(--w2)" }}>
                                                <MoreHorizontal size={14} strokeWidth={1.8} />
                                              </button>
                                              <DropdownMenu open={revokeMenu?.id === menuId} onClose={() => setRevokeMenu(null)} anchor={revokeMenu?.id === menuId ? revokeMenu.el : null}>
                                                    <button
                                                      onClick={e => { e.stopPropagation(); setRevokeMenu(null); setSlotConfigPopup({ slotId: slot.id, admin_signs: slot.admin_signs, candidate_signs: slot.candidate_signs, admin_fills: slot.admin_fills, candidate_fills: slot.candidate_fills, pdf_has_native_fields: !!slot.pdf_has_native_fields }); }}
                                                      className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                      style={{ color: "var(--gold)" }}>
                                                      <Zap size={11} strokeWidth={1.8} /> Action
                                                    </button>
                                                    <button
                                                      onClick={e => { e.stopPropagation(); setRevokeMenu(null); setEditingSlotId(slot.id); setEditingSlotLabel(slot.label); setEditingSlotLabelTrans(""); setEditingSlotInstructions(slot.instructions ?? ""); }}
                                                      className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                      style={{ color: "var(--w)" }}>
                                                      <FilePen size={11} strokeWidth={1.8} /> Edit label
                                                    </button>
                                                    {/* "Configure fields" item removed: form-field drawing no longer supported. */}
                                                    {rowSt === "approved" && (
                                                      <button
                                                        onClick={e => { e.stopPropagation(); setRevokeMenu(null); openRejectModal({ kind: "doc", docId: doc!.id, label: slot.label, initialFeedback: doc!.feedback ?? "" }); }}
                                                        disabled={saving[doc!.id]}
                                                        className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                                        style={{ color: "var(--danger)" }}>
                                                        <RotateCcw size={11} strokeWidth={1.8} /> Revoke
                                                      </button>
                                                    )}
                                                    <button
                                                      onClick={e => { e.stopPropagation(); setRevokeMenu(null); deletePhaseSlot(slot.id, slotPhase); }}
                                                      className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                      style={{ color: "var(--danger)" }}>
                                                      <Trash2 size={11} strokeWidth={1.8} /> Delete slot
                                                    </button>
                                              </DropdownMenu>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </SortableSlotItem>
                                  );
                                }

                                // DUAL slot
                                const hasRej = allSlotDocs.some(d => d.status === "rejected");
                                const hasApp = allSlotDocs.length > 0 && allSlotDocs.every(d => d.status === "approved");
                                const hasPend = allSlotDocs.some(d => d.status === "pending");
                                const dualColor = hasRej ? "var(--danger)" : hasApp ? "#16a34a" : hasPend ? "#f59e0b" : null;
                                const slotSubRows = [
                                  { subKey: slot.id,           subLabel: slot.label,                      subDoc: origDocs[0]  ?? null },
                                  { subKey: slot.id + "_de",   subLabel: slot.label_trans ?? "Translated", subDoc: transDocs[0] ?? null },
                                ];
                                const canDualMerge = !!(origDocs[0]?.drive_file_id && transDocs[0]?.drive_file_id);
                                const isDualExpanded = expandedDualSlots.has(slot.id);
                                const isDualMergeDl = mergePdfDl.has(slot.id);
                                const isDualMenuOpen = revokeMenu?.id === slot.id ||
                                  (origDocs[0] && revokeMenu?.id === origDocs[0].id) ||
                                  (transDocs[0] && revokeMenu?.id === transDocs[0].id);
                                return (
                                  <SortableSlotItem key={slot.id} id={slot.id}>
                                    {si > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                                    {/* Dual header — click to preview merged PDF when both docs ready.
                                        Silent drag-and-drop: drop a PDF here to upload to the primary slot. */}
                                    <div
                                      className={`px-3 py-3 flex items-center gap-2${canDualMerge ? " cursor-pointer bv-row-hover" : ""}`}
                                      style={isDualMenuOpen ? { position: "relative", zIndex: 10 } : undefined}
                                      onClick={() => {
                                        if (canDualMerge) setMergePreview({ origDocId: origDocs[0].id, transDocId: transDocs[0].id, label: slot.label });
                                      }}
                                      onDragOver={e => { if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); }}
                                      onDrop={e => {
                                        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                                        e.preventDefault();
                                        const file = e.dataTransfer.files?.[0];
                                        if (file && file.type === "application/pdf") adminUploadFile(file, slot.id);
                                      }}>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-[11.5px] font-medium tracking-tight" style={{ color: dualColor ?? "var(--w)" }}>
                                          {slot.label}{slot.label_trans ? <span style={{ color: dualColor ? undefined : "var(--w3)" }}> / {slot.label_trans}</span> : null}
                                        </p>
                                        {allSlotDocs.length === 0 && <p className="text-[10px] mt-0.5" style={{ color: "var(--w3)" }}>Not submitted yet</p>}
                                      </div>
                                      {/* Merged PDF download */}
                                      {canDualMerge && (
                                        <button type="button"
                                          disabled={isDualMergeDl}
                                          title="Download merged PDF"
                                          className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40 flex-shrink-0"
                                          style={{ color: "var(--w2)" }}
                                          onClick={async e => {
                                            e.stopPropagation();
                                            if (isDualMergeDl) return;
                                            const mfn = mergedPdfName(origDocs[0]?.file_name, slot.label);
                                            // iOS: server-route navigation → native download prompt.
                                            if (isIOSDevice()) {
                                              triggerIosDownload(
                                                `/api/portal/documents/merge-pdf?origDocId=${encodeURIComponent(origDocs[0].id)}&transDocId=${encodeURIComponent(transDocs[0].id)}` +
                                                  `&dl=1&name=${encodeURIComponent(mfn)}&access_token=${encodeURIComponent(accessToken)}`,
                                                mfn,
                                              );
                                              return;
                                            }
                                            setMergePdfDl(prev => new Set(prev).add(slot.id));
                                            try {
                                              const res = await fetch(
                                                `/api/portal/documents/merge-pdf?origDocId=${origDocs[0].id}&transDocId=${transDocs[0].id}`,
                                                { headers: { Authorization: `Bearer ${accessToken}` } }
                                              );
                                              if (!res.ok) throw new Error("Failed");
                                              const blob = await res.blob();
                                              const url = URL.createObjectURL(blob);
                                              const a = document.createElement("a");
                                              a.href = url;
                                              a.download = mfn;
                                              a.click();
                                              URL.revokeObjectURL(url);
                                            } catch (e) { console.error(e); }
                                            setMergePdfDl(prev => { const n = new Set(prev); n.delete(slot.id); return n; });
                                          }}>
                                          {isDualMergeDl
                                            ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                                            : <Download size={13} strokeWidth={1.8} />}
                                        </button>
                                      )}
                                      {/* Expand/collapse chevron */}
                                      <button type="button"
                                        className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0"
                                        style={{ color: "var(--w3)" }}
                                        aria-label={isDualExpanded ? "Collapse" : "Expand"}
                                        onClick={e => {
                                          e.stopPropagation();
                                          setExpandedDualSlots(prev => {
                                            const n = new Set(prev);
                                            n.has(slot.id) ? n.delete(slot.id) : n.add(slot.id);
                                            return n;
                                          });
                                        }}>
                                        <ChevronDown size={13} strokeWidth={1.8}
                                          style={{ transition: "transform var(--dur-2) var(--ease)", transform: isDualExpanded ? "rotate(180deg)" : "rotate(0deg)" }} />
                                      </button>
                                      {/* Three-dots — Edit label + Delete */}
                                      <div className="relative flex-shrink-0">
                                        <button
                                          onClick={e => { e.stopPropagation(); setRevokeMenu(prev => prev?.id === slot.id ? null : { id: slot.id, el: e.currentTarget as HTMLElement }); }}
                                          className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                          style={{ color: "var(--w2)" }}>
                                          <MoreHorizontal size={14} strokeWidth={1.8} />
                                        </button>
                                        <DropdownMenu open={revokeMenu?.id === slot.id} onClose={() => setRevokeMenu(null)} anchor={revokeMenu?.id === slot.id ? revokeMenu.el : null}>
                                              <button
                                                onClick={e => { e.stopPropagation(); setRevokeMenu(null); setEditingSlotId(slot.id); setEditingSlotLabel(slot.label); setEditingSlotLabelTrans(slot.label_trans ?? ""); setEditingSlotInstructions(slot.instructions ?? ""); }}
                                                className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                style={{ color: "var(--w)" }}>
                                                <FilePen size={11} strokeWidth={1.8} /> Edit label
                                              </button>
                                              <button
                                                onClick={e => { e.stopPropagation(); setRevokeMenu(null); deletePhaseSlot(slot.id, slotPhase); }}
                                                className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                style={{ color: "var(--danger)" }}>
                                                <Trash2 size={11} strokeWidth={1.8} /> Delete slot
                                              </button>
                                        </DropdownMenu>
                                      </div>
                                    </div>
                                    {/* Sub-rows — only shown when expanded */}
                                    {isDualExpanded && (
                                      <div className="px-3 pb-3 space-y-1.5">
                                        {slotSubRows.map(({ subKey, subLabel, subDoc }) => {
                                          const subSt = !subDoc ? null
                                            : subDoc.status === "approved" ? "approved"
                                            : subDoc.status === "rejected" ? "rejected"
                                            : "pending";
                                          const subColor = subSt === "approved" ? "#16a34a" : subSt === "pending" ? "#f59e0b" : null;
                                          const subClickable = !!subDoc?.drive_file_id;
                                          const isSubMenuOpen = subDoc && revokeMenu?.id === subDoc.id;
                                          return (
                                            <div key={subLabel}
                                              onClick={subClickable ? () => setPreviewDoc(subDoc!) : undefined}
                                              className={`rounded-xl px-3 py-3${subClickable ? " bv-row-hover cursor-pointer" : ""}`}
                                              style={{ background: "var(--bg2)", border: "1px solid var(--border)", minHeight: 60, ...(isSubMenuOpen ? { position: "relative", zIndex: 10 } : {}) }}>
                                              <div className="flex items-center gap-1.5">
                                                <div className="flex-1 min-w-0">
                                                  <p className="text-[11.5px] font-medium tracking-tight truncate" style={{ color: subColor ?? "var(--w2)" }}>{subLabel}</p>
                                                  {!subDoc && <p className="text-[10px] mt-0.5" style={{ color: "var(--w3)" }}>Not submitted yet</p>}
                                                  {subDoc?.status === "rejected" && subDoc.feedback && (
                                                    <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--danger)" }}>{subDoc.feedback}</p>
                                                  )}
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0"
                                                  onClick={e => e.stopPropagation()}
                                                  onMouseDown={e => e.stopPropagation()}>
                                                  {/* Upload */}
                                                  {adminUploadSlotId === subKey ? (
                                                    <span className="w-8 h-8 flex flex-col items-center justify-center gap-0.5">
                                                      <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" style={{ color: "var(--w3)" }} />
                                                      <span className="text-[8px] font-semibold tabular-nums" style={{ color: "var(--w3)" }}>{Math.round(adminSlotProgress)}%</span>
                                                    </span>
                                                  ) : (
                                                    <button type="button"
                                                      onClick={e => { e.stopPropagation(); openAdminUploadPicker(subKey); }}
                                                      className="bv-icon-btn w-8 h-8 flex items-center justify-center rounded-full"
                                                      style={{ color: "var(--w3)" }}>
                                                      <Upload size={12} strokeWidth={1.8} />
                                                    </button>
                                                  )}
                                                  {/* Download */}
                                                  {subDoc?.drive_file_id && (
                                                    <button type="button"
                                                      onClick={e => { e.stopPropagation(); downloadDoc(subDoc!); }}
                                                      className="bv-icon-btn w-8 h-8 flex items-center justify-center rounded-full"
                                                      style={{ color: "var(--w2)" }}>
                                                      <Download size={12} strokeWidth={1.8} />
                                                    </button>
                                                  )}
                                                  {/* Reject / Approve */}
                                                  {subSt === "pending" && !subDoc?.uploaded_by_admin && (
                                                    <>
                                                      <button type="button"
                                                        onClick={e => { e.stopPropagation(); openRejectModal({ kind: "doc", docId: subDoc!.id, label: subLabel, initialFeedback: subDoc!.feedback ?? "" }); }}
                                                        disabled={saving[subDoc!.id]}
                                                        className="bv-icon-btn bv-icon-btn--reject w-8 h-8 flex items-center justify-center rounded-full disabled:opacity-40">
                                                        <XCircle size={13} strokeWidth={1.8} />
                                                      </button>
                                                      <button type="button"
                                                        onClick={e => { e.stopPropagation(); review(subDoc!.id, "approved"); }}
                                                        disabled={saving[subDoc!.id]}
                                                        className="bv-icon-btn bv-icon-btn--approve w-8 h-8 flex items-center justify-center rounded-full disabled:opacity-40">
                                                        <CheckCircle2 size={13} strokeWidth={1.8} />
                                                      </button>
                                                    </>
                                                  )}
                                                  {/* Three-dots — Sign + Revoke (shown when doc exists) */}
                                                  {subDoc && (
                                                    <div className="relative flex-shrink-0">
                                                      <button
                                                        onClick={e => { e.stopPropagation(); setRevokeMenu(prev => prev?.id === subDoc!.id ? null : { id: subDoc!.id, el: e.currentTarget as HTMLElement }); }}
                                                        className="bv-icon-btn w-8 h-8 flex items-center justify-center rounded-full"
                                                        style={{ color: "var(--w2)" }}>
                                                        <MoreHorizontal size={12} strokeWidth={1.8} />
                                                      </button>
                                                      <DropdownMenu open={revokeMenu?.id === subDoc.id} onClose={() => setRevokeMenu(null)} anchor={revokeMenu?.id === subDoc.id ? revokeMenu.el : null}>
                                                            <button
                                                              onClick={e => { e.stopPropagation(); setRevokeMenu(null); setSigModal({ docId: subDoc?.id ?? null, driveFileId: subDoc?.drive_file_id ?? null, label: subLabel }); }}
                                                              className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                              style={{ color: "var(--w)" }}>
                                                              <FilePen size={11} strokeWidth={1.8} /> Signature
                                                            </button>
                                                            {subSt === "approved" && (
                                                              <button
                                                                onClick={e => { e.stopPropagation(); setRevokeMenu(null); openRejectModal({ kind: "doc", docId: subDoc!.id, label: subLabel, initialFeedback: subDoc!.feedback ?? "" }); }}
                                                                disabled={saving[subDoc!.id]}
                                                                className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                                                style={{ color: "var(--danger)" }}>
                                                                <RotateCcw size={11} strokeWidth={1.8} /> Revoke
                                                              </button>
                                                            )}
                                                      </DropdownMenu>
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </SortableSlotItem>
                                );
                              })}
                            </div>
                            </SortableContext>
                            </DndContext>
                          )}
                          </div>{/* end px-2 py-2 */}
                        </div>
                      );
                    })()}

                    {/* ── Add slot modal — title-only. The slot is created
                            empty; uploads, actions, instructions all happen
                            later when admin clicks the slot row. ─────────── */}
                    {addSlotPhase && typeof window !== "undefined" && createPortal(
                      // LAW #36: portal to body so bv-enter animation stacking context
                      // doesn't trap fixed positioning inside the column.
                      <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
                        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
                        onClick={() => !addSlotSaving && setAddSlotPhase(null)}>
                        <div className="w-full max-w-sm rounded-[20px] p-5 space-y-4"
                          style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)", animation: "bvFadeRise .28s var(--ease-out)", maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)", overflowY: "auto" }}
                          onClick={e => e.stopPropagation()}>
                          <p className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>
                            {lang === "de" ? "Slot hinzufügen" : lang === "fr" ? "Ajouter un slot" : "Add slot"}
                          </p>

                          <input
                            type="text"
                            placeholder={lang === "de" ? "Titel" : lang === "fr" ? "Titre" : "Title"}
                            value={addSlotLabel}
                            onChange={e => setAddSlotLabel(e.target.value)}
                            autoFocus
                            className="w-full px-3 py-2.5 text-[13px] outline-none"
                            style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--w)" }}
                          />

                          <div className="flex gap-2">
                            <button onClick={() => setAddSlotPhase(null)} disabled={addSlotSaving}
                              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                              style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                              {lang === "de" ? "Abbrechen" : lang === "fr" ? "Annuler" : "Cancel"}
                            </button>
                            <button
                              onClick={() => addPhaseSlot(addSlotPhase!, addSlotLabel, "")}
                              disabled={addSlotSaving || !addSlotLabel.trim()}
                              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-40"
                              style={{ background: "var(--gold)", color: "#131312" }}>
                              {addSlotSaving
                                ? (lang === "de" ? "Speichern…" : lang === "fr" ? "Enregistrement…" : "Saving…")
                                : (lang === "de" ? "Erstellen" : lang === "fr" ? "Créer" : "Create")}
                            </button>
                          </div>
                        </div>
                      </div>,
                      document.body,
                    )}

                    {/* ── Auto-fill review modal (native AcroForm PDFs) ── */}
                    {autoFillReview && (() => {
                      const af = autoFillReview;
                      const candidateProfile = selectedUser ? profiles[selectedUser] : null;
                      return (
                        <AutoFillReviewModal
                          slotId={af.slotId}
                          pdfBytes={af.pdfBytes}
                          detected={af.detected}
                          profile={candidateProfile ?? null}
                          cv={null}
                          lang={lang as "fr" | "en" | "de"}
                          accessToken={accessToken ?? ""}
                          onClose={() => setAutoFillReview(null)}
                          onSubmit={async (filledBytes, { letCandidateComplete }) => {
                            if (!accessToken) return;
                            // Replace the slot template with the filled (still editable) PDF.
                            const filledFile = new File(
                              [new Uint8Array(filledBytes).buffer as ArrayBuffer],
                              af.file.name,
                              { type: "application/pdf" },
                            );
                            localTemplateFileRef.current.set(af.slotId, filledFile);
                            const tplFd = new FormData();
                            tplFd.append("file", filledFile);
                            tplFd.append("slotId", af.slotId);
                            await fetch("/api/portal/admin/slot-template", {
                              method: "POST",
                              headers: { Authorization: `Bearer ${accessToken}` },
                              body: tplFd,
                            }).catch(err => console.warn("[autoFill] slot-template POST failed:", err));
                            // Two outcomes: admin-only (printed + physical sig)
                            // OR admin + candidate (candidate completes remaining
                            // native fields in their dashboard fillForm).
                            const candidateFills = !!letCandidateComplete;
                            await fetch("/api/portal/phase-slots", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                              body: JSON.stringify({
                                id: af.slotId,
                                admin_signs: false, candidate_signs: false,
                                admin_fills: true,  candidate_fills: candidateFills,
                                pdf_has_native_fields: true,
                              }),
                            }).catch(err => console.warn("[autoFill] phase-slots PATCH failed:", err));
                            setPhaseSlots(prev => {
                              const updated: typeof prev = {};
                              for (const [ph, slots] of Object.entries(prev)) {
                                updated[ph] = (slots ?? []).map(s => s?.id === af.slotId
                                  ? { ...s, admin_signs: false, candidate_signs: false, admin_fills: true, candidate_fills: candidateFills, pdf_has_native_fields: true }
                                  : s);
                              }
                              return updated;
                            });
                            // If candidate must complete it, fire the bell so
                            // they get a notification + can open the slot.
                            if (candidateFills && selectedUser) {
                              const slotLabel = Object.values(phaseSlots).flat().find(s => s?.id === af.slotId)?.label ?? "Document";
                              fetch("/api/portal/admin/phase-slots/notify", {
                                method: "POST",
                                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                                body: JSON.stringify({ slotId: af.slotId, candidateUserId: selectedUser, slotLabel, needsSign: false, needsFill: true }),
                              }).catch(err => console.warn("[autoFill notify] non-fatal:", err));
                            }
                            setAutoFillReview(null);
                          }}
                        />
                      );
                    })()}

                    {/* ── Slot config popup (LAW #34) — portaled to body: bv-enter animation
                        creates a stacking context that traps fixed children. ── */}
                    {slotConfigPopup && typeof window !== "undefined" && createPortal((() => {
                      const cfg = slotConfigPopup;
                      // Tiles are now always-open (admin + candidate boxes always visible),
                      // so the accordion toggle / scrollIntoView logic is gone — saves
                      // vertical space + an extra tap.
                      const signChecked = cfg.admin_signs || cfg.candidate_signs;
                      void cfg.admin_fills; void cfg.candidate_fills;
                      // Tile is a flat container — never gains a border/background on selection.
                      // Only the Admin / Candidate chips below light up. Avoids the double-border
                      // bleed where tile-gold + chip-gold overlap at the chip's left edge.
                      const tileStyle: React.CSSProperties = {
                        border: "1px solid var(--border)",
                        background: "var(--bg2)",
                        borderRadius: 14,
                        overflow: "hidden" as const,
                      };
                      // Two-column grid — admin + candidate sit side-by-side so the
                      // accordion stays compact and works on phone without scrolling.
                      const subOpts = (items: { key: keyof SlotConfigState; label: string; sub: string }[]) => (
                        <div className="px-3 pb-3 pt-1 grid grid-cols-2 gap-1.5">
                          {items.map(({ key, label, sub }) => (
                            <label key={key} className="flex items-start gap-2 px-2.5 py-2.5 cursor-pointer transition-all"
                              style={{
                                background: cfg[key] ? "rgba(0,0,0,0.22)" : "var(--bg2)",
                                border: `1px solid ${cfg[key] ? "var(--border-gold)" : "var(--border)"}`,
                                borderRadius: 10,
                              }}>
                              <input type="checkbox" className="mt-0.5 flex-shrink-0 accent-[var(--gold)]"
                                checked={!!cfg[key]}
                                onChange={e => setSlotConfigPopup(p => p ? { ...p, [key]: e.target.checked } : p)} />
                              <div className="min-w-0">
                                <p className="text-[12px] font-semibold leading-tight tracking-tight" style={{ color: "var(--w)" }}>{label}</p>
                                {sub && (
                                  <p className="text-[9.5px] mt-0.5 leading-snug" style={{ color: "var(--w3)" }}>{sub}</p>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      );
                      return (
                        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-stretch sm:items-center justify-center p-2 sm:p-4 pb-[88px]"
                          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
                          onClick={() => !slotConfigSaving && setSlotConfigPopup(null)}>
                          <div className="w-full sm:max-w-md flex flex-col overflow-hidden"
                            onClick={e => e.stopPropagation()}
                            style={{ background: "var(--card)", border: "1px solid var(--border-gold)", borderRadius: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)", maxHeight: "calc(100dvh - 72px - 16px)" }}>
                            {/* Header — tighter scale to match the rest of the portal modals. */}
                            <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
                              <div className="min-w-0">
                                <p className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                                  {lang === "de" ? "Was soll mit diesem PDF passieren?" : lang === "fr" ? "Que doit-il se passer avec ce PDF ?" : "What should happen with this PDF?"}
                                </p>
                                <p className="text-[10.5px] mt-1 leading-snug" style={{ color: "var(--w3)" }}>
                                  {lang === "de" ? "Wählen Sie eine oder mehrere Optionen." : lang === "fr" ? "Choisissez une ou plusieurs options." : "Choose one or more options."}
                                </p>
                              </div>
                              <button onClick={() => setSlotConfigPopup(null)} disabled={slotConfigSaving}
                                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40"
                                style={{ color: "var(--w3)" }}>
                                <XIcon size={14} strokeWidth={1.8} />
                              </button>
                            </div>
                            {/* Body — 3 tiles. min-h-0 + overscroll-contain so flex shrinks
                                properly and tiles scroll inside the card when expanded on phone. */}
                            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 flex flex-col gap-2">
                              {/* SIGN tile — always-open, two-column admin/candidate picker. */}
                              <div data-slot-tile="sign" style={tileStyle}>
                                <div className="w-full flex items-center gap-3 px-3.5 py-3">
                                  <FilePen size={16} strokeWidth={1.6} style={{ color: signChecked ? "var(--gold)" : "var(--w3)", flexShrink: 0, transition: "color 0.18s var(--ease-out)" }} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[12.5px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                                      {lang === "de" ? "Unterschrift" : lang === "fr" ? "Signature" : "Sign"}
                                    </p>
                                    <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: "var(--w3)" }}>
                                      {lang === "de" ? "Wer unterschreibt dieses PDF?" : lang === "fr" ? "Qui signe ce PDF ?" : "Who signs this PDF?"}
                                    </p>
                                  </div>
                                </div>
                                {subOpts([
                                  { key: "admin_signs",     label: lang === "de" ? "Admin" : lang === "fr" ? "Admin"    : "Admin",     sub: "" },
                                  { key: "candidate_signs", label: lang === "de" ? "Kandidat" : lang === "fr" ? "Candidat" : "Candidate", sub: "" },
                                ])}
                              </div>
                              {/* FILL tile removed: form-field drawing is gone, and
                                  native-AcroForm filling is handled on upload via
                                  AutoFillReviewModal. */}
                              {/* NOTHING tile */}
                              <button className="w-full flex items-center gap-3 px-3.5 py-3 text-left disabled:opacity-40"
                                style={tileStyle}
                                disabled={slotConfigSaving}
                                onClick={() => saveSlotConfig({ ...cfg, admin_signs: false, candidate_signs: false, admin_fills: false, candidate_fills: false, pdf_has_native_fields: false })}>
                                <FileText size={16} strokeWidth={1.6} style={{ color: "var(--w3)", flexShrink: 0 }} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12.5px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                                    {lang === "de" ? "Nichts — nur Dokument" : lang === "fr" ? "Rien — document seul" : "Nothing — document only"}
                                  </p>
                                  <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: "var(--w3)" }}>
                                    {lang === "de" ? "Als reines Dokument speichern" : lang === "fr" ? "Enregistrer comme document seul" : "Save as-is, no signature or fill needed"}
                                  </p>
                                </div>
                              </button>
                            </div>
                            <div className="flex gap-2 px-5 py-3 flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
                              <button onClick={() => setSlotConfigPopup(null)} disabled={slotConfigSaving}
                                className="flex-1 py-2.5 text-[12px] font-semibold transition-all disabled:opacity-40"
                                style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid transparent", borderRadius: 10 }}>
                                {lang === "de" ? "Überspringen" : lang === "fr" ? "Passer" : "Skip"}
                              </button>
                              <button onClick={() => saveSlotConfig(cfg)} disabled={slotConfigSaving}
                                className="flex-1 py-2.5 text-[12px] font-semibold transition-all disabled:opacity-40 hover:opacity-95"
                                style={{ background: "var(--gold)", color: "#131312", borderRadius: 10, boxShadow: "0 4px 14px var(--border-gold), 0 0 0 1px var(--border-gold)" }}>
                                {slotConfigSaving
                                  ? (lang === "de" ? "Speichern…" : lang === "fr" ? "Enregistrement…" : "Saving…")
                                  : (lang === "de" ? "Bestätigen" : lang === "fr" ? "Confirmer" : "Confirm")}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })(), document.body)}

                    {/* Configure-fields modal removed: drawing form fields is no
                        longer supported. Use an external tool (Acrobat, etc.) to
                        author the native AcroForm fields once; the portal
                        auto-detects + auto-fills them on upload. */}

                    {/* ── Edit slot label modal ─────────────────────────────────────── */}

                    {/* ── Live candidate preview — shows exactly what the candidate sees
                        for this stage with the current pipeline state ──
                        Hidden for recognition/visum: slot management UI covers those. */}
                    {activePipelineStage !== "recognition" && activePipelineStage !== "visum" && (
                      <div className="mt-6">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-3 inline-flex items-center gap-1.5"
                          style={{ color: "var(--w3)" }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--gold)" }} />
                          What the candidate sees
                        </p>
                        <div className="rounded-[var(--r-xl)] p-4"
                          style={{ background: "var(--bg2)", border: "1px dashed var(--border2)" }}>
                          <CandidateStagePreview
                            mode={activePipelineStage as JourneyMode}
                            pipeline={pipeline}
                            t={t}
                            lang={lang}
                            adminMode={true}
                          />
                        </div>
                      </div>
                    )}

                    {/* Pipeline stage footer — Lock + Send */}
                    <div className="flex items-center justify-end mt-5">
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {(() => {
                          const unlocked =
                            activePipelineStage === "interview"   ? pipeline.docs_approved
                          : activePipelineStage === "recognition" ? pipeline.recognition_unlocked
                          : activePipelineStage === "visum"       ? pipeline.embassy_unlocked
                          : activePipelineStage === "reise"       ? !!pipeline.flight_date
                          : activePipelineStage === "integration" ? pipeline.integration_unlocked
                          : /* start */                             pipeline.start_unlocked;
                          const isReise = activePipelineStage === "reise";
                          const slotPhase = activePipelineStage === "recognition" ? "bearbeitung" : activePipelineStage === "visum" ? "visum" : null;
                          return (
                            <>
                              {/* LAW #31: supreme admin can toggle ANY stage, ANY time. While the
                                  role check is still resolving on initial load, render as clickable
                                  to avoid the race where a fast admin click hits a no-op span. Server
                                  is authoritative — sub-admins get a 403 if they try. */}
                              {(activePipelineStage === "interview" || isSuperAdmin || !roleResolved) ? (
                                <button
                                  onClick={() => {
                                    if (isReise) return;
                                    if      (activePipelineStage === "interview")   savePipelineField({ docs_approved:        !pipeline.docs_approved });
                                    else if (activePipelineStage === "recognition") savePipelineField({ recognition_unlocked: !pipeline.recognition_unlocked });
                                    else if (activePipelineStage === "visum")       savePipelineField({ embassy_unlocked:      !pipeline.embassy_unlocked });
                                    else if (activePipelineStage === "integration") savePipelineField({ integration_unlocked: !pipeline.integration_unlocked });
                                    else                                            savePipelineField({ start_unlocked:        !pipeline.start_unlocked });
                                  }}
                                  className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 flex-shrink-0 transition-all"
                                  style={{
                                    background: unlocked ? "var(--success-bg)" : "var(--bg2)",
                                    color: unlocked ? "var(--success)" : "var(--w2)",
                                    border: `1px solid ${unlocked ? "var(--success-border)" : "var(--border)"}`,
                                    borderRadius: "var(--r-sm)",
                                    cursor: isReise ? "default" : "pointer",
                                  }}>
                                  {unlocked ? <Unlock size={11} strokeWidth={1.8} /> : <Lock size={11} strokeWidth={1.8} />}
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 flex-shrink-0"
                                  style={{ background: unlocked ? "var(--success-bg)" : "var(--bg2)", color: unlocked ? "var(--success)" : "var(--w3)", border: `1px solid ${unlocked ? "var(--success-border)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                                  {unlocked ? <Unlock size={11} strokeWidth={1.8} /> : <Lock size={11} strokeWidth={1.8} />}
                                </span>
                              )}
                              {slotPhase && (
                                <button
                                  onClick={() => { setAddSlotPhase(slotPhase); setAddSlotLabel(""); setAddSlotInstructions(""); }}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 flex-shrink-0 transition-colors"
                                  style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-sm)" }}>
                                  <Plus size={11} strokeWidth={2.2} />
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                ) : (
                <div key={`phase-${activePhase}`} className="bv-enter">
                  {/* Premium phase card — same surface language as the CV
                      builder: 20px rounded, var(--card) background, soft 1px
                      shadow. Phase header lives inside; doc rows below stay
                      borderless with thin dividers between them. */}
                  <div className="overflow-hidden"
                    style={{
                      background: "var(--card)",
                      borderRadius: "20px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    }}>
                    {/* Doc slots — borderless rows inside the card */}
                    <div className="px-2 py-2">
                    {currentItems.map((item, idx) => {
                      // ── Special full render for Passport Data PDF ────────────────────────────
                      if (item.key === "passport_data_pdf") {
                        const p = profiles[selectedUser ?? ""];
                        const pst = p?.passport_status ?? null;
                        const hasData = !!pst;
                        const cSt = !hasData ? "empty" : pst === "approved" ? "approved" : pst === "rejected" ? "rejected" : "pending";
                        const sc2 = cSt === "approved" ? { bg: "var(--success-border)",  txt: "var(--success)", bdr: "1px solid var(--success-border)" }
                                  : cSt === "rejected"  ? { bg: "var(--danger-bg)",  txt: "var(--danger)", bdr: "1px solid var(--danger-bg)" }
                                  : cSt === "pending"   ? { bg: "rgba(245,158,11,0.12)", txt: "#f59e0b", bdr: "1px solid rgba(245,158,11,0.3)" }
                                  :                       { bg: "var(--bg2)",             txt: "var(--w3)", bdr: "1px solid var(--border)" };
                        const cSymEl = cSt === "approved" ? <CheckCircle2 size={14} strokeWidth={1.8} />
                                     : cSt === "rejected" ? <XCircle      size={14} strokeWidth={1.8} />
                                     : cSt === "pending"  ? <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
                                     :                      <span className="w-1.5 h-1.5 rounded-full" style={{ border: "1px solid currentColor" }} />;
                        const fn2 = (p?.first_name ?? "vorname").toLowerCase().replace(/\s+/g, "_");
                        const ln2 = (p?.last_name  ?? "nachname").toLowerCase().replace(/\s+/g, "_");
                        const pdfFn = `${fn2}_${ln2}_reisepass_daten.pdf`;
                        return (
                          <div key="passport_data_pdf">
                            {idx > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                            <div className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                {/* Status circle */}
                                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                                  style={{ background: sc2.bg, color: sc2.txt, border: sc2.bdr }}>
                                  {cSymEl}
                                </div>
                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11.5px] font-medium tracking-tight" style={{ color: "var(--w)" }}>{item.label}</p>
                                  {!hasData && <p className="text-[10px] mt-0.5" style={{ color: "var(--w3)" }}>{lang === "fr" ? "Non soumis" : lang === "de" ? "Nicht eingereicht" : "Not submitted yet"}</p>}
                                  {hasData && cSt === "rejected" && passportDataFeedback && (
                                    <p className="text-[11px] mt-1" style={{ color: "var(--danger)" }}>"{passportDataFeedback}"</p>
                                  )}
                                  {/* Approved: revoke ⋯ menu */}
                                  {hasData && cSt === "approved" && (
                                    <div className="relative mt-1.5 inline-block">
                                      <button onClick={e => setRevokeMenu(prev => prev?.id === "passport_data_pdf" ? null : { id: "passport_data_pdf", el: e.currentTarget as HTMLElement })}
                                        title="Revoke approval" aria-label="More actions"
                                        className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full bv-touch"
                                        style={{ color: "var(--w2)" }}>
                                        <MoreHorizontal size={13} strokeWidth={1.8} />
                                      </button>
                                      <DropdownMenu open={revokeMenu?.id === "passport_data_pdf"} onClose={() => setRevokeMenu(null)} anchor={revokeMenu?.id === "passport_data_pdf" ? revokeMenu.el : null} align="left">
                                            <button onClick={() => { setRevokeMenu(null); openRejectModal({ kind: "passport", label: item.label, initialFeedback: passportDataFeedback }); }}
                                              className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                              style={{ color: "var(--danger)" }}><RotateCcw size={11} strokeWidth={1.8} /> Revoke</button>
                                      </DropdownMenu>
                                    </div>
                                  )}
                                </div>
                                {/* Right: single-row action icons —
                                    eye / download / reject / approve. */}
                                {hasData && (
                                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                                    <button onClick={() => setShowPassportInfo(true)} title="Preview data"
                                      className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                      style={{ color: "var(--w2)" }}>
                                      <Eye size={14} strokeWidth={1.8} />
                                    </button>
                                    <button
                                      onClick={async () => {
                                        if (!selectedUser) return;
                                        // iOS: navigate to the server route (token in query,
                                        // octet-stream) → native download prompt.
                                        if (isIOSDevice()) {
                                          triggerIosDownload(
                                            `/api/portal/passport-pdf?userId=${encodeURIComponent(selectedUser)}` +
                                              `&dl=1&access_token=${encodeURIComponent(accessToken)}`,
                                            pdfFn,
                                          );
                                          return;
                                        }
                                        setPassportPdfDl(true);
                                        try {
                                          const res = await fetch(`/api/portal/passport-pdf?userId=${selectedUser}`, { headers: { Authorization: `Bearer ${accessToken}` } });
                                          if (!res.ok) throw new Error("Failed");
                                          const blob = await res.blob();
                                          const url = URL.createObjectURL(blob);
                                          const a = document.createElement("a");
                                          a.href = url; a.download = pdfFn; a.click(); URL.revokeObjectURL(url);
                                        } catch (e) { console.error(e); }
                                        setPassportPdfDl(false);
                                      }}
                                      disabled={passportPdfDl} title="Download PDF" aria-label="Download"
                                      className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40"
                                      style={{ color: "var(--w2)" }}>
                                      {passportPdfDl ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Download size={13} strokeWidth={1.8} />}
                                    </button>
                                    {cSt !== "approved" && cSt !== "empty" && (
                                      <>
                                        <button
                                          onClick={() => openRejectModal({ kind: "passport", label: item.label, initialFeedback: passportDataFeedback })}
                                          disabled={passportInfoSaving}
                                          title="Reject" aria-label="Reject"
                                          className="bv-icon-btn bv-icon-btn--reject w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40">
                                          {passportInfoSaving ? "…" : <XCircle size={15} strokeWidth={1.8} />}
                                        </button>
                                        <button
                                          onClick={() => reviewPassport("approved", passportDataFeedback)}
                                          disabled={passportInfoSaving}
                                          title="Approve" aria-label="Approve"
                                          className="bv-icon-btn bv-icon-btn--approve w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40">
                                          {passportInfoSaving ? "…" : <CheckCircle2 size={15} strokeWidth={1.8} />}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      // ── Paired Original + Übersetzt rendering ────────────────────────────────
                      if (item.transKey) {
                        const origDoc  = getAdminDocs(item.key)[0];
                        const transDoc = getAdminDocs(item.transKey)[0];
                        const mOrigSt  = origDoc?.status  ?? "empty";
                        const mTransSt = transDoc?.status ?? "empty";
                        const mBothApproved = mOrigSt === "approved" && mTransSt === "approved";
                        const mHasPending   = mOrigSt === "pending"  || mTransSt === "pending";
                        const mPairColor = mBothApproved ? "#16a34a" : mHasPending ? "#f59e0b" : null;

                        const renderSubDoc = (subDoc: Doc | undefined, subLabel: string) => {
                          const sst = !subDoc ? "empty" : subDoc.status;
                          const ssc = sst === "approved" ? { bg: "var(--success-bg)", txt: "var(--success)", bdr: "var(--success-border)" }
                            : sst === "rejected" ? { bg: "var(--danger-bg)", txt: "var(--danger)", bdr: "var(--danger-bg)" }
                            : sst === "pending"  ? { bg: "rgba(245,158,11,0.12)", txt: "#f59e0b", bdr: "rgba(245,158,11,0.3)" }
                            : { bg: "var(--bg2)", txt: "var(--w3)", bdr: "var(--border)" };
                          return (
                            <div
                              className={`rounded-xl px-3 py-3${subDoc ? " bv-row-hover cursor-pointer" : ""}`}
                              style={{ background: "var(--bg2)", border: "1px solid var(--border)", minHeight: 60 }}
                              onClick={() => { if (subDoc) setPreviewDoc(subDoc); }}>
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11.5px] font-medium tracking-tight" style={{ color: subDoc ? ssc.txt : "var(--w2)" }}>{subLabel}</p>
                                  {!subDoc && <p className="text-[10px]" style={{ color: "var(--w3)" }}>{lang === "de" ? "Nicht eingereicht" : "Not submitted"}</p>}
                                  {subDoc && sst === "rejected" && subDoc.feedback && (
                                    <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--danger)" }}>{subDoc.feedback}</p>
                                  )}
                                </div>
                                {subDoc && (
                                  <div className="flex items-center gap-1 flex-shrink-0"
                                    onClick={e => e.stopPropagation()}
                                    onMouseDown={e => e.stopPropagation()}>
                                    {subDoc.drive_file_id && (
                                      <button type="button"
                                        onClick={() => downloadDoc(subDoc)}
                                        title={t.aDownload}
                                        className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                        style={{ color: "var(--w2)" }}>
                                        <Download size={13} strokeWidth={1.8} />
                                      </button>
                                    )}
                                    {sst === "pending" && !subDoc.uploaded_by_admin && (
                                      <>
                                        <button type="button"
                                          onClick={() => openRejectModal({ kind: "doc", docId: subDoc.id, label: subLabel, initialFeedback: subDoc.feedback ?? "" })}
                                          disabled={saving[subDoc.id]}
                                          className="bv-icon-btn bv-icon-btn--reject w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40">
                                          <XCircle size={15} strokeWidth={1.8} />
                                        </button>
                                        <button type="button"
                                          onClick={() => review(subDoc.id, "approved")}
                                          disabled={saving[subDoc.id]}
                                          className="bv-icon-btn bv-icon-btn--approve w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40">
                                          <CheckCircle2 size={15} strokeWidth={1.8} />
                                        </button>
                                      </>
                                    )}
                                    {subDoc.drive_file_id && (
                                      <div className="relative flex-shrink-0">
                                        <button
                                          onClick={e => { e.stopPropagation(); setRevokeMenu(prev => prev?.id === subDoc.id ? null : { id: subDoc.id, el: e.currentTarget as HTMLElement }); }}
                                          className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                          style={{ color: "var(--w2)" }}>
                                          <MoreHorizontal size={15} strokeWidth={1.8} />
                                        </button>
                                        <DropdownMenu open={revokeMenu?.id === subDoc.id} onClose={() => setRevokeMenu(null)} anchor={revokeMenu?.id === subDoc.id ? revokeMenu.el : null}>
                                              <button
                                                onClick={e => { e.stopPropagation(); setRevokeMenu(null); setSigModal({ docId: subDoc.id, driveFileId: subDoc.drive_file_id!, label: subLabel }); }}
                                                className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                style={{ color: "var(--w)" }}>
                                                <FilePen size={11} strokeWidth={1.8} /> Signature
                                              </button>
                                              {sst === "approved" && (
                                                <button
                                                  onClick={e => { e.stopPropagation(); setRevokeMenu(null); openRejectModal({ kind: "doc", docId: subDoc.id, label: subLabel, initialFeedback: subDoc.feedback ?? "" }); }}
                                                  className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                  style={{ color: "var(--danger)" }}>
                                                  <RotateCcw size={11} strokeWidth={1.8} /> Revoke
                                                </button>
                                              )}
                                        </DropdownMenu>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        };

                        const isExpanded = expandedPairs.has(item.key);
                        const canMerge = !!(origDoc && transDoc);
                        const isMergeDl = mergePdfDl.has(item.key);
                        return (
                          <div key={item.key}>
                            {idx > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                            {/* Master header — click to preview merged PDF */}
                            <div
                              className={`px-3 py-3 flex items-center gap-2${canMerge ? " cursor-pointer bv-row-hover" : ""}`}
                              onClick={() => {
                                if (canMerge) setMergePreview({ origDocId: origDoc!.id, transDocId: transDoc!.id, label: item.label });
                              }}>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11.5px] font-medium tracking-tight" style={{ color: mPairColor ?? "var(--w)" }}>{item.label}</p>
                                {item.optional && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded"
                                    style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>{t.pOptional}</span>
                                )}
                              </div>
                              {canMerge && (
                                <button type="button"
                                  disabled={isMergeDl}
                                  title="Download merged PDF"
                                  aria-label="Download merged PDF"
                                  className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40 flex-shrink-0"
                                  style={{ color: "var(--w2)" }}
                                  onClick={async e => {
                                    e.stopPropagation();
                                    if (isMergeDl) return;
                                    const mfn = mergedPdfName(origDoc?.file_name, item.label);
                                    if (isIOSDevice()) {
                                      triggerIosDownload(
                                        `/api/portal/documents/merge-pdf?origDocId=${encodeURIComponent(origDoc!.id)}&transDocId=${encodeURIComponent(transDoc!.id)}` +
                                          `&dl=1&name=${encodeURIComponent(mfn)}&access_token=${encodeURIComponent(accessToken)}`,
                                        mfn,
                                      );
                                      return;
                                    }
                                    setMergePdfDl(prev => new Set(prev).add(item.key));
                                    try {
                                      const res = await fetch(
                                        `/api/portal/documents/merge-pdf?origDocId=${origDoc!.id}&transDocId=${transDoc!.id}`,
                                        { headers: { Authorization: `Bearer ${accessToken}` } }
                                      );
                                      if (!res.ok) throw new Error("Failed");
                                      const blob = await res.blob();
                                      const url = URL.createObjectURL(blob);
                                      const a = document.createElement("a");
                                      a.href = url;
                                      a.download = mfn;
                                      a.click();
                                      URL.revokeObjectURL(url);
                                    } catch (e) { console.error(e); }
                                    setMergePdfDl(prev => { const n = new Set(prev); n.delete(item.key); return n; });
                                  }}>
                                  {isMergeDl
                                    ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                                    : <Download size={13} strokeWidth={1.8} />}
                                </button>
                              )}
                              <button type="button"
                                className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0"
                                style={{ color: "var(--w3)" }}
                                aria-label={isExpanded ? "Collapse" : "Expand"}
                                onClick={e => {
                                  e.stopPropagation();
                                  setExpandedPairs(prev => {
                                    const n = new Set(prev);
                                    n.has(item.key) ? n.delete(item.key) : n.add(item.key);
                                    return n;
                                  });
                                }}>
                                <ChevronDown size={13} strokeWidth={1.8}
                                  style={{ transition: "transform var(--dur-2) var(--ease)", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }} />
                              </button>
                            </div>
                            {/* Sub-boxes — only shown when expanded */}
                            {isExpanded && (
                              <div className="px-3 pb-3 space-y-1.5">
                                {renderSubDoc(origDoc,  "Original")}
                                {renderSubDoc(transDoc, "Übersetzt")}
                              </div>
                            )}
                          </div>
                        );
                      }
                      // ─────────────────────────────────────────────────────────────────────────

                      const isMulti   = item.key === "other";
                      const itemDocs  = getAdminDocs(item.key);
                      const doc       = isMulti ? undefined : itemDocs[0];
                      const submitted = isMulti ? itemDocs.length > 0 : !!doc;

                      // Aggregate status for multi-doc slots
                      const multiRej  = isMulti && itemDocs.some(d => d.status === "rejected");
                      const multiApp  = isMulti && itemDocs.length > 0 && itemDocs.every(d => d.status === "approved");

                      const rowSt: "approved" | "rejected" | "pending" | null = !submitted ? null
                        : isMulti ? (multiRej ? "rejected" : multiApp ? "approved" : "pending")
                        : (doc!.status === "approved" ? "approved" : doc!.status === "rejected" ? "rejected" : "pending");
                      // LAW #4: red for rejected was missing — every status must be color-only.
                      const rowColor = rowSt === "approved" ? "#16a34a"
                        : rowSt === "rejected" ? "#ef4444"
                        : rowSt === "pending" ? "#f59e0b" : null;

                      // Whole-row click previews the doc (admin parity with
                      // candidate portal). Inner action buttons stop
                      // propagation so they don't trigger the preview.
                      const adminRowClickable = !isMulti && submitted && !!doc;
                      const adminRowOnClick = adminRowClickable ? () => setPreviewDoc(doc!) : undefined;

                      return (
                        <div key={item.key}>
                          {idx > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                          <div
                            onClick={adminRowOnClick}
                            className={`px-3 py-3 transition-colors${adminRowClickable ? " bv-row-hover cursor-pointer" : ""}`}
                            style={{ minHeight: 60 }}>
                            <div className="flex items-center gap-3">
                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <p className="text-[11.5px] font-medium tracking-tight" style={{ color: rowColor ?? "var(--w)" }}>{item.label}</p>
                                  {"optional" in item && item.optional && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                                      style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                                      {t.pOptional}
                                    </span>
                                  )}
                                </div>

                                {/* Not submitted */}
                                {!submitted && (
                                  <p className="text-[10px] mt-0.5" style={{ color: "var(--w3)" }}>{lang === "fr" ? "Non soumis" : lang === "de" ? "Nicht eingereicht" : "Not submitted yet"}</p>
                                )}

                                {!isMulti && doc && doc.status === "rejected" && doc.feedback && (
                                  <p className="text-[11px] mt-1" style={{ color: "var(--danger)" }}>{doc.feedback}</p>
                                )}

                                {/* Multi-doc slot ("other") */}
                                {isMulti && itemDocs.length > 0 && (
                                  <div className="mt-2 space-y-2">
                                    {itemDocs.map(d => {
                                      const dsc =
                                        d.status === "approved" ? { bg: "var(--success-bg)",  txt: "var(--success)", bdr: "var(--success-border)" }
                                      : d.status === "rejected"  ? { bg: "var(--danger-bg)",  txt: "var(--danger)", bdr: "var(--danger-bg)" }
                                      :                           { bg: "var(--gdim)", txt: "var(--gold)", bdr: "var(--border-gold)" };
                                      const dClickable = !!d.drive_file_id;
                                      return (
                                        <div key={d.id}
                                          onClick={dClickable ? () => setPreviewDoc(d) : undefined}
                                          className={`rounded-xl px-3 py-2.5${dClickable ? " bv-row-hover cursor-pointer" : ""}`}
                                          style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                                          <div className="flex items-center gap-1.5">
                                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0"
                                              style={{ background: dsc.bg, color: dsc.txt, border: `1px solid ${dsc.bdr}` }}>
                                              {d.status === "approved" ? <CheckCircle2 size={11} strokeWidth={1.8} />
                                                : d.status === "rejected" ? <XCircle size={11} strokeWidth={1.8} />
                                                : <span className="w-1 h-1 rounded-full" style={{ background: "currentColor" }} />}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                              {/* LAW #4: color is the only status language. The icon to the
                                                  left (check / cross / dot) plus the row color already convey
                                                  status; the text label below was redundant + a violation. */}
                                              <p className="text-xs font-medium truncate" style={{ color: dsc.txt }}>{d.file_name}</p>
                                            </div>
                                            {/* Action buttons — wrap so click + mousedown can't bubble
                                                to the row's preview-doc handler. */}
                                            <div className="flex items-center gap-1.5 flex-shrink-0"
                                              onClick={(e) => e.stopPropagation()}
                                              onMouseDown={(e) => e.stopPropagation()}>
                                            {/* Download — always shown (parity with top-level peer rows) */}
                                            {d.drive_file_id && (
                                              <button type="button"
                                                onClick={(e) => { e.stopPropagation(); downloadDoc(d); }}
                                                title={t.aDownload} aria-label={t.aDownload}
                                                className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0"
                                                style={{ color: "var(--w2)" }}>
                                                <Download size={12} strokeWidth={1.8} />
                                              </button>
                                            )}
                                            {d.status === "pending" && !d.uploaded_by_admin && (
                                              <>
                                                <button type="button"
                                                  onClick={(e) => { e.stopPropagation(); openRejectModal({ kind: "doc", docId: d.id, label: d.file_name, initialFeedback: d.feedback ?? "" }); }}
                                                  disabled={saving[d.id]}
                                                  title="Reject" aria-label="Reject"
                                                  className="bv-icon-btn bv-icon-btn--reject w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 disabled:opacity-40">
                                                  <XCircle size={12} strokeWidth={1.8} />
                                                </button>
                                                <button type="button"
                                                  onClick={(e) => { e.stopPropagation(); review(d.id, "approved"); }}
                                                  disabled={saving[d.id]}
                                                  title="Approve" aria-label="Approve"
                                                  className="bv-icon-btn bv-icon-btn--approve w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 disabled:opacity-40">
                                                  <CheckCircle2 size={12} strokeWidth={1.8} />
                                                </button>
                                              </>
                                            )}
                                            </div>
                                            {d.drive_file_id && (
                                              <div className="relative flex-shrink-0">
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); setRevokeMenu(prev => prev?.id === d.id ? null : { id: d.id, el: e.currentTarget as HTMLElement }); }}
                                                  title="More actions" aria-label="More actions"
                                                  className="bv-icon-btn w-6 h-6 flex items-center justify-center rounded-full bv-touch"
                                                  style={{ color: "var(--w2)" }}
                                                ><MoreHorizontal size={11} strokeWidth={1.8} /></button>
                                                <DropdownMenu open={revokeMenu?.id === d.id} onClose={() => setRevokeMenu(null)} anchor={revokeMenu?.id === d.id ? revokeMenu.el : null}>
                                                      {d.status === "approved" && (
                                                        <button
                                                          onClick={() => { setRevokeMenu(null); openRejectModal({ kind: "doc", docId: d.id, label: d.file_name, initialFeedback: d.feedback ?? "" }); }}
                                                          disabled={saving[d.id]}
                                                          className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                                          style={{ color: "var(--danger)" }}>
                                                          <RotateCcw size={11} strokeWidth={1.8} /> Revoke
                                                        </button>
                                                      )}
                                                </DropdownMenu>
                                              </div>
                                            )}
                                          </div>
                                          {d.status === "rejected" && d.feedback && (
                                            <p className="text-[11px] mt-1.5" style={{ color: "var(--danger)" }}>"{d.feedback}"</p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {/* Right: single-row action icons —
                                  download / reject / approve.
                                  Wrapper stops both click + mousedown bubbling
                                  so the parent row's "preview doc" handler
                                  can never swallow these button clicks. */}
                              {!isMulti && doc && (
                                <div className="flex items-center gap-1.5 flex-shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}>
                                  {doc.drive_file_id && (
                                    <button type="button" title={t.aDownload} aria-label={t.aDownload}
                                      onClick={(e) => { e.stopPropagation(); downloadDoc(doc); }}
                                      className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                      style={{ color: "var(--w2)" }}>
                                      <Download size={13} strokeWidth={1.8} />
                                    </button>
                                  )}
                                  {doc.status === "pending" && (
                                    <>
                                      <button type="button"
                                        onClick={(e) => { e.stopPropagation(); openRejectModal({ kind: "doc", docId: doc.id, label: item.label, initialFeedback: doc.feedback ?? "" }); }}
                                        disabled={saving[doc.id]}
                                        title="Reject" aria-label="Reject"
                                        className="bv-icon-btn bv-icon-btn--reject w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40">
                                        <XCircle size={15} strokeWidth={1.8} />
                                      </button>
                                      <button type="button"
                                        onClick={(e) => { e.stopPropagation(); review(doc.id, "approved"); }}
                                        disabled={saving[doc.id]}
                                        title="Approve" aria-label="Approve"
                                        className="bv-icon-btn bv-icon-btn--approve w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40">
                                        <CheckCircle2 size={15} strokeWidth={1.8} />
                                      </button>
                                    </>
                                  )}
                                  {doc.drive_file_id && (
                                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setRevokeMenu(prev => prev?.id === doc.id ? null : { id: doc.id, el: e.currentTarget as HTMLElement }); }}
                                        title="More actions" aria-label="More actions"
                                        className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                        style={{ color: "var(--w2)" }}>
                                        <MoreHorizontal size={14} strokeWidth={1.8} />
                                      </button>
                                      <DropdownMenu open={revokeMenu?.id === doc.id} onClose={() => setRevokeMenu(null)} anchor={revokeMenu?.id === doc.id ? revokeMenu.el : null}>
                                            {/* Always-useful actions for BOTH supreme admin
                                                and every sub-admin — menu is never empty. */}
                                            <button
                                              onClick={(e) => { e.stopPropagation(); setRevokeMenu(null); setPreviewDoc(doc); }}
                                              className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                              style={{ color: "var(--w)" }}>
                                              <Eye size={11} strokeWidth={1.8} /> Open
                                            </button>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); setRevokeMenu(null); downloadDoc(doc); }}
                                              className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                              style={{ color: "var(--w)" }}>
                                              <Download size={11} strokeWidth={1.8} /> Download
                                            </button>
                                            {item.key === "cv_de" && selectedUser && (
                                              <button
                                                onClick={(e) => { e.stopPropagation(); setRevokeMenu(null); window.open(`/portal/cv-builder?candidateId=${selectedUser}`, "_blank"); }}
                                                className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                style={{ color: "var(--w)" }}>
                                                <FilePen size={11} strokeWidth={1.8} /> Edit CV
                                              </button>
                                            )}
                                            {doc.status !== "approved" && (
                                              <button
                                                onClick={(e) => { e.stopPropagation(); setRevokeMenu(null); review(doc.id, "approved"); }}
                                                disabled={saving[doc.id]}
                                                className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                                style={{ color: "var(--success)" }}>
                                                <CheckCircle2 size={11} strokeWidth={1.8} /> {lang === "fr" ? "Approuver" : lang === "de" ? "Genehmigen" : "Approve"}
                                              </button>
                                            )}
                                            {doc.status === "pending" && (
                                              <button
                                                onClick={(e) => { e.stopPropagation(); setRevokeMenu(null); openRejectModal({ kind: "doc", docId: doc.id, label: item.label, initialFeedback: doc.feedback ?? "" }); }}
                                                disabled={saving[doc.id]}
                                                className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                                style={{ color: "var(--danger)" }}>
                                                <XCircle size={11} strokeWidth={1.8} /> {lang === "fr" ? "Refuser" : lang === "de" ? "Ablehnen" : "Reject"}
                                              </button>
                                            )}
                                            {doc.status === "approved" && (
                                              <button
                                                onClick={(e) => { e.stopPropagation(); setRevokeMenu(null); openRejectModal({ kind: "doc", docId: doc.id, label: item.label, initialFeedback: doc.feedback ?? "" }); }}
                                                disabled={saving[doc.id]}
                                                className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                                style={{ color: "var(--danger)" }}>
                                                <RotateCcw size={11} strokeWidth={1.8} /> Revoke
                                              </button>
                                            )}
                                      </DropdownMenu>
                                    </div>
                                  )}
                                </div>
                              )}

                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>

                  {/* Upload history section — shown when 📁 history button clicked */}
                  {showHistory && (() => {
                    const historyForUser = docHistory
                      .filter(d => d.user_id === selectedUser)
                      .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
                    if (historyForUser.length === 0) return null;
                    return (
                      <div className="rounded-2xl overflow-hidden mt-4"
                        style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
                        <div className="px-5 py-3 flex items-center gap-2"
                          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
                          <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: "var(--w2)" }}><Folder size={12} strokeWidth={1.7} /> Upload History — older versions replaced by candidate</span>
                        </div>
                        {historyForUser.map((d, idx) => {
                          const st = d.status;
                          const stBg = st === "approved" ? "var(--success-bg)" : st === "rejected" ? "var(--danger-bg)" : "var(--gdim)";
                          const stCl = st === "approved" ? "var(--success)" : st === "rejected" ? "var(--danger)" : "var(--gold)";
                          return (
                            <div key={d.id}>
                              {idx > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                              <div className="px-5 py-3 flex items-center gap-3">
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0"
                                  style={{ background: stBg, color: stCl, border: `1px solid ${stCl}30` }}>
                                  {st === "approved" ? <CheckCircle2 size={10} strokeWidth={2} />
                                    : st === "rejected" ? <XCircle size={10} strokeWidth={2} />
                                    : <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />}
                                  {st}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs truncate" style={{ color: "var(--w2)" }}>{d.file_name}</p>
                                  <p className="text-[10px]" style={{ color: "var(--w3)" }}>{d.file_type} · {fmtDate(d.uploaded_at)}</p>
                                </div>
                                {d.drive_file_id && (
                                  <button onClick={() => setPreviewDoc(d)} title="Preview"
                                    className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 bv-touch"
                                    style={{ color: "var(--w3)" }}>
                                    <Eye size={12} strokeWidth={1.8} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                </div>
                )}
              </div>{/* end flex-1 main content */}
            </div>{/* end flex two-column */}

          </div>
        </main>

        {/* ── Delete candidate confirmation modal ── */}
        {deleteCandidateConfirm && typeof window !== "undefined" && createPortal(
          <>
            <div className="fixed inset-0 z-[9999] bg-black/40 backdrop-blur-sm bv-modal-outer" onClick={() => !deletingCandidate && setDeleteCandidateConfirm(false)} />
            <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 pb-[88px] sm:pb-4 bv-modal-outer">
              <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4 overflow-y-auto"
                style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                         maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)" }}>
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center mb-1"
                    style={{ background: "var(--danger-bg)" }}>
                    <Trash2 size={22} strokeWidth={1.6} style={{ color: "var(--danger)" }} />
                  </div>
                  <p className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>Delete candidate?</p>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--w3)" }}>
                    This will permanently remove all data for <strong style={{ color: "var(--w)" }}>{users[selectedUser]?.name ?? selectedUser}</strong> — documents, passport data, messages, and their account. Drive files will be archived.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11.5px] text-center" style={{ color: "var(--w3)" }}>Type <strong>DELETE</strong> to confirm</p>
                  <input
                    value={deleteCandidateInput}
                    onChange={e => setDeleteCandidateInput(e.target.value)}
                    placeholder="DELETE"
                    autoFocus
                    className="w-full text-center rounded-xl px-3 py-2.5 text-[13px] outline-none"
                    style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}
                    onKeyDown={e => { if (e.key === "Enter" && deleteCandidateInput === "DELETE") deleteCandidate(); }}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => !deletingCandidate && setDeleteCandidateConfirm(false)}
                    className="flex-1 rounded-xl py-2.5 text-[13px] font-medium transition-opacity hover:opacity-70"
                    style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                    Cancel
                  </button>
                  <button
                    onClick={deleteCandidate}
                    disabled={deleteCandidateInput !== "DELETE" || deletingCandidate}
                    className="flex-1 rounded-xl py-2.5 text-[13px] font-semibold transition-opacity"
                    style={{
                      background: deleteCandidateInput === "DELETE" && !deletingCandidate ? "var(--danger)" : "var(--danger-bg)",
                      color: "#fff", cursor: deleteCandidateInput !== "DELETE" || deletingCandidate ? "not-allowed" : "pointer",
                    }}>
                    {deletingCandidate ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}

      {/* ───── Hidden file inputs + slot/sig modals (also needed in candidate detail view) ───── */}
      <input
        ref={adminFileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: "none" }}
        onChange={e => {
          const file = e.target.files?.[0];
          const slotId = adminUploadTargetRef.current;
          if (file && slotId) adminUploadFile(file, slotId);
          e.target.value = "";
        }}
      />
      <input
        ref={sigManualFileRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: "none" }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const b64 = (reader.result as string).replace(/^data:[^;]+;base64,/, "");
            setSigManualPdf(b64);
            setSigPdfBase64(b64);
          };
          reader.readAsDataURL(file);
          e.target.value = "";
        }}
      />
      <input
        ref={sigAdminUploadRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            if (sigUploadTarget === "org") {
              setSigOrgSig(result);
            } else {
              setSigAdminSig(null);
              setSigAdminBgRemoving(true);
              Promise.all([removeImageBg(result), new Promise(r => setTimeout(r, 2200))])
                .then(([clean]) => { setSigAdminSig(clean); setSigAdminBgRemoving(false); });
            }
          };
          reader.readAsDataURL(file);
          e.target.value = "";
        }}
      />

      {/* ── Edit slot label modal (LAW #36) ── */}
      {editingSlotId && (
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
          onClick={() => setEditingSlotId(null)}>
          <div className="w-full max-w-md rounded-[20px] p-6 space-y-4"
            style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)", animation: "bvFadeRise .28s var(--ease-out)", maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}>
            <p className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>Edit slot label</p>
            <input type="text" placeholder="Label" value={editingSlotLabel}
              onChange={e => setEditingSlotLabel(e.target.value)} autoFocus
              className="w-full px-3 py-2.5 text-[13px] outline-none"
              style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--w)" }} />
            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditingSlotId(null)}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold transition-all"
                style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                Cancel
              </button>
              <button onClick={() => saveSlotLabel(editingSlotId!, editingSlotLabel, editingSlotLabelTrans, editingSlotInstructions)}
                disabled={!editingSlotLabel.trim()}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-40"
                style={{ background: "var(--gold)", color: "#131312" }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin signature setup sub-popup (LAW #29 + #34) ──────────────────
          Opens when admin checks "Admin signs" in the main popup but has no
          saved signature yet. Photo upload → Otsu bg removal → confirm/redo.
          On confirm, persists globally and re-enters the placement chain. */}
      {adminSigSubPopup && (() => {
        const sub = adminSigSubPopup;
        const slot = Object.values(phaseSlots).flat().find(s => s.id === sub.slotId);
        // LAW #36 universal popup
        return (
          <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
            onClick={() => !adminSigUploading && setAdminSigSubPopup(null)}>
            <div className="w-full max-w-sm rounded-[20px] p-5 space-y-3"
              onClick={e => e.stopPropagation()}
              style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)", animation: "bvFadeRise .28s var(--ease-out)", maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)", overflowY: "auto" }}>
              <div>
                <p className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>Your signature</p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>
                  Upload a photo of your handwritten signature. We&apos;ll scan and clean it automatically. Saved for reuse on every PDF.
                </p>
              </div>
              <div className="rounded-xl p-3 flex items-center justify-center"
                style={{ background: "var(--bg2)", border: "1.5px dashed var(--border-gold)", minHeight: 120 }}>
                {sub.pendingSig ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sub.pendingSig} alt="Signature preview" className="rounded"
                    style={{ background: "#fff", border: "1px solid var(--border)", objectFit: "contain", maxHeight: 100, maxWidth: "100%" }} />
                ) : adminSigUploading ? (
                  <p className="text-[11px]" style={{ color: "var(--gold)" }}>Scanning…</p>
                ) : (
                  <p className="text-[11px]" style={{ color: "var(--w3)" }}>No photo selected yet</p>
                )}
              </div>
              <input ref={adminSigUploadRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  e.target.value = "";
                  setAdminSigUploading(true);
                  try {
                    const dataUri = await new Promise<string>((resolve, reject) => {
                      const r = new FileReader();
                      r.onload = () => resolve(r.result as string);
                      r.onerror = reject;
                      r.readAsDataURL(file);
                    });
                    const cleaned = await removeImageBg(dataUri);
                    setAdminSigSubPopup(prev => prev ? { ...prev, pendingSig: cleaned } : prev);
                  } finally {
                    setAdminSigUploading(false);
                  }
                }} />
              <div className="flex gap-2">
                <button type="button" onClick={() => adminSigUploadRef.current?.click()} disabled={adminSigUploading}
                  className="flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-40"
                  style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
                  {sub.pendingSig ? "Redo" : "📷 Upload"}
                </button>
                <button type="button"
                  disabled={!sub.pendingSig || adminSigUploading}
                  onClick={async () => {
                    if (!sub.pendingSig) return;
                    // Persist to backend
                    await fetch("/api/portal/admin/me/signature", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                      body: JSON.stringify({ signature: sub.pendingSig }),
                    });
                    setAdminSavedSig(sub.pendingSig);
                    setAdminSigSubPopup(null);
                    // Continue the placement chain.
                    // LAW #30 Mode 1: skip the fields step when the PDF already
                    // carries native AcroForm fields — the candidate types into
                    // them directly, no box-drawing needed.
                    if (slot && slot.template_pdf_path) {
                      await openPlacementWizard(sub.slotId, {
                        admin: slot.admin_signs,
                        candidate: slot.candidate_signs,
                      });
                    }
                  }}
                  className="flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-40"
                  style={{ background: "var(--gold)", color: "#131312" }}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Placement wizard modal — signature placement only ────────────────
          Drawing form-field boxes was removed; native AcroForm PDFs are
          handled by AutoFillReviewModal at upload time. The wizard now only
          places admin / candidate signature zones. */}
      {placementWizard && (() => {
        const wz = placementWizard;
        const currentStep = wz.steps[wz.stepIdx];
        const isLast = wz.stepIdx === wz.steps.length - 1;
        const hintByStep: Record<WizardStep, string> = {
          admin_sig: lang === "de"
            ? "Scrollen Sie zur Unterschriftsstelle und zeichnen Sie einen Bereich."
            : lang === "fr"
            ? "Faites défiler jusqu'à l'endroit de la signature, puis tracez un cadre."
            : "Scroll to where you want to sign, then draw a box.",
          candidate_sig: lang === "de"
            ? "Zeichnen Sie einen Bereich, wo der Kandidat unterschreiben soll."
            : lang === "fr"
            ? "Tracez un cadre à l'endroit où le candidat doit signer."
            : "Draw a box where the candidate should sign.",
        };
        void hintByStep;
        const partyForStep: Record<WizardStep, "admin" | "candidate"> = {
          admin_sig: "admin", candidate_sig: "candidate",
        };
        const currentZone = currentStep === "admin_sig" ? wz.adminSigZone
                          : currentStep === "candidate_sig" ? wz.candidateSigZone
                          : null;

        async function onSubmitFinal() {
          if (placementSubmitting) return;
          setPlacementSubmitting(true);
          try {
            // Start from the original PDF bytes.
            const rawBytes = Uint8Array.from(atob(wz.pdfB64), c => c.charCodeAt(0));
            const initBuf = new ArrayBuffer(rawBytes.byteLength);
            new Uint8Array(initBuf).set(rawBytes);
            let pdfBytes: Uint8Array = new Uint8Array(initBuf);

            // Stamp admin's signature on top of the PDF.
            if (wz.adminSigZone && adminSavedSig) {
              pdfBytes = await stampSigOnPdf(pdfBytes, adminSavedSig, [wz.adminSigZone]);
            }

            // Upload modified PDF as new slot template if admin signed.
            if (wz.adminSigZone && adminSavedSig) {
              const ab = new ArrayBuffer(pdfBytes.byteLength);
              new Uint8Array(ab).set(pdfBytes);
              const fd = new FormData();
              fd.append("file", new Blob([ab], { type: "application/pdf" }), "template.pdf");
              fd.append("slotId", wz.slotId);
              await fetch("/api/portal/admin/slot-template", {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}` },
                body: fd,
              });
            }

            // Save candidate sig zone on the slot for the candidate-side flow.
            await fetch("/api/portal/phase-slots", {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({
                id: wz.slotId,
                candidate_signature_zone: wz.candidateSigZone,
              }),
            });

            setPhaseSlots(prev => {
              const updated: typeof prev = {};
              for (const [ph, slots] of Object.entries(prev)) {
                updated[ph] = (slots ?? []).map(s => s.id === wz.slotId
                  ? { ...s, candidate_signature_zone: wz.candidateSigZone }
                  : s);
              }
              return updated;
            });

            // Bell notifications: candidate learns the slot is ready when they
            // need to sign.
            const needsSign = !!wz.candidateSigZone;
            if (needsSign && selectedUser) {
              const slotLabel = Object.values(phaseSlots).flat().find(s => s.id === wz.slotId)?.label ?? "Document";
              await fetch("/api/portal/admin/phase-slots/notify", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                body: JSON.stringify({ slotId: wz.slotId, candidateUserId: selectedUser, slotLabel, needsSign, needsFill: false }),
              }).catch(err => console.warn("[wizard notify] non-fatal:", err));
            }

            setPlacementWizard(null);
          } catch (err) {
            console.error("[placement submit] error:", err);
            showError("Could not save PDF changes.");
          } finally {
            setPlacementSubmitting(false);
          }
        }

        return (
          // LAW #36 universal popup geometry — identical to candidate fillForm /
          // slot config / AdminDocPreviewModal: top-[58px] clears the global
          // navbar, pb-[88px] clears the mobile bottom nav.
          <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-stretch sm:items-center justify-center p-2 sm:p-4 pb-[88px] sm:pb-4"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
            onClick={() => { if (!placementSubmitting) setPlacementWizard(null); }}>
            {/* Card — same shape language as AdminDocPreviewModal so every PDF
                on the site looks like it lives in the same container. */}
            <div className="w-full sm:max-w-4xl flex flex-col overflow-hidden relative"
              onClick={e => e.stopPropagation()}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 20,
                boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
                // height: 100% locks the card to the wizard outer's available
                // size — without it, the card auto-grows when the PdfViewer
                // canvases re-render at higher zoom, which pushes the frame
                // off the viewport on big-zoom scrolls.
                height: "100%",
                maxHeight: "100%",
                animation: "bvFadeRise 0.24s var(--ease-out)",
                // Browser-level pinch shouldn't drag the card around — PdfViewer
                // handles wheel/pinch zoom on its own internal pages wrapper.
                touchAction: "pan-x pan-y",
              }}>
            {/* Header — matches AdminDocPreviewModal: uppercase eyebrow + title. */}
            <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="min-w-0 flex items-center gap-3">
                <div className="flex items-center justify-center text-[11px] font-bold tracking-tight flex-shrink-0"
                  style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: 999, width: 26, height: 26 }}>
                  {wz.stepIdx + 1}
                </div>
                <div className="min-w-0">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-0.5" style={{ color: "var(--w3)" }}>
                    {lang === "de" ? `Schritt ${wz.stepIdx + 1} / ${wz.steps.length}`
                     : lang === "fr" ? `Étape ${wz.stepIdx + 1} / ${wz.steps.length}`
                     : `Step ${wz.stepIdx + 1} / ${wz.steps.length}`}
                  </p>
                  <p className="text-[13.5px] font-semibold truncate tracking-tight" style={{ color: "var(--w)" }}>
                    {currentStep === "admin_sig"
                      ? (lang === "de" ? "Ihre Unterschrift" : lang === "fr" ? "Votre signature" : "Your signature")
                      : (lang === "de" ? "Unterschrift des Kandidaten" : lang === "fr" ? "Signature du candidat" : "Candidate's signature")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Submit / Next — header-anchored on every viewport (same idiom
                    as the candidate fillForm modal). Sits immediately left of X. */}
                <button
                  disabled={placementSubmitting || (currentStep === "admin_sig" || currentStep === "candidate_sig" ? !currentZone : false)}
                  onClick={() => {
                    if (isLast) {
                      onSubmitFinal();
                    } else {
                      setPlacementWizard(prev => prev ? { ...prev, stepIdx: prev.stepIdx + 1 } : prev);
                    }
                  }}
                  className="text-[11.5px] font-semibold px-3 py-1.5 rounded-xl disabled:opacity-40 transition-opacity hover:opacity-95"
                  style={{ background: "var(--gold)", color: "#131312" }}>
                  {placementSubmitting
                    ? "…"
                    : isLast
                      ? (lang === "de" ? "Einreichen" : lang === "fr" ? "Soumettre" : "Submit")
                      : (lang === "de" ? "Weiter →" : lang === "fr" ? "Suivant →" : "Next →")}
                </button>
                <button onClick={() => setPlacementWizard(null)} disabled={placementSubmitting}
                  aria-label="Close"
                  className="bv-icon-btn w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity hover:opacity-70"
                  style={{ color: "var(--w2)" }}>
                  <XIcon size={16} strokeWidth={1.8} />
                </button>
              </div>
            </div>
            {/* PDF body — full-bleed flex column so pickers fill all available height */}
            <div className="flex-1 relative overflow-hidden p-3" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* Hint is rendered internally by PdfZonePicker (grey chip). */}
              <PdfZonePicker
                key={currentStep /* re-mount on step change so initialZones reseeds */}
                pdfBase64={wz.pdfB64}
                fullHeight
                defaultParty={partyForStep[currentStep]}
                partyPreviews={currentStep === "admin_sig" && adminSavedSig ? { admin: adminSavedSig } : undefined}
                initialZones={
                  currentStep === "candidate_sig" && wz.candidateSigZone
                    ? [wz.candidateSigZone]
                    : undefined
                }
                onChange={zones => {
                  // Single zone only for sig steps — keep the most recent.
                  const lastZone = zones[zones.length - 1] ?? null;
                  setPlacementWizard(prev => prev
                    ? currentStep === "admin_sig"
                      ? { ...prev, adminSigZone: lastZone }
                      : { ...prev, candidateSigZone: lastZone }
                    : prev);
                }}
              />
            </div>
            </div>{/* end card */}
          </div>
        );
      })()}

      {/* ── Signature request modal ── */}
      {sigModal && (
        <div data-bv-sigmodal="1" className="fixed inset-0 z-[2147483600] flex items-center justify-center p-3 sm:p-6"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
          onClick={() => { setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null); setSigAdminSig(null); setSigAdminWantSave(true); setSigOrgSig(null); setSigOrgWantSave(true); }}>
          <div className="w-full max-w-4xl rounded-2xl overflow-hidden flex flex-col"
            style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", maxHeight: "calc(100dvh - 80px)" }}
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3.5 flex items-center justify-between flex-shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="min-w-0 flex-1 mr-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-0.5" style={{ color: "var(--w3)" }}>
                  {lang === "fr" ? "Signature" : lang === "de" ? "Signatur" : "Signature"}
                </p>
                <input
                  value={sigModal.label}
                  onChange={e => setSigModal(prev => prev ? { ...prev, label: e.target.value } : prev)}
                  className="text-[13.5px] font-semibold tracking-tight bg-transparent border-none outline-none w-full min-w-0"
                  style={{ color: "var(--w)" }}
                />
              </div>
              {/* Mode toggle */}
              <div className="flex flex-shrink-0 mx-3 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg2)" }}>
                {([["admin-only", lang === "fr" ? "Admin seul" : lang === "de" ? "Admin" : "Admin only"], ["with-candidate", lang === "fr" ? "+ Candidat" : lang === "de" ? "+ Kandidat" : "+ Candidate"]] as [string, string][]).map(([mode, label]) => (
                  <button key={mode} onClick={() => setSigMode(mode as "admin-only" | "with-candidate")}
                    className="px-3 py-1.5 text-[11px] font-semibold transition-colors"
                    style={{ background: sigMode === mode ? "var(--gold)" : "transparent", color: sigMode === mode ? "#131312" : "var(--w3)", borderRight: mode === "admin-only" ? "1px solid var(--border)" : "none" }}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={() => { setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null); setSigAdminSig(null); setSigAdminWantSave(true); setSigOrgSig(null); setSigOrgWantSave(true); }}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ color: "var(--w3)" }}>
                <XIcon size={14} strokeWidth={1.8} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {sigPdfLoading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-3">
                  <Spinner size="md" />
                  <p className="text-[12px]" style={{ color: "var(--w3)" }}>
                    {lang === "fr" ? "Chargement du PDF…" : lang === "de" ? "PDF wird geladen…" : "Loading PDF…"}
                  </p>
                </div>
              ) : sigPdfBase64 ? (
                <div className="p-3">
                  <PdfZonePicker pdfBase64={sigPdfBase64} onChange={zones => setSigZones(zones)}
                    onError={() => { setSigPdfBase64(null); setSigManualPdf(null); }}
                    defaultParty={sigMode === "admin-only" ? "admin" : "candidate"}
                    partyPreviews={sigAdminSig ? { admin: sigAdminSig } : undefined}
                    partyBgRemoving={sigAdminBgRemoving ? { admin: true } : undefined}
                    onPartyImageCrop={(_, dataUri) => setSigAdminSig(dataUri)} />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4 m-4 rounded-2xl cursor-pointer transition-colors"
                  style={{ minHeight: 280, border: "2.5px dashed var(--border-gold)", background: "var(--gdim)" }}
                  onClick={() => sigManualFileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = "rgba(201,162,64,0.18)"; }}
                  onDragLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--gdim)"; }}
                  onDrop={e => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).style.background = "var(--gdim)";
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const b64 = (reader.result as string).replace(/^data:[^;]+;base64,/, "");
                      setSigManualPdf(b64); setSigPdfBase64(b64);
                    };
                    reader.readAsDataURL(file);
                  }}>
                  <Upload size={36} strokeWidth={1.5} style={{ color: "var(--gold)", opacity: 0.7 }} />
                  <div className="text-center space-y-1 px-6">
                    <p className="text-[14px] font-semibold" style={{ color: "var(--gold)" }}>
                      {lang === "fr" ? "Déposez le PDF ici" : lang === "de" ? "PDF hier ablegen" : "Drop the PDF here"}
                    </p>
                    <p className="text-[12px]" style={{ color: "var(--w3)" }}>
                      {lang === "fr" ? "ou cliquez pour sélectionner" : lang === "de" ? "oder klicken zum Auswählen" : "or click to select"}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: "var(--w3)", opacity: 0.7 }}>
                      {lang === "fr" ? "Le PDF que le candidat devra signer" : lang === "de" ? "Das zu unterschreibende Dokument" : "The document the candidate needs to sign"}
                    </p>
                  </div>
                  <button type="button" onClick={e => { e.stopPropagation(); sigManualFileRef.current?.click(); }}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[13px] font-semibold transition-opacity hover:opacity-80"
                    style={{ background: "var(--gold)", color: "#131312" }}>
                    <Upload size={13} strokeWidth={2} />
                    {lang === "fr" ? "Choisir un PDF" : lang === "de" ? "PDF auswählen" : "Choose PDF"}
                  </button>
                </div>
              )}
            </div>
            {/* ── Sticky sig section (admin — covers org + supreme admin zones) ── */}
            {sigPdfBase64 && (
              <div className="flex-shrink-0 px-3 pt-3 pb-1" style={{ borderTop: "1px solid var(--border)" }}>
                <AdminSigSection party="admin" lang={lang}
                  sig={sigAdminSig} wantSave={sigAdminWantSave} bgRemoving={sigAdminBgRemoving}
                  onSig={setSigAdminSig} onWantSave={setSigAdminWantSave}
                  onUpload={() => { setSigUploadTarget("admin"); sigAdminUploadRef.current?.click(); }}
                  onDropFile={file => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = reader.result as string;
                      setSigAdminSig(null);
                      setSigAdminBgRemoving(true);
                      Promise.all([removeImageBg(result), new Promise(r => setTimeout(r, 2200))])
                        .then(([clean]) => { setSigAdminSig(clean); setSigAdminBgRemoving(false); });
                    };
                    reader.readAsDataURL(file);
                  }}
                />

              </div>
            )}
            <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="flex gap-2">
                {sigMode === "with-candidate" && (
                  <input value={sigNote} onChange={e => setSigNote(e.target.value)}
                    placeholder={lang === "fr" ? "Note (optionnel)" : lang === "de" ? "Hinweis (optional)" : "Note (optional)"}
                    className="flex-1 px-3 py-2 text-[12px] rounded-xl outline-none"
                    style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--w)" }} />
                )}
                {sigMode === "admin-only" ? (() => {
                  const hasPdf = !!(sigPdfBase64 || sigManualPdf);
                  const spin = <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />;
                  const doSubmit = async (action: "save" | "download") => {
                    if (sigSending) return;
                    if (!hasPdf) { sigManualFileRef.current?.click(); return; }
                    setSigSending(true);
                    const parties = { admin: sigZones.some(z => z.party === "admin"), candidate: sigZones.some(z => z.party === "candidate") };
                    try {
                      let res: Response;
                      if (sigManualPdf) {
                        const fd = new FormData();
                        if (action === "save") fd.append("candidateId", selectedUser ?? "");
                        fd.append("documentName", sigModal.label);
                        fd.append(action === "download" ? "adminOnly" : "adminSave", "true");
                        const bin = atob(sigManualPdf); const arr = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                        fd.append("pdf", new Blob([arr], { type: "application/pdf" }), "signature-document.pdf");
                        fd.append("parties", JSON.stringify(parties));
                        if (sigZones.length) fd.append("signatureZones", JSON.stringify(sigZones));
                        if (sigAdminSig) { fd.append("adminSignatureBase64", sigAdminSig); fd.append("orgSignatureBase64", sigAdminSig); }
                        res = await fetch("/api/portal/admin/sign-request", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: fd });
                      } else {
                        res = await fetch("/api/portal/admin/sign-request", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                          body: JSON.stringify({ candidateId: action === "save" ? selectedUser : undefined, documentName: sigModal.label, driveFileId: sigModal.driveFileId, adminOnly: action === "download", adminSave: action === "save", parties, signatureZones: sigZones.length ? sigZones : undefined, adminSignatureBase64: sigAdminSig || undefined, orgSignatureBase64: sigAdminSig || undefined }),
                        });
                      }
                      if (res.ok) {
                        if (action === "download") {
                          if (isIOSDevice()) {
                            // Server stashed it at admin-dl/<userId>.pdf. iOS
                            // needs a FRESH tap to download (a download after
                            // this await is blocked), so surface a button.
                            setIosSignedDl({
                              url: `/api/portal/admin/sign-request?adminDownload=1&name=${encodeURIComponent(sigModal.label + ".pdf")}&access_token=${encodeURIComponent(accessToken)}`,
                              name: `${sigModal.label}.pdf`,
                            });
                            setSigSending(false);
                            return;
                          }
                          const blob = await res.blob(); const url = URL.createObjectURL(blob);
                          const a = document.createElement("a"); a.href = url; a.download = `${sigModal.label}.pdf`; a.click(); URL.revokeObjectURL(url);
                          showError(lang === "fr" ? "PDF téléchargé ✓" : lang === "de" ? "PDF heruntergeladen ✓" : "Signed PDF downloaded ✓");
                        } else {
                          showError(lang === "fr" ? "PDF enregistré ✓" : lang === "de" ? "PDF gespeichert ✓" : "Signed PDF saved ✓");
                        }
                        setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null);
                        setSigAdminSig(null); setSigAdminWantSave(true); setSigOrgSig(null); setSigOrgWantSave(true);
                      } else {
                        const j = await res.json().catch(() => ({}));
                        showError(`${action === "download" ? "Download" : "Save"} failed: ${(j as { error?: string }).error ?? `HTTP ${res.status}`}`);
                      }
                    } catch (e) { showError(`Error: ${e instanceof Error ? e.message : String(e)}`); }
                    setSigSending(false);
                  };
                  return (
                    <>
                      <button onClick={() => doSubmit("save")} disabled={sigSending || !selectedUser || !hasPdf}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-opacity disabled:opacity-40"
                        style={{ background: "var(--gold)", color: "#131312" }}>
                        {sigSending ? spin : <><SaveIcon size={13} strokeWidth={2} /> {lang === "fr" ? "Sauvegarder" : lang === "de" ? "Speichern" : "Save"}</>}
                      </button>
                      {iosSignedDl ? (
                        <button
                          onClick={() => {
                            // Fresh user gesture → iOS download now works.
                            triggerIosDownload(iosSignedDl.url, iosSignedDl.name);
                            setIosSignedDl(null);
                            setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null);
                            setSigAdminSig(null); setSigAdminWantSave(true); setSigOrgSig(null); setSigOrgWantSave(true);
                          }}
                          className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold"
                          style={{ background: "var(--gold)", color: "#131312" }}>
                          <Download size={13} strokeWidth={2} /> {lang === "fr" ? "Appuyez pour enregistrer" : lang === "de" ? "Tippen zum Speichern" : "Tap to save PDF"}
                        </button>
                      ) : (
                      <button onClick={() => doSubmit("download")} disabled={sigSending || !hasPdf}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-opacity disabled:opacity-40"
                        style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
                        {sigSending ? spin : <><Download size={13} strokeWidth={2} /> {lang === "fr" ? "Télécharger" : lang === "de" ? "Herunterladen" : "Download"}</>}
                      </button>
                      )}
                    </>
                  );
                })() : (
                  <button onClick={async () => {
                    if (sigSending) return;
                    if (!sigPdfBase64 && !sigManualPdf) { sigManualFileRef.current?.click(); return; }
                    setSigSending(true);
                    const parties = { admin: sigZones.some(z => z.party === "admin"), candidate: sigZones.some(z => z.party === "candidate") };
                    try {
                      let res: Response;
                      if (sigManualPdf) {
                        const fd = new FormData();
                        fd.append("candidateId", selectedUser ?? ""); fd.append("documentName", sigModal.label);
                        const bin = atob(sigManualPdf); const arr = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                        fd.append("pdf", new Blob([arr], { type: "application/pdf" }), "signature-document.pdf");
                        if (sigNote.trim()) fd.append("note", sigNote.trim());
                        fd.append("parties", JSON.stringify(parties));
                        if (sigZones.length) fd.append("signatureZones", JSON.stringify(sigZones));
                        if (sigAdminSig) { fd.append("adminSignatureBase64", sigAdminSig); fd.append("orgSignatureBase64", sigAdminSig); }
                        res = await fetch("/api/portal/admin/sign-request", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: fd });
                      } else {
                        res = await fetch("/api/portal/admin/sign-request", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                          body: JSON.stringify({ candidateId: selectedUser, documentName: sigModal.label, driveFileId: sigModal.driveFileId, note: sigNote.trim() || undefined, parties, signatureZones: sigZones.length ? sigZones : undefined, adminSignatureBase64: sigAdminSig || undefined, orgSignatureBase64: sigAdminSig || undefined }),
                        });
                      }
                      if (res.ok) {
                        showError(lang === "fr" ? "Demande envoyée ✓" : lang === "de" ? "Anfrage gesendet ✓" : "Request sent ✓");
                        setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null);
                        setSigAdminSig(null); setSigAdminWantSave(true); setSigOrgSig(null); setSigOrgWantSave(true);
                      } else {
                        const j = await res.json().catch(() => ({}));
                        showError(`Send failed: ${(j as { error?: string }).error ?? `HTTP ${res.status}`}`);
                      }
                    } catch (e) { showError(`Error: ${e instanceof Error ? e.message : String(e)}`); }
                    setSigSending(false);
                  }}
                    disabled={sigSending}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: (!sigPdfBase64 && !sigManualPdf && !sigPdfLoading) ? "var(--bg2)" : "var(--gold)", color: (!sigPdfBase64 && !sigManualPdf && !sigPdfLoading) ? "var(--w3)" : "#131312", border: (!sigPdfBase64 && !sigManualPdf && !sigPdfLoading) ? "1px solid var(--border)" : "none" }}>
                    {sigSending
                      ? <><span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> {lang === "fr" ? "En cours…" : lang === "de" ? "Lädt…" : "Working…"}</>
                      : (!sigPdfBase64 && !sigManualPdf && !sigPdfLoading)
                        ? <><Upload size={13} strokeWidth={2} /> {lang === "fr" ? "PDF requis" : lang === "de" ? "PDF erforderlich" : "Upload PDF first"}</>
                        : <><Send size={13} strokeWidth={2} /> {lang === "fr" ? "Envoyer" : lang === "de" ? "Senden" : "Send"}</>
                    }
                  </button>
                )}
                <button onClick={() => { setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null); }}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl transition-opacity hover:opacity-70"
                  style={{ background: "var(--card)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                  <XIcon size={14} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject feedback popup — MUST be rendered in the candidate-detail
          return too (it was only in the list return, so the inline ✗ / ⋯
          "Reject" in the dossier set state but the popup never mounted until
          you navigated back). Portaled component, so this is safe here. */}
      {rejectTarget && (
        <AdminRejectModal
          target={{ label: rejectTarget.label, initialFeedback: rejectTarget.initialFeedback }}
          onCancel={closeRejectModal}
          onSubmit={(text, shot) => submitReject(text, shot)}
        />
      )}
      </>
    );
  }

  // ── CANDIDATE LIST VIEW ───────────────────────────────────────────────────────
  return (
    <>
      {previewDoc && (
          <AdminDocPreviewModal
            doc={previewDoc}
            accessToken={accessToken}
            onClose={() => { setPreviewDoc(null); setShowPassportInfo(false); }}
            noPreviewText={t.aNoPreview}
            onUpdated={(d) => setDocs(prev => prev.map(x => x.id === d.id ? { ...x, status: d.status, feedback: d.feedback } : x))}
            onShowPassportData={() => setShowPassportInfo(true)}
            sideBySide={
              /pass/i.test(previewDoc.file_type)
              && showPassportInfo
              // Fully approved (PDF + data both green) → data pops centered
              // ON TOP, never docked side-by-side.
              && !(previewDoc.status === "approved"
                   && profiles[previewDoc.user_id]?.passport_status === "approved")
            }
          />
        )}
      {mergePreview && (
        <AdminDocPreviewModal
          doc={{
            id: mergePreview.origDocId,
            user_id: "",
            file_name: `${mergePreview.label.replace(/\s+/g, "_")}_merged.pdf`,
            file_type: mergePreview.label,
            uploaded_at: new Date().toISOString(),
            status: "pending",
            feedback: null,
            drive_file_id: null,
          }}
          accessToken={accessToken}
          overrideFetchUrl={`/api/portal/documents/merge-pdf?origDocId=${mergePreview.origDocId}&transDocId=${mergePreview.transDocId}`}
          onClose={() => setMergePreview(null)}
          noPreviewText={t.aNoPreview}
        />
      )}
      <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
        <PortalTopNav />
        <div className="max-w-[780px] mx-auto px-4 pt-8 pb-16">

          {/* Header */}
          <div className="mb-5 text-center">
            <span
              className="font-[family-name:var(--font-dm-serif)] italic"
              style={{ fontSize: "clamp(1.6rem,5vw,2rem)", color: "var(--w)", letterSpacing: "-0.01em" }}>
              Borivon<span style={{ color: "var(--gold)" }} className="not-italic">.</span>
            </span>
          </div>

          {/* Search + filter row — works on the full candidate list (pending + archived combined) */}
          {(pendingUserIds.length + archivedUserIds.length) > 0 && (() => {
            const all = [...pendingUserIds, ...archivedUserIds];
            const HOUR = 60 * 60 * 1000;
            const stuckCount = all.filter(uid => {
              const docs = grouped[uid];
              if (!docs?.length) return false;
              const recent = Math.max(...docs.map(d => new Date(d.uploaded_at).getTime()));
              return docs.some(d => d.status === "pending") && (Date.now() - recent) / HOUR >= 7 * 24;
            }).length;
            const clearCount = archivedUserIds.length;
            const pendingCount = pendingUserIds.length;
            return (
              <div className="mb-3">
                <div className="relative">
                  <Search size={11} strokeWidth={1.8}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: "var(--w3)" }} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t.adSearchPh}
                    className="w-full pl-7 pr-7 outline-none transition-colors placeholder:opacity-40"
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      color: "var(--w)",
                      borderRadius: "8px",
                      height: "32px",
                      fontSize: "13px",
                    }} />
                </div>
              </div>
            );
          })()}

          {/* Pending candidates */}
          {(() => {
            // Apply search + filter
            const HOUR = 60 * 60 * 1000;
            const q = searchQuery.trim().toLowerCase();
            const matchesSearch = (uid: string) => {
              if (!q) return true;
              const u = users[uid] ?? { name: "", email: "" };
              return (u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
            };
            const isStuck = (uid: string) => {
              const recent = Math.max(...grouped[uid].map(d => new Date(d.uploaded_at).getTime()));
              return grouped[uid].some(d => d.status === "pending") && (Date.now() - recent) / HOUR >= 7 * 24;
            };

            let visibleIds: string[];
            if (filterMode === "all")          visibleIds = [...pendingUserIds, ...archivedUserIds];
            else if (filterMode === "pending") visibleIds = pendingUserIds;
            else if (filterMode === "stuck")   visibleIds = pendingUserIds.filter(isStuck);
            else                                visibleIds = archivedUserIds;
            visibleIds = visibleIds.filter(matchesSearch);

            if (visibleIds.length === 0) {
              if (q) {
                return <EmptyState Icon={Search} title={t.adNoCandFound} sub={t.adNoMatchFor.replace("{q}", searchQuery)} />;
              }
              if (filterMode === "stuck") {
                return <EmptyState Icon={CheckCircle2} tone="success" title={t.adNothingStuck} sub={t.adNoStuckSub} />;
              }
              return <EmptyState Icon={CheckCircle2} tone="success" title={t.aNothingTitle} sub={t.aNothing} />;
            }

            return (
            <div className="bv-enter-stagger" style={{ borderTop: "1px solid var(--border)" }}>
              {visibleIds.map(uid => {
                const allDocs    = grouped[uid] ?? [];
                const pendingDocs = allDocs.filter(d => d.status === "pending");
                const pendingCnt = pendingDocs.length;
                const isClear    = pendingCnt === 0;
                const user       = users[uid] ?? { name: uid, email: uid };
                const mostRecent = allDocs.length > 0
                  ? pendingDocs.reduce((latest, d) => new Date(d.uploaded_at) > new Date(latest) ? d.uploaded_at : latest, allDocs[0].uploaded_at)
                  : "";
                const isExpanded = expandedRow === uid;
                const openPanel = () => { setSelectedUser(uid); setActivePhase(0); setPassportDataFeedback(profiles[uid]?.passport_feedback ?? ""); window.scrollTo({ top: 0, behavior: "smooth" }); };

                return (
                  <div key={uid}
                    className="bv-row group transition-colors"
                    style={{ borderBottom: "1px solid var(--border)" }}>
                    <div role="button" tabIndex={0}
                      onClick={openPanel}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel(); } }}
                      className="bv-row-hover px-3 py-3 flex items-center gap-3 cursor-pointer transition-colors outline-none">

                      {profiles[uid]?.profile_photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={profiles[uid].profile_photo!} alt={user.name}
                          className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                          style={{ border: "1px solid var(--border-gold)" }} />
                      ) : (
                        <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{ background: "var(--gdim)", color: "var(--gold)" }}>
                          {user.name.charAt(0).toUpperCase()}
                        </span>
                      )}

                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-semibold truncate inline-flex items-center gap-0.5 flex-wrap" style={{ color: "var(--w)" }}>
                          {user.name}
                          <VerifiedBadge verified={!!profiles[uid]?.manually_verified} size="xs" color="gold" />
                        </p>
                        <p className="text-[11.5px] truncate mt-0.5" style={{ color: "var(--w3)" }}>
                          {user.email}
                          {(candidateOrgs[uid] ?? []).map(o => (
                            <span key={o.id}
                              className="ml-2 inline-block text-[10px] font-semibold uppercase tracking-wider px-1.5 py-px"
                              style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-sm)" }}>
                              {o.name}
                            </span>
                          ))}
                        </p>
                      </div>

                      {/* Pending tasks badge */}
                      {(() => {
                        const taskCnt = pendingCnt + (profiles[uid]?.passport_status === "pending" ? 1 : 0);
                        if (!taskCnt) return null;
                        return (
                          <span className="flex-shrink-0 text-[12px] font-bold" style={{ color: "#f59e0b" }}>
                            {taskCnt}
                          </span>
                        );
                      })()}

                      {/* Match-with-org chevron — always shown; gold if already matched */}
                      {(() => {
                        const orgs = candidateOrgs[uid] ?? [];
                        const isMatched = orgs.length > 0;
                        return (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isExpanded) { setExpandedRow(null); setRowDropdownPos(null); return; }
                              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              setRowDropdownPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
                              setExpandedRow(uid);
                            }}
                            aria-label="Match with org"
                            aria-expanded={isExpanded}
                            className="w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0"
                            style={{
                              color: isMatched ? "var(--gold)" : isExpanded ? "var(--w2)" : "var(--w3)",
                              background: isMatched ? "var(--gdim)" : "transparent",
                              border: isMatched ? "1px solid var(--border-gold)" : "none",
                              transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                              transition: "color var(--dur-2) var(--ease), transform var(--dur-2) var(--ease), background var(--dur-2) var(--ease)",
                            }}>
                            <ChevronDown size={14} strokeWidth={1.8} />
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
            );
          })()}

          {/* ── Tools strip — invite + agencies ── superadmin only ── */}
          {isSuperAdmin && (
            <div className="mt-4 mb-5 space-y-px" style={{ borderRadius: "var(--r-xl)", border: "1px solid var(--border)" }}>

              {/* Candidate invite row — generates a /join link that lands on
                  /portal/dashboard after signup. */}
              <div className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--card)", borderRadius: "var(--r-xl) var(--r-xl) 0 0" }}>
                <span className="flex-1 flex items-center gap-2"><User size={16} strokeWidth={1.6} style={{ color: "var(--w3)" }} /><span className="text-[12px]" style={{ color: "var(--w3)" }}>Invitation Link</span></span>
                {inviteUrl ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(inviteUrl).catch(() => {});
                        setInviteCopied(true);
                        setTimeout(() => setInviteCopied(false), 2500);
                      }}
                      className="flex-shrink-0 px-2.5 py-1 rounded-md text-[10.5px] font-semibold transition-opacity hover:opacity-80"
                      style={{ background: inviteCopied ? "var(--success-bg)" : "var(--gdim)", color: inviteCopied ? "var(--success)" : "var(--gold)", border: `1px solid ${inviteCopied ? "var(--success-border)" : "var(--border-gold)"}` }}>
                      {inviteCopied ? "✓" : t.adCopy}
                    </button>
                    <button onClick={() => setInviteUrl(null)}
                      className="flex-shrink-0 text-[10.5px] transition-opacity hover:opacity-70"
                      style={{ color: "var(--w3)", background: "none", border: "none" }}>
                      {t.adReset}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      setInviteGenerating(true);
                      try {
                        const res = await fetch("/api/portal/admin/invite-candidate", {
                          method: "POST",
                          headers: { Authorization: `Bearer ${accessToken}` },
                        });
                        const j = await res.json();
                        if (j.url) setInviteUrl(j.url);
                      } catch { /* ignore */ }
                      setInviteGenerating(false);
                    }}
                    disabled={inviteGenerating}
                    className="flex-shrink-0 inline-flex items-center justify-center px-3 py-1.5 text-[11px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-sm)" }}>
                    {inviteGenerating ? "…" : lang === "de" ? "Link generieren" : lang === "fr" ? "Générer" : "Generate"}
                  </button>
                )}
              </div>

              {/* Org-admin invite row — generates a /join link that lands on
                  /portal/org/dashboard after signup. Requires picking which
                  org the new admin will manage. */}
              <div className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--card)", borderTop: "1px solid var(--border)" }}>
                <span className="flex-1 flex items-center gap-2"><Building2 size={16} strokeWidth={1.6} style={{ color: "var(--w3)" }} /><span className="text-[12px]" style={{ color: "var(--w3)" }}>Invitation Link</span></span>
                {orgInviteUrl ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(orgInviteUrl).catch(() => {});
                        setOrgInviteCopied(true);
                        setTimeout(() => setOrgInviteCopied(false), 2500);
                      }}
                      className="flex-shrink-0 px-2.5 py-1 rounded-md text-[10.5px] font-semibold transition-opacity hover:opacity-80"
                      style={{ background: orgInviteCopied ? "var(--success-bg)" : "var(--gdim)", color: orgInviteCopied ? "var(--success)" : "var(--gold)", border: `1px solid ${orgInviteCopied ? "var(--success-border)" : "var(--border-gold)"}` }}>
                      {orgInviteCopied ? "✓" : t.adCopy}
                    </button>
                    <button onClick={() => { setOrgInviteUrl(null); setOrgInviteOrgId(""); }}
                      className="flex-shrink-0 text-[10.5px] transition-opacity hover:opacity-70"
                      style={{ color: "var(--w3)", background: "none", border: "none" }}>
                      {t.adReset}
                    </button>
                  </div>
                ) : (
                  <div className="relative flex-shrink-0">
                    {/* Backdrop to close dropdown on click-away */}
                    {orgInviteDropdown && (
                      <div className="fixed inset-0 z-[599]" onClick={() => setOrgInviteDropdown(false)} />
                    )}
                    <button
                      onClick={() => { if (allOrgs.length > 0) setOrgInviteDropdown(p => !p); }}
                      disabled={orgInviteGenerating || allOrgs.length === 0}
                      className="flex-shrink-0 inline-flex items-center justify-center px-3 py-1.5 text-[11px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                      style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-sm)" }}>
                      {orgInviteGenerating
                        ? "…"
                        : lang === "de" ? "Link generieren" : lang === "fr" ? "Générer" : "Generate"}
                    </button>
                    {orgInviteDropdown && (
                      <div className="absolute right-0 top-full mt-1 rounded-xl overflow-hidden"
                        style={{ zIndex: 600, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 180 }}>
                        {allOrgs.map(o => (
                          <button key={o.id}
                            onClick={async () => {
                              setOrgInviteDropdown(false);
                              setOrgInviteGenerating(true);
                              try {
                                const res = await fetch(`/api/portal/admin/organizations/${o.id}/generate-invite`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                                  body: JSON.stringify({ type: "member" }),
                                });
                                const j = await res.json();
                                if (j.url) setOrgInviteUrl(j.url);
                              } catch { /* ignore */ }
                              setOrgInviteGenerating(false);
                            }}
                            className="bv-row-hover w-full text-left px-3 py-2.5 text-[11.5px] font-medium"
                            style={{ color: "var(--w)" }}>
                            {o.name} <span style={{ color: "var(--w3)" }}>admin</span>
                          </button>
                        ))}
                        <button
                          onClick={() => { setOrgInviteDropdown(false); setNewOrgName(""); setNewOrgModal(true); }}
                          className="bv-row-hover w-full text-left px-3 py-2.5 text-[11.5px] font-medium inline-flex items-center gap-1.5"
                          style={{ color: "var(--w3)", borderTop: allOrgs.length > 0 ? "1px solid var(--border)" : undefined }}>
                          <Plus size={11} strokeWidth={2} /> New organization admin
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Sub-admin invite row */}
              <div className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--card)", borderTop: "1px solid var(--border)", borderRadius: "0 0 var(--r-xl) var(--r-xl)" }}>
                <span className="flex-1 flex items-center gap-2">
                  <User size={16} strokeWidth={1.6} style={{ color: "var(--w3)" }} />
                  <span className="text-[12px]" style={{ color: "var(--w3)" }}>Sub-admin Invitation Link</span>
                </span>
                {subAdminInviteUrl ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(subAdminInviteUrl).catch(() => {});
                        setSubAdminInviteCopied(true);
                        setTimeout(() => setSubAdminInviteCopied(false), 2500);
                      }}
                      className="flex-shrink-0 px-2.5 py-1 rounded-md text-[10.5px] font-semibold transition-opacity hover:opacity-80"
                      style={{ background: subAdminInviteCopied ? "var(--success-bg)" : "var(--gdim)", color: subAdminInviteCopied ? "var(--success)" : "var(--gold)", border: `1px solid ${subAdminInviteCopied ? "var(--success-border)" : "var(--border-gold)"}` }}>
                      {subAdminInviteCopied ? "✓" : t.adCopy}
                    </button>
                    <button onClick={() => setSubAdminInviteUrl(null)}
                      className="flex-shrink-0 text-[10.5px] transition-opacity hover:opacity-70"
                      style={{ color: "var(--w3)", background: "none", border: "none" }}>
                      {t.adReset}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      setSubAdminInviteGenerating(true);
                      try {
                        const res = await fetch("/api/portal/admin/invite-sub-admin", {
                          method: "POST",
                          headers: { Authorization: `Bearer ${accessToken}` },
                        });
                        const j = await res.json();
                        if (j.url) setSubAdminInviteUrl(j.url);
                      } catch { /* ignore */ }
                      setSubAdminInviteGenerating(false);
                    }}
                    disabled={subAdminInviteGenerating}
                    className="flex-shrink-0 inline-flex items-center justify-center px-3 py-1.5 text-[11px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-sm)" }}>
                    {subAdminInviteGenerating ? "…" : lang === "de" ? "Link generieren" : lang === "fr" ? "Générer" : "Generate"}
                  </button>
                )}
              </div>

          </div>
          )}

          {/* ── New-org modal (LAW #36) ── */}
          {newOrgModal && typeof window !== "undefined" && createPortal(
            <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
              style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
              onClick={() => !newOrgCreating && setNewOrgModal(false)}>
              <div className="w-full max-w-sm rounded-[20px] overflow-hidden"
                onClick={e => e.stopPropagation()}
                style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)", animation: "bvFadeRise .28s var(--ease-out)", maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)", overflowY: "auto" }}>
                  <div className="px-5 pt-5 pb-4">
                    <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--w)" }}>New organization</p>
                    <p className="text-[11.5px] mb-4" style={{ color: "var(--w3)" }}>Creates the org and generates an admin invite link.</p>
                    <input
                      autoFocus
                      value={newOrgName}
                      onChange={e => setNewOrgName(e.target.value)}
                      onKeyDown={async e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      placeholder="Organization name"
                      className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                      style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}
                    />
                  </div>
                  <div className="px-5 pb-5 flex gap-2">
                    <button
                      onClick={() => setNewOrgModal(false)}
                      disabled={newOrgCreating}
                      className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-opacity hover:opacity-70 disabled:opacity-40"
                      style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                      Cancel
                    </button>
                    <button
                      disabled={!newOrgName.trim() || newOrgCreating}
                      onClick={async () => {
                        const name = newOrgName.trim();
                        if (!name) return;
                        setNewOrgCreating(true);
                        try {
                          const createRes = await fetch("/api/portal/admin/organizations", {
                            method: "POST",
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                            body: JSON.stringify({ name }),
                          });
                          const createJ = await createRes.json();
                          if (!createJ.org) throw new Error(createJ.error ?? "Failed");
                          const newOrg: OrgBasic = { id: createJ.org.id, name: createJ.org.name };
                          setAllOrgs(prev => [...prev, newOrg]);
                          const invRes = await fetch(`/api/portal/admin/organizations/${newOrg.id}/generate-invite`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                            body: JSON.stringify({ type: "member" }),
                          });
                          const invJ = await invRes.json();
                          if (invJ.url) setOrgInviteUrl(invJ.url);
                        } catch { /* ignore */ }
                        setNewOrgCreating(false);
                        setNewOrgModal(false);
                      }}
                      className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                      style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                      {newOrgCreating ? "Creating…" : "Create & generate link"}
                    </button>
                  </div>
                </div>
            </div>,
            document.body,
          )}

          {/* Archive toggle */}
          {archivedUserIds.length > 0 && (
            <div className="mt-10">
              <button
                onClick={() => setShowArchive(v => !v)}
                className="bv-row-hover text-xs flex items-center gap-1.5 mb-4 px-2 py-1"
                style={{ color: "var(--w3)" }}
              >
                <span>{showArchive ? "▾" : "▸"}</span>
                {showArchive ? t.aHideArchive : t.aShowArchive} ({archivedUserIds.length} {archivedUserIds.length !== 1 ? t.aCandidates : t.aCandidate})
              </button>

              {showArchive && (
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  {archivedUserIds.map(uid => {
                    const allDocs    = grouped[uid] ?? [];
                    const approvedCnt = allDocs.filter(d => d.status === "approved").length;
                    const rejectedCnt = allDocs.filter(d => d.status === "rejected").length;
                    const user       = users[uid] ?? { name: uid, email: uid };
                    return (
                      <button key={uid}
                        onClick={() => { setSelectedUser(uid); setActivePhase(0); setPassportDataFeedback(profiles[uid]?.passport_feedback ?? ""); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                        className="bv-row-hover w-full text-left px-3 py-3 flex items-center gap-3 transition-colors outline-none"
                        style={{ borderBottom: "1px solid var(--border)", opacity: 0.75 }}>
                        {profiles[uid]?.profile_photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={profiles[uid].profile_photo!} alt={user.name}
                            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                            style={{ border: "1px solid var(--border)" }} />
                        ) : (
                          <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={{ background: "var(--bg2)", color: "var(--w3)" }}>
                            {user.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] font-medium truncate tracking-tight inline-flex items-center gap-0.5 flex-wrap" style={{ color: "var(--w)" }}>
                            {user.name}
                            <VerifiedBadge verified={!!profiles[uid]?.manually_verified} size="xs" color="gold" />
                            </p>
                          <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--w3)" }}>{user.email}</p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          {approvedCnt > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold"
                              style={{ color: "var(--success)" }}>
                              <CheckCircle2 size={11} strokeWidth={2} /> {approvedCnt}
                            </span>
                          )}
                          {rejectedCnt > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold"
                              style={{ color: "var(--danger)" }}>
                              <XCircle size={11} strokeWidth={2} /> {rejectedCnt}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* Match-with-org floating dropdown — portalled to escape transform stacking context */}
      {expandedRow && rowDropdownPos && typeof window !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[599]" onClick={() => { setExpandedRow(null); setRowDropdownPos(null); }} />
          <div className="rounded-xl p-3"
            style={{ position: "fixed", top: rowDropdownPos.top, right: rowDropdownPos.right, zIndex: 600, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 200 }}
            onClick={e => e.stopPropagation()}>
            {(candidateOrgs[expandedRow] ?? []).length > 0 ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10.5px] font-medium w-full mb-1" style={{ color: "var(--w3)" }}>
                  {lang === "de" ? "Zugewiesen:" : lang === "fr" ? "Assigné :" : "Matched with:"}
                </span>
                {(candidateOrgs[expandedRow] ?? []).map(o => (
                  <span key={o.id} className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                    {o.name}
                  </span>
                ))}
              </div>
            ) : (
              <div>
                <p className="text-[10.5px] font-medium mb-2" style={{ color: "var(--w3)" }}>
                  {lang === "de" ? "Mit Organisation:" : lang === "fr" ? "Associer :" : "Match with:"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {allOrgs.map(org => {
                    const uid = expandedRow;
                    const alreadyLinked = (candidateOrgs[uid] ?? []).some(o => o.id === org.id);
                    const isLoading = rowPlacing[`${uid}-${org.id}`];
                    return (
                      <button key={org.id}
                        disabled={alreadyLinked || isLoading}
                        onClick={async e => {
                          e.stopPropagation();
                          if (alreadyLinked || isLoading) return;
                          setRowPlacing(p => ({ ...p, [`${uid}-${org.id}`]: true }));
                          try {
                            const res = await fetch(`/api/portal/admin/organizations/${org.id}/candidates`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                              body: JSON.stringify({ candidateUserId: uid, status: "approved" }),
                            });
                            if (res.ok) {
                              setCandidateOrgs(prev => ({ ...prev, [uid]: [...(prev[uid] ?? []), { id: org.id, name: org.name }] }));
                              setExpandedRow(null); setRowDropdownPos(null);
                            }
                          } catch { /* ignore */ }
                          setRowPlacing(p => { const n = { ...p }; delete n[`${uid}-${org.id}`]; return n; });
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all disabled:opacity-40"
                        style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                        {isLoading ? "…" : `+ ${org.name}`}
                      </button>
                    );
                  })}
                  {allOrgs.length === 0 && <p className="text-[11px]" style={{ color: "var(--w3)" }}>No organizations yet</p>}
                </div>
              </div>
            )}
          </div>
        </>,
        document.body,
      )}

      {/* Standalone reject popup — same component used everywhere */}
      {rejectTarget && (
        <AdminRejectModal
          target={{ label: rejectTarget.label, initialFeedback: rejectTarget.initialFeedback }}
          onCancel={closeRejectModal}
          onSubmit={(text, shot) => submitReject(text, shot)}
        />
      )}

      {/* Hidden file input for admin upload on behalf of candidate */}
      <input
        ref={adminFileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: "none" }}
        onChange={e => {
          const file = e.target.files?.[0];
          const slotId = adminUploadTargetRef.current;
          if (file && slotId) adminUploadFile(file, slotId);
          e.target.value = "";
        }}
      />

      {/* Hidden file input for manual PDF upload inside sig modal */}
      <input
        ref={sigManualFileRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: "none" }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const b64 = (reader.result as string).replace(/^data:[^;]+;base64,/, "");
            setSigManualPdf(b64);
            setSigPdfBase64(b64);
          };
          reader.readAsDataURL(file);
          e.target.value = "";
        }}
      />

      {/* ── Edit slot label modal (LAW #36) ── */}
      {editingSlotId && (
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
          onClick={() => setEditingSlotId(null)}>
          <div className="w-full max-w-md rounded-[20px] p-6 space-y-4"
            style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)", animation: "bvFadeRise .28s var(--ease-out)", maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}>
            <p className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>Edit slot label</p>
            <input
              type="text"
              placeholder="Label"
              value={editingSlotLabel}
              onChange={e => setEditingSlotLabel(e.target.value)}
              autoFocus
              className="w-full px-3 py-2.5 text-[13px] outline-none"
              style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--w)" }}
            />
            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditingSlotId(null)}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold transition-all"
                style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                Cancel
              </button>
              <button
                onClick={() => saveSlotLabel(editingSlotId!, editingSlotLabel, editingSlotLabelTrans, editingSlotInstructions)}
                disabled={!editingSlotLabel.trim()}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-40"
                style={{ background: "var(--gold)", color: "#131312" }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Signature request modal — inline render, no portal ── */}
      {sigModal && (
        <div data-bv-sigmodal="1" className="fixed inset-0 z-[2147483600] flex items-center justify-center p-3 sm:p-6"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
          onClick={() => { setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null); setSigAdminSig(null); setSigAdminWantSave(true); setSigOrgSig(null); setSigOrgWantSave(true); }}>
          <div className="w-full max-w-4xl rounded-2xl overflow-hidden flex flex-col"
            style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", maxHeight: "calc(100dvh - 80px)" }}
            onClick={e => e.stopPropagation()}>

            {/* ── Header ── */}
            <div className="px-5 py-3.5 flex items-center justify-between flex-shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="min-w-0 flex-1 mr-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-0.5" style={{ color: "var(--w3)" }}>
                  {lang === "fr" ? "Signature" : lang === "de" ? "Signatur" : "Signature"}
                </p>
                <input
                  value={sigModal.label}
                  onChange={e => setSigModal(prev => prev ? { ...prev, label: e.target.value } : prev)}
                  className="text-[13.5px] font-semibold tracking-tight bg-transparent border-none outline-none w-full min-w-0"
                  style={{ color: "var(--w)" }}
                />
              </div>
              {/* Mode toggle */}
              <div className="flex flex-shrink-0 mx-3 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg2)" }}>
                {([["admin-only", lang === "fr" ? "Admin seul" : lang === "de" ? "Admin" : "Admin only"], ["with-candidate", lang === "fr" ? "+ Candidat" : lang === "de" ? "+ Kandidat" : "+ Candidate"]] as [string, string][]).map(([mode, label]) => (
                  <button key={mode} onClick={() => setSigMode(mode as "admin-only" | "with-candidate")}
                    className="px-3 py-1.5 text-[11px] font-semibold transition-colors"
                    style={{ background: sigMode === mode ? "var(--gold)" : "transparent", color: sigMode === mode ? "#131312" : "var(--w3)", borderRight: mode === "admin-only" ? "1px solid var(--border)" : "none" }}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={() => { setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null); setSigAdminSig(null); setSigAdminWantSave(true); setSigOrgSig(null); setSigOrgWantSave(true); }}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ color: "var(--w3)" }}>
                <XIcon size={14} strokeWidth={1.8} />
              </button>
            </div>

            {/* ── PDF Zone picker — main body ── */}
            <div className="overflow-y-auto flex-1">
              {sigPdfLoading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-3">
                  <Spinner size="md" />
                  <p className="text-[12px]" style={{ color: "var(--w3)" }}>
                    {lang === "fr" ? "Chargement du PDF…" : lang === "de" ? "PDF wird geladen…" : "Loading PDF…"}
                  </p>
                </div>
              ) : sigPdfBase64 ? (
                <div className="p-3">
                  <PdfZonePicker
                    pdfBase64={sigPdfBase64}
                    onChange={zones => setSigZones(zones)}
                    onError={() => { setSigPdfBase64(null); setSigManualPdf(null); }}
                    partyPreviews={sigAdminSig ? { admin: sigAdminSig } : undefined}
                    partyBgRemoving={sigAdminBgRemoving ? { admin: true } : undefined}
                    onPartyImageCrop={(_, dataUri) => setSigAdminSig(dataUri)}
                  />
                </div>
              ) : (
                /* Big drop zone — primary action when Drive fails */
                <div
                  className="flex flex-col items-center justify-center gap-4 m-4 rounded-2xl cursor-pointer transition-colors"
                  style={{ minHeight: 280, border: "2.5px dashed var(--border-gold)", background: "var(--gdim)" }}
                  onClick={() => sigManualFileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = "rgba(201,162,64,0.18)"; }}
                  onDragLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--gdim)"; }}
                  onDrop={e => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).style.background = "var(--gdim)";
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const b64 = (reader.result as string).replace(/^data:[^;]+;base64,/, "");
                      setSigManualPdf(b64);
                      setSigPdfBase64(b64);
                    };
                    reader.readAsDataURL(file);
                  }}>
                  <Upload size={36} strokeWidth={1.5} style={{ color: "var(--gold)", opacity: 0.7 }} />
                  <div className="text-center space-y-1 px-6">
                    <p className="text-[14px] font-semibold" style={{ color: "var(--gold)" }}>
                      {lang === "fr" ? "Déposez le PDF ici" : lang === "de" ? "PDF hier ablegen" : "Drop the PDF here"}
                    </p>
                    <p className="text-[12px]" style={{ color: "var(--w3)" }}>
                      {lang === "fr" ? "ou cliquez pour sélectionner" : lang === "de" ? "oder klicken zum Auswählen" : "or click to select"}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: "var(--w3)", opacity: 0.7 }}>
                      {lang === "fr" ? "Le PDF que le candidat devra signer" : lang === "de" ? "Das zu unterschreibende Dokument" : "The document the candidate needs to sign"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); sigManualFileRef.current?.click(); }}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[13px] font-semibold transition-opacity hover:opacity-80"
                    style={{ background: "var(--gold)", color: "#131312" }}>
                    <Upload size={13} strokeWidth={2} />
                    {lang === "fr" ? "Choisir un PDF" : lang === "de" ? "PDF auswählen" : "Choose PDF"}
                  </button>
                </div>
              )}
            </div>

            {/* ── Sticky sig section (admin — covers org + supreme admin zones) ── */}
            {sigPdfBase64 && (
              <div className="flex-shrink-0 px-3 pt-3 pb-1" style={{ borderTop: "1px solid var(--border)" }}>
                <AdminSigSection party="admin" lang={lang}
                  sig={sigAdminSig} wantSave={sigAdminWantSave} bgRemoving={sigAdminBgRemoving}
                  onSig={setSigAdminSig} onWantSave={setSigAdminWantSave}
                  onUpload={() => { setSigUploadTarget("admin"); sigAdminUploadRef.current?.click(); }}
                  onDropFile={file => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = reader.result as string;
                      setSigAdminSig(null);
                      setSigAdminBgRemoving(true);
                      Promise.all([removeImageBg(result), new Promise(r => setTimeout(r, 2200))])
                        .then(([clean]) => { setSigAdminSig(clean); setSigAdminBgRemoving(false); });
                    };
                    reader.readAsDataURL(file);
                  }}
                />

              </div>
            )}

            {/* ── Compact footer: note + send ── */}
            <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="flex gap-2">
                {sigMode === "with-candidate" && (
                  <input value={sigNote} onChange={e => setSigNote(e.target.value)}
                    placeholder={lang === "fr" ? "Note (optionnel)" : lang === "de" ? "Hinweis (optional)" : "Note (optional)"}
                    className="flex-1 px-3 py-2 text-[12px] rounded-xl outline-none"
                    style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--w)" }} />
                )}
                {sigMode === "admin-only" ? (() => {
                  const hasPdf = !!(sigPdfBase64 || sigManualPdf);
                  const spin = <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />;
                  const doSubmit = async (action: "save" | "download") => {
                    if (sigSending) return;
                    if (!hasPdf) { sigManualFileRef.current?.click(); return; }
                    setSigSending(true);
                    const parties = { admin: sigZones.some(z => z.party === "admin"), candidate: sigZones.some(z => z.party === "candidate") };
                    try {
                      let res: Response;
                      if (sigManualPdf) {
                        const fd = new FormData();
                        if (action === "save") fd.append("candidateId", selectedUser ?? "");
                        fd.append("documentName", sigModal.label);
                        fd.append(action === "download" ? "adminOnly" : "adminSave", "true");
                        const bin = atob(sigManualPdf); const arr = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                        fd.append("pdf", new Blob([arr], { type: "application/pdf" }), "signature-document.pdf");
                        fd.append("parties", JSON.stringify(parties));
                        if (sigZones.length) fd.append("signatureZones", JSON.stringify(sigZones));
                        if (sigAdminSig) { fd.append("adminSignatureBase64", sigAdminSig); fd.append("orgSignatureBase64", sigAdminSig); }
                        res = await fetch("/api/portal/admin/sign-request", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: fd });
                      } else {
                        res = await fetch("/api/portal/admin/sign-request", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                          body: JSON.stringify({ candidateId: action === "save" ? selectedUser : undefined, documentName: sigModal.label, driveFileId: sigModal.driveFileId, adminOnly: action === "download", adminSave: action === "save", parties, signatureZones: sigZones.length ? sigZones : undefined, adminSignatureBase64: sigAdminSig || undefined, orgSignatureBase64: sigAdminSig || undefined }),
                        });
                      }
                      if (res.ok) {
                        if (action === "download") {
                          if (isIOSDevice()) {
                            // Server stashed it at admin-dl/<userId>.pdf. iOS
                            // needs a FRESH tap to download (a download after
                            // this await is blocked), so surface a button.
                            setIosSignedDl({
                              url: `/api/portal/admin/sign-request?adminDownload=1&name=${encodeURIComponent(sigModal.label + ".pdf")}&access_token=${encodeURIComponent(accessToken)}`,
                              name: `${sigModal.label}.pdf`,
                            });
                            setSigSending(false);
                            return;
                          }
                          const blob = await res.blob(); const url = URL.createObjectURL(blob);
                          const a = document.createElement("a"); a.href = url; a.download = `${sigModal.label}.pdf`; a.click(); URL.revokeObjectURL(url);
                          showError(lang === "fr" ? "PDF téléchargé ✓" : lang === "de" ? "PDF heruntergeladen ✓" : "Signed PDF downloaded ✓");
                        } else {
                          showError(lang === "fr" ? "PDF enregistré ✓" : lang === "de" ? "PDF gespeichert ✓" : "Signed PDF saved ✓");
                        }
                        setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null);
                        setSigAdminSig(null); setSigAdminWantSave(true); setSigOrgSig(null); setSigOrgWantSave(true);
                      } else {
                        const j = await res.json().catch(() => ({}));
                        showError(`${action === "download" ? "Download" : "Save"} failed: ${(j as { error?: string }).error ?? `HTTP ${res.status}`}`);
                      }
                    } catch (e) { showError(`Error: ${e instanceof Error ? e.message : String(e)}`); }
                    setSigSending(false);
                  };
                  return (
                    <>
                      <button onClick={() => doSubmit("save")} disabled={sigSending || !selectedUser || !hasPdf}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-opacity disabled:opacity-40"
                        style={{ background: "var(--gold)", color: "#131312" }}>
                        {sigSending ? spin : <><SaveIcon size={13} strokeWidth={2} /> {lang === "fr" ? "Sauvegarder" : lang === "de" ? "Speichern" : "Save"}</>}
                      </button>
                      {iosSignedDl ? (
                        <button
                          onClick={() => {
                            // Fresh user gesture → iOS download now works.
                            triggerIosDownload(iosSignedDl.url, iosSignedDl.name);
                            setIosSignedDl(null);
                            setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null);
                            setSigAdminSig(null); setSigAdminWantSave(true); setSigOrgSig(null); setSigOrgWantSave(true);
                          }}
                          className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold"
                          style={{ background: "var(--gold)", color: "#131312" }}>
                          <Download size={13} strokeWidth={2} /> {lang === "fr" ? "Appuyez pour enregistrer" : lang === "de" ? "Tippen zum Speichern" : "Tap to save PDF"}
                        </button>
                      ) : (
                      <button onClick={() => doSubmit("download")} disabled={sigSending || !hasPdf}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-opacity disabled:opacity-40"
                        style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
                        {sigSending ? spin : <><Download size={13} strokeWidth={2} /> {lang === "fr" ? "Télécharger" : lang === "de" ? "Herunterladen" : "Download"}</>}
                      </button>
                      )}
                    </>
                  );
                })() : (
                  <button onClick={async () => {
                    if (sigSending) return;
                    if (!sigPdfBase64 && !sigManualPdf) { sigManualFileRef.current?.click(); return; }
                    setSigSending(true);
                    const parties = { admin: sigZones.some(z => z.party === "admin"), candidate: sigZones.some(z => z.party === "candidate") };
                    try {
                      let res: Response;
                      if (sigManualPdf) {
                        const fd = new FormData();
                        fd.append("candidateId", selectedUser ?? ""); fd.append("documentName", sigModal.label);
                        const bin = atob(sigManualPdf); const arr = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                        fd.append("pdf", new Blob([arr], { type: "application/pdf" }), "signature-document.pdf");
                        if (sigNote.trim()) fd.append("note", sigNote.trim());
                        fd.append("parties", JSON.stringify(parties));
                        if (sigZones.length) fd.append("signatureZones", JSON.stringify(sigZones));
                        if (sigAdminSig) { fd.append("adminSignatureBase64", sigAdminSig); fd.append("orgSignatureBase64", sigAdminSig); }
                        res = await fetch("/api/portal/admin/sign-request", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: fd });
                      } else {
                        res = await fetch("/api/portal/admin/sign-request", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                          body: JSON.stringify({ candidateId: selectedUser, documentName: sigModal.label, driveFileId: sigModal.driveFileId, note: sigNote.trim() || undefined, parties, signatureZones: sigZones.length ? sigZones : undefined, adminSignatureBase64: sigAdminSig || undefined, orgSignatureBase64: sigAdminSig || undefined }),
                        });
                      }
                      if (res.ok) {
                        showError(lang === "fr" ? "Demande envoyée ✓" : lang === "de" ? "Anfrage gesendet ✓" : "Request sent ✓");
                        setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null);
                        setSigAdminSig(null); setSigAdminWantSave(true); setSigOrgSig(null); setSigOrgWantSave(true);
                      } else {
                        const j = await res.json().catch(() => ({}));
                        showError(`Send failed: ${(j as { error?: string }).error ?? `HTTP ${res.status}`}`);
                      }
                    } catch (e) { showError(`Error: ${e instanceof Error ? e.message : String(e)}`); }
                    setSigSending(false);
                  }}
                    disabled={sigSending}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: (!sigPdfBase64 && !sigManualPdf && !sigPdfLoading) ? "var(--bg2)" : "var(--gold)", color: (!sigPdfBase64 && !sigManualPdf && !sigPdfLoading) ? "var(--w3)" : "#131312", border: (!sigPdfBase64 && !sigManualPdf && !sigPdfLoading) ? "1px solid var(--border)" : "none" }}>
                    {sigSending
                      ? <><span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> {lang === "fr" ? "En cours…" : lang === "de" ? "Lädt…" : "Working…"}</>
                      : (!sigPdfBase64 && !sigManualPdf && !sigPdfLoading)
                        ? <><Upload size={13} strokeWidth={2} /> {lang === "fr" ? "PDF requis" : lang === "de" ? "PDF erforderlich" : "Upload PDF first"}</>
                        : <><Send size={13} strokeWidth={2} /> {lang === "fr" ? "Envoyer" : lang === "de" ? "Senden" : "Send"}</>
                    }
                  </button>
                )}
                <button onClick={() => { setSigModal(null); setSigNote(""); setSigZones([]); setSigManualPdf(null); }}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl transition-opacity hover:opacity-70"
                  style={{ background: "var(--card)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                  <XIcon size={14} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


