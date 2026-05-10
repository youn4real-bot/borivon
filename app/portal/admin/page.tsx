"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { translations } from "@/lib/translations";
import { useLang } from "@/components/LangContext";
import { AdminDocPreviewModal } from "@/components/AdminDocPreviewModal";
import { AdminRejectModal } from "@/components/AdminRejectModal";
import { natToLang, COUNTRY_MAP as NAT_MAP } from "@/lib/countries";
import {
  PhaseIcon, type PhaseKind,
  Lock, Unlock, IdCard, FileText, Folder, FilePen, Save, Eye,
  CheckCircle2, XCircle, AlertTriangle, PartyPopper,
} from "@/components/PortalIcons";
import { X as XIcon, RotateCcw, Download, Upload, ArrowLeft, MoreHorizontal, ChevronDown, Search, Trash2, Building2, Plus, Send, User, Save as SaveIcon } from "lucide-react";
import { Spinner, PageLoader, EmptyState } from "@/components/ui/states";
import { CandidateStagePreview, type JourneyMode } from "@/components/JourneyView";
import { PdfZonePicker, type SigZone } from "@/components/PdfZonePicker";
import { SignaturePad } from "@/components/SignaturePad";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { PortalTopNav } from "@/components/PortalTopNav";
import { FILE_KEY_ALL_LABELS } from "@/lib/fileKeys";

const ADMIN_PHASES: { title: string; shortTitle: string; kind: PhaseKind; keys: string[] }[] = [
  { title: "ID & CV",     shortTitle: "ID",      kind: "id",          keys: ["id", "cv_de", "letter", "langcert", "other"] },
  { title: "Nursing",     shortTitle: "Nursing", kind: "nursing",     keys: [
    "diploma", "studyprog", "transcript", "abitur", "abitur_transcript", "praktikum", "workcert", "work_experience",
    "diploma_de", "studyprog_de", "transcript_de", "abitur_de", "abitur_transcript_de", "praktikum_de", "workcert_de", "work_experience_de",
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

// ── Preview modal moved to components/AdminDocPreviewModal.tsx ────────────────

function removeImageBg(dataUri: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUri); return; }
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = id.data;
        const n = canvas.width * canvas.height;
        // Otsu's method: adaptive threshold between ink (dark) and paper (bright)
        const hist = new Array(256).fill(0);
        for (let i = 0; i < d.length; i += 4) {
          hist[Math.round((d[i] + d[i+1] + d[i+2]) / 3)]++;
        }
        let sumAll = 0;
        for (let k = 0; k < 256; k++) sumAll += k * hist[k];
        let sumB = 0, cntB = 0, bestT = 128, maxVar = 0;
        for (let T = 0; T < 256; T++) {
          cntB += hist[T];
          if (!cntB || cntB === n) continue;
          sumB += T * hist[T];
          const mB = sumB / cntB, mA = (sumAll - sumB) / (n - cntB);
          const v = cntB * (n - cntB) * (mB - mA) ** 2;
          if (v > maxVar) { maxVar = v; bestT = T; }
        }
        const lo = bestT;
        const hi = bestT + 0.15 * (255 - bestT);
        for (let i = 0; i < d.length; i += 4) {
          const b = (d[i] + d[i+1] + d[i+2]) / 3;
          if (b >= hi) {
            d[i+3] = 0;
          } else if (b >= lo) {
            d[i+3] = Math.round((hi - b) / (hi - lo) * 255);
          }
        }
        ctx.putImageData(id, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch { resolve(dataUri); }
    };
    img.onerror = () => resolve(dataUri);
    img.src = dataUri;
  });
}

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

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: meta.bg, border: `1.5px solid ${meta.border}` }}>
        <p className="text-[11.5px] font-semibold" style={{ color: meta.accent }}>
          ✍ {title}
        </p>

        {/* Upload dropzone — shown when no sig yet */}
        {!sig && (
          <div
            onClick={onUpload}
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
        )}

        {/* Action buttons when sig exists */}
        {sig && (
          <div className="flex items-center gap-2 flex-wrap">
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
              if (e.target.checked && sig) localStorage.setItem(meta.storageKey, sig);
              else if (!e.target.checked) localStorage.removeItem(meta.storageKey);
            }}
            className="rounded"
            style={{ accentColor: meta.accent }}
          />
          <span className="text-[11px]" style={{ color: "var(--w3)" }}>
            {lbl("Save for next time", "Enregistrer pour la prochaine fois", "Für nächstes Mal speichern")}
          </span>
        </label>
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
  type PhaseSlot = { id: string; org_id: string | null; phase: string; position: number; type: "simple" | "dual"; label: string; label_trans: string | null };
  const [phaseSlots, setPhaseSlots] = useState<Record<string, PhaseSlot[]>>({ bearbeitung: [], visum: [] });
  const [phaseSlotsLoaded, setPhaseSlotsLoaded] = useState<Record<string, boolean>>({ bearbeitung: false, visum: false });
  // Add-slot modal
  const [addSlotPhase, setAddSlotPhase] = useState<string | null>(null);
  const [addSlotType, setAddSlotType]   = useState<"simple" | "dual">("simple");
  const [addSlotLabel, setAddSlotLabel] = useState("");
  const [addSlotLabelTrans, setAddSlotLabelTrans] = useState("");
  const [addSlotSaving, setAddSlotSaving] = useState(false);
  // Expanded DUAL slot IDs (collapsed by default, like static paired rows)
  const [expandedDualSlots, setExpandedDualSlots] = useState<Set<string>>(new Set());
  // Inline slot label editing
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editingSlotLabel, setEditingSlotLabel] = useState("");
  const [editingSlotLabelTrans, setEditingSlotLabelTrans] = useState("");
  // Drag-to-reorder
  const dragSlotIdx = React.useRef<number | null>(null);
  // Admin upload on behalf of candidate
  const [adminUploadSlotId, setAdminUploadSlotId] = useState<string | null>(null);
  const adminFileInputRef = React.useRef<HTMLInputElement>(null);
  const adminUploadTargetRef = React.useRef<string | null>(null);
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
  const [revokeMenu, setRevokeMenu] = useState<string | null>(null);
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

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const token = session.access_token ?? "";
      setAccessToken(token);
      setCurrentUserId(session.user.id);
      // Check supreme-admin status + fetch org list in parallel with main data.
      fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (j?.isSuperAdmin) setIsSuperAdmin(true); })
        .catch(() => {});
      fetch("/api/portal/admin/organizations", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (j?.orgs) setAllOrgs(j.orgs); })
        .catch(() => {});
      // Eagerly prefetch both dynamic phase slots so the tab is instant
      for (const ph of ["bearbeitung", "visum"] as const) {
        fetch(`/api/portal/phase-slots?phase=${ph}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(j => { if (j?.slots) { setPhaseSlots(prev => ({ ...prev, [ph]: j.slots })); setPhaseSlotsLoaded(prev => ({ ...prev, [ph]: true })); } })
          .catch(() => {});
      }
      try {
        const res = await fetch("/api/portal/admin", { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401 || res.status === 403) { router.replace("/portal/dashboard"); return; }
        const json = await res.json();
        setDocs(json.docs ?? []);
        setDocHistory(json.docHistory ?? []);
        setUsers(json.users ?? {});
        setProfiles(json.profiles ?? {});
        setCandidateOrgs(json.candidateOrgs ?? {});
        const fb: Record<string, string> = {};
        for (const d of json.docs ?? []) fb[d.id] = d.feedback ?? "";
        setFeedbacks(fb);

        // Deep-link from notification:
        //   - nav_email      → auto-select that candidate
        //   - nav_doc        → jump to the doc's phase (file_type-based)
        //   - nav_doc_id     → ALSO open that exact doc in the preview modal
        //                      (uses the page's main `previewDoc` state so the
        //                      auto-side-by-side / passport-data button etc.
        //                      all behave like a normal row click — never
        //                      a separate orphan modal)
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
              // Try to find the doc in the freshly-loaded list
              type AnyDoc = { id: string; user_id: string; file_type: string };
              const all = [...((json.docs ?? []) as AnyDoc[]), ...((json.docHistory ?? []) as AnyDoc[])];
              const doc = all.find(d => d.id === navDocId);
              if (doc) {
                setActivePhase(getPhaseIdx(doc.file_type));
                // Open the preview after the candidate panel has had a tick to render
                setTimeout(() => setPreviewDoc(doc as Doc), 50);
              }
            }
          }
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch (err) {
        console.error("Admin data fetch error:", err);
      } finally {
        setLoading(false);
      }
    });
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
        console.error("[savePipelineField] HTTP", res.status, await res.text().catch(() => ""));
        setPipeline(prev); // rollback optimistic update
      }
    } catch { setPipeline(prev); /* network error — rollback */ }
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

  async function addPhaseSlot(phase: string, type: "simple" | "dual", label: string, labelTrans: string) {
    if (!accessToken || !label.trim()) return;
    setAddSlotSaving(true);
    try {
      const res = await fetch("/api/portal/phase-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phase, type, label: label.trim(), label_trans: labelTrans.trim() || undefined }),
      });
      if (res.ok) {
        const j = await res.json();
        setPhaseSlots(prev => ({ ...prev, [phase]: [...(prev[phase] ?? []), j.slot] }));
        setAddSlotPhase(null);
        setAddSlotLabel("");
        setAddSlotLabelTrans("");
      }
    } catch { /* network error */ }
    setAddSlotSaving(false);
  }

  async function saveSlotLabel(slotId: string, label: string, labelTrans: string) {
    if (!accessToken || !label.trim()) return;
    try {
      const res = await fetch("/api/portal/phase-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id: slotId, label: label.trim(), label_trans: labelTrans.trim() || null }),
      });
      if (res.ok) {
        setPhaseSlots(prev => {
          const updated: Record<string, typeof prev.bearbeitung> = {};
          for (const [ph, slots] of Object.entries(prev)) {
            updated[ph] = (slots ?? []).map(s => s.id === slotId ? { ...s, label: label.trim(), label_trans: labelTrans.trim() || null } : s);
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
    setAdminUploadSlotId(slotId);
    const fd = new FormData();
    fd.append("file", file);
    // Use "other" as fileKey so Drive places file in the sonstiges subfolder
    // with an incrementing name (avoids collision when all slot UUIDs fell
    // through to the same "dokument_original" filename).
    // fileType stays as slotId so the DB lookup by slot ID still works.
    fd.append("fileKey", "other");
    fd.append("fileType", slotId);
    fd.append("forUserId", selectedUser);
    try {
      const res = await fetch("/api/portal/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: fd,
      });
      if (res.ok) {
        // Targeted refetch: only reload docs for this candidate, not all docs.
        const res2 = await fetch(`/api/portal/admin?userId=${selectedUser}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res2.ok) {
          const json2 = await res2.json();
          const freshDocs: Doc[] = json2.docs ?? [];
          // Merge: replace this candidate's docs, keep all others intact.
          setDocs(prev => [
            ...prev.filter(d => d.user_id !== selectedUser),
            ...freshDocs,
          ]);
        }
      }
    } finally {
      setAdminUploadSlotId(null);
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
            onSign={() => { setPreviewDoc(null); setShowPassportInfo(false); setSigModal({ docId: previewDoc.id, driveFileId: previewDoc.drive_file_id ?? null, label: previewDoc.file_name }); }}
            sideBySide={
              /pass/i.test(previewDoc.file_type)
              && (previewDoc.status !== "approved" || (profiles[previewDoc.user_id]?.passport_status !== "approved"))
              && showPassportInfo
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
          // When the passport DOC is also being previewed AND it's not yet
          // approved, we treat this as the "verification" phase and lay the
          // two modals out together: doc preview on the left, data form on
          // the right (laptop). On mobile they stack — doc on top, data
          // below. Once approved, the data popup goes back to a centered
          // standalone (only ever opened via the "Passport data" button).
          const isVerificationPhase = !!previewDoc
            && /pass/i.test(previewDoc.file_type)
            && (previewDoc.status !== "approved" || (p_info?.passport_status !== "approved"));

          return (
            <div className={`fixed inset-x-0 z-[750] flex justify-center p-4 bv-passport-info-outer ${isVerificationPhase ? "bv-side-data" : "top-[58px] bottom-0 items-center"}`}
              style={{
                background: isVerificationPhase ? "transparent" : "rgba(0,0,0,0.45)",
                backdropFilter: isVerificationPhase ? undefined : "blur(8px)",
                animation: "bvFadeRise .22s var(--ease-out)",
                pointerEvents: isVerificationPhase ? "none" : "auto",
              }}
              onClick={() => { setShowPassportInfo(false); setPassportInfoEditMode(false); setPassportInfoEdits({}); }}>
              {/* Side-by-side rule:
                    Laptop → data form sits in the RIGHT half, centered
                    Phone  → data form takes the BOTTOM half (passport above) */}
              <style>{`
                @media (max-width: 639.98px) {
                  .bv-passport-info-outer { padding-bottom: calc(1rem + 72px) !important; }
                  .bv-side-data {
                    top: calc(58px + 50dvh - 0.25rem) !important;
                    bottom: 0 !important;
                    padding-top: 0.25rem !important;
                    align-items: center !important;
                  }
                  .bv-side-data .bv-passport-info-card {
                    max-height: 100% !important;
                  }
                }
                @media (min-width: 640px) {
                  .bv-side-data {
                    top: 58px;
                    bottom: 0;
                    align-items: center;
                    /* Hug the centerline: card left-edge sits at 50vw,
                       no gap between this and the preview on the left. */
                    justify-content: flex-start !important;
                    padding-left: 50vw;
                    padding-right: 1rem;
                  }
                }
              `}</style>
              <div className={`bv-passport-info-card w-full overflow-hidden flex flex-col ${isVerificationPhase ? "sm:max-w-[440px]" : "max-w-md"}`}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-2xl)",
                  boxShadow: "var(--shadow-lg)",
                  maxHeight: "calc(100% - 0.5rem)",
                  animation: "bvFadeRise .28s var(--ease-out)",
                  pointerEvents: "auto",
                }}
                onClick={e => e.stopPropagation()}>

                {/* ── Header ── */}
                <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
                  style={{ borderBottom: "1px solid var(--border-gold)", background: "var(--gdim)" }}>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--gold)" }}>
                      <IdCard size={13} strokeWidth={1.8} className="inline mr-1.5 -mt-0.5" /> {lang === "fr" ? "Données du passeport" : lang === "de" ? "Reisepassdaten" : "Passport data"}
                    </p>
                    {/* Status badge — hidden when approved */}
                    {pst !== "approved" && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold tracking-wide uppercase"
                        style={{ background: pstBg, color: pstColor, border: `1px solid ${pstBdr}` }}>
                        {pst === "rejected" ? <XCircle size={10} strokeWidth={2} />
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
                    <button onClick={() => { setShowPassportInfo(false); setPassportInfoEditMode(false); setPassportInfoEdits({}); }}
                      className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center text-xs"
                      style={{ color: "var(--w3)" }}>
                      <XIcon size={13} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>

                {/* ── Fields / empty state ── */}
                <div className="overflow-y-auto flex-1 px-5 py-4">
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
                          <label className="text-[10px] mb-1 block" style={{ color: "var(--w3)" }}>{f.label}</label>
                          {f.type === "country" ? (
                            <select
                              value={toIsoCodeAdmin(fieldVal(f.key))}
                              onChange={e => setPassportInfoEdits(prev => ({ ...prev, [f.key]: e.target.value || null }))}
                              className="w-full rounded-lg px-2.5 py-1.5 text-[11px] outline-none"
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
                              className="w-full rounded-lg px-2.5 py-1.5 text-[11px] outline-none"
                              style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }}>
                              <option value="">—</option>
                              <option value="M">{lang==="fr"?"Masculin":lang==="de"?"Männlich":"Male"}</option>
                              <option value="F">{lang==="fr"?"Féminin":lang==="de"?"Weiblich":"Female"}</option>
                            </select>
                          ) : (
                            <input
                              type={f.type ?? "text"}
                              value={f.type === "date" ? fieldVal(f.key).slice(0, 10) : fieldVal(f.key)}
                              onChange={e => setPassportInfoEdits(prev => ({ ...prev, [f.key]: e.target.value || null }))}
                              className="w-full rounded-lg px-2.5 py-1.5 text-[11px] outline-none"
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
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                          {group.fields.map(f => {
                            if (pst === "approved") {
                              return (
                                <div key={f.label} className="min-w-0">
                                  <p className="text-[10px]" style={{ color: "var(--w3)" }}>{f.label}</p>
                                  <p className="text-xs font-semibold" style={{ color: "var(--w)" }}>{f.value}</p>
                                </div>
                              );
                            }
                            // Per-field review checkbox — empty/orange/green
                            const filled = !!(f.value && f.value !== "—" && f.value.trim() !== "");
                            const fieldKey = f.label;
                            const confirmed = adminConfirmedFields.has(fieldKey);
                            return (
                              <div key={f.label} className="flex items-start gap-2">
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
                                  className="flex-shrink-0 mt-3 transition-all"
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
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px]" style={{ color: "var(--w3)" }}>{f.label}</p>
                                  <p className="text-xs font-semibold" style={{ color: "warn" in f && f.warn ? "var(--danger)" : "var(--w)" }}>
                                    {f.value}{"warn" in f && f.warn ? <AlertTriangle size={11} strokeWidth={1.8} className="inline ml-1 -mt-0.5" /> : ""}
                                  </p>
                                </div>
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
                  <div className="px-5 py-3 flex-shrink-0 flex flex-col gap-2"
                    style={{ borderTop: "1px solid var(--border)" }}>
                  {isSuperAdmin && (() => {
                    const isManual = !!profiles[selectedUser ?? ""]?.manually_verified;
                    return (
                      <button
                        onClick={toggleManualVerify}
                        title={isManual ? "Manually verified — click to revoke" : "Grant the gold verified tick"}
                        className="self-start inline-flex items-center gap-1.5 text-[10.5px] px-3 py-1.5 rounded-full font-semibold transition-colors"
                        style={isManual
                          ? { background: "var(--gdim)", border: "1px solid var(--border-gold)" }
                          : { background: "transparent", border: "1px solid var(--border)" }}>
                        <svg width="10" height="10" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <path d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v6.355h6.234L14.638 40l5.36-3.094L25.358 40l2.978-5.149h6.227v-6.355L40 25.359 36.905 20 40 14.64l-5.438-3.135V5.15h-6.227L25.358 0l-5.36 3.094Z"
                            fill={isManual ? "var(--gold)" : "none"} stroke={isManual ? "none" : "var(--w3)"} strokeWidth="2" />
                          <path d="m13 19.5 4.5 4 7-7" stroke={isManual ? "#fff" : "transparent"} strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span style={{ color: isManual ? "var(--gold)" : "var(--w3)" }}>
                          {isManual ? "Verified" : "Verify"}
                        </span>
                      </button>
                    );
                  })()}
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
                    ) : (
                      <button
                        onClick={async () => {
                          if (!selectedUser) return;
                          setPassportDataPdfDl(true);
                          try {
                            const cp = profiles[selectedUser];
                            const fn = [cp?.first_name, cp?.last_name].filter(Boolean).join("_").toLowerCase() || "passport_data";
                            const docTitle = lang==="fr" ? "Données du passeport" : lang==="de" ? "Reispassdaten" : "Passport Data";
                            const docSubtitle = lang==="fr" ? "Informations de passeport extraites et confirmées" : lang==="de" ? "Extrahierte und bestätigte Reisepassdaten" : "Extracted and confirmed passport information";
                            const res = await fetch("/api/portal/admin/passport-data-pdf", {
                              method: "POST",
                              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                              body: JSON.stringify({ groups: passportDisplayGroups, filename: `${fn}_passport_data.pdf`, docTitle, docSubtitle }),
                            });
                            if (!res.ok) throw new Error("Failed");
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url; a.download = `${fn}_passport_data.pdf`; a.click(); URL.revokeObjectURL(url);
                          } catch (e) { console.error(e); }
                          setPassportDataPdfDl(false);
                        }}
                        disabled={passportDataPdfDl}
                        className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                        style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                        {passportDataPdfDl
                          ? <><span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> Generating…</>
                          : <><Download size={12} strokeWidth={1.8} /> Download data PDF</>}
                      </button>
                    )}
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
                            transition: "color 0.2s, transform 0.15s",
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
                            transition: "color 0.2s, transform 0.15s",
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
                      const slots = phaseSlots[slotPhase] ?? [];
                      return (
                        <div className="mt-4" style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                          <div className="px-2 py-2">
                          {/* Slot rows */}
                          {slots.length === 0 ? (
                            <div className="px-3 py-5 text-center">
                              <p className="text-[11px]" style={{ color: "var(--w3)" }}>No document slots — click <span style={{ color: "var(--gold)", fontWeight: 600 }}>+</span> to add one.</p>
                            </div>
                          ) : (
                            <div>
                              {slots.map((slot, si) => {
                                const origDocs = getAdminDocs(slot.id);
                                const transDocs = slot.type === "dual" ? getAdminDocs(slot.id + "_de") : [];
                                const allSlotDocs = [...origDocs, ...transDocs];

                                const slotDragProps = {
                                  draggable: true as const,
                                  onDragStart: () => { dragSlotIdx.current = si; },
                                  onDragOver: (e: React.DragEvent) => e.preventDefault(),
                                  onDrop: async () => {
                                    const from = dragSlotIdx.current;
                                    if (from === null || from === si) return;
                                    const reordered = [...slots];
                                    const [moved] = reordered.splice(from, 1);
                                    reordered.splice(si, 0, moved);
                                    const withPos = reordered.map((s, i) => ({ ...s, position: i }));
                                    setPhaseSlots(prev => ({ ...prev, [slotPhase]: withPos }));
                                    await saveSlotOrder(slotPhase, withPos.map(s => ({ id: s.id, position: s.position })));
                                    dragSlotIdx.current = null;
                                  },
                                };

                                if (slot.type === "simple") {
                                  const doc = origDocs[0] ?? null;
                                  const submitted = !!doc;
                                  const rowSt = !submitted ? null
                                    : doc!.status === "approved" ? "approved"
                                    : doc!.status === "rejected" ? "rejected"
                                    : "pending";
                                  const rowColor = rowSt === "approved" ? "#16a34a" : rowSt === "pending" ? "#f59e0b" : null;
                                  const rowClickable = submitted && !!doc?.drive_file_id;
                                  const menuId = doc?.id ?? slot.id;
                                  return (
                                    <div key={slot.id} {...slotDragProps}>
                                      {si > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                                      <div
                                        onClick={rowClickable ? () => setPreviewDoc(doc!) : undefined}
                                        className={`px-3 py-3 transition-colors${rowClickable ? " bv-row-hover cursor-pointer" : ""}`}
                                        style={{ minHeight: 60, ...(revokeMenu === menuId ? { position: "relative", zIndex: 10 } : {}) }}>
                                        <div className="flex items-center gap-3">
                                          <div className="flex-1 min-w-0">
                                            <p className="text-[11.5px] font-medium tracking-tight" style={{ color: rowColor ?? "var(--w)" }}>{slot.label}</p>
                                            {!submitted && <p className="text-[10px] mt-0.5" style={{ color: "var(--w3)" }}>Not submitted yet</p>}
                                            {doc && doc.status === "rejected" && doc.feedback && (
                                              <p className="text-[11px] mt-1" style={{ color: "var(--danger)" }}>{doc.feedback}</p>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1.5 flex-shrink-0"
                                            onClick={e => e.stopPropagation()}
                                            onMouseDown={e => e.stopPropagation()}>
                                            {/* Admin upload on behalf of candidate — hidden once doc exists */}
                                            {!submitted && (adminUploadSlotId === slot.id ? (
                                              <span className="w-9 h-9 flex items-center justify-center">
                                                <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" style={{ color: "var(--w3)" }} />
                                              </span>
                                            ) : (
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
                                            {rowSt === "pending" && !doc?.uploaded_by_admin && (
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
                                                onClick={e => { e.stopPropagation(); setRevokeMenu(prev => prev === menuId ? null : menuId); }}
                                                className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                                style={{ color: "var(--w2)" }}>
                                                <MoreHorizontal size={14} strokeWidth={1.8} />
                                              </button>
                                              {revokeMenu === menuId && (
                                                <>
                                                  <div className="fixed inset-0 z-10" onClick={e => { e.stopPropagation(); setRevokeMenu(null); }} />
                                                  <div className="absolute right-0 top-full mt-1 z-20 rounded-xl overflow-hidden"
                                                    style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 160, borderRadius: "var(--r-md)" }}>
                                                    <button
                                                      onClick={e => { e.stopPropagation(); setRevokeMenu(null); setEditingSlotId(slot.id); setEditingSlotLabel(slot.label); setEditingSlotLabelTrans(""); }}
                                                      className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                      style={{ color: "var(--w)" }}>
                                                      <FilePen size={11} strokeWidth={1.8} /> Edit label
                                                    </button>
                                                    <button
                                                      onClick={e => { e.stopPropagation(); setRevokeMenu(null); setSigModal({ docId: doc?.id ?? null, driveFileId: doc?.drive_file_id ?? null, label: slot.label }); }}
                                                      className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                      style={{ color: "var(--w)" }}>
                                                      <FilePen size={11} strokeWidth={1.8} /> Signature
                                                    </button>
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
                                                  </div>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
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
                                const isDualMenuOpen = revokeMenu === slot.id ||
                                  (origDocs[0] && revokeMenu === origDocs[0].id) ||
                                  (transDocs[0] && revokeMenu === transDocs[0].id);
                                return (
                                  <div key={slot.id} {...slotDragProps}>
                                    {si > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                                    {/* Dual header — click to preview merged PDF when both docs ready */}
                                    <div
                                      className={`px-3 py-3 flex items-center gap-2${canDualMerge ? " cursor-pointer bv-row-hover" : ""}`}
                                      style={isDualMenuOpen ? { position: "relative", zIndex: 10 } : undefined}
                                      onClick={() => {
                                        if (canDualMerge) setMergePreview({ origDocId: origDocs[0].id, transDocId: transDocs[0].id, label: slot.label });
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
                                              a.download = `${slot.label.replace(/\s+/g, "_")}_merged.pdf`;
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
                                          style={{ transition: "transform 0.2s", transform: isDualExpanded ? "rotate(180deg)" : "rotate(0deg)" }} />
                                      </button>
                                      {/* Three-dots — Edit label + Delete */}
                                      <div className="relative flex-shrink-0">
                                        <button
                                          onClick={e => { e.stopPropagation(); setRevokeMenu(prev => prev === slot.id ? null : slot.id); }}
                                          className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                          style={{ color: "var(--w2)" }}>
                                          <MoreHorizontal size={14} strokeWidth={1.8} />
                                        </button>
                                        {revokeMenu === slot.id && (
                                          <>
                                            <div className="fixed inset-0 z-10" onClick={e => { e.stopPropagation(); setRevokeMenu(null); }} />
                                            <div className="absolute right-0 top-full mt-1 z-20 rounded-xl overflow-hidden"
                                              style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 160, borderRadius: "var(--r-md)" }}>
                                              <button
                                                onClick={e => { e.stopPropagation(); setRevokeMenu(null); setEditingSlotId(slot.id); setEditingSlotLabel(slot.label); setEditingSlotLabelTrans(slot.label_trans ?? ""); }}
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
                                            </div>
                                          </>
                                        )}
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
                                          const isSubMenuOpen = subDoc && revokeMenu === subDoc.id;
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
                                                    <span className="w-8 h-8 flex items-center justify-center">
                                                      <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" style={{ color: "var(--w3)" }} />
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
                                                        onClick={e => { e.stopPropagation(); setRevokeMenu(prev => prev === subDoc!.id ? null : subDoc!.id); }}
                                                        className="bv-icon-btn w-8 h-8 flex items-center justify-center rounded-full"
                                                        style={{ color: "var(--w2)" }}>
                                                        <MoreHorizontal size={12} strokeWidth={1.8} />
                                                      </button>
                                                      {revokeMenu === subDoc.id && (
                                                        <>
                                                          <div className="fixed inset-0 z-10" onClick={e => { e.stopPropagation(); setRevokeMenu(null); }} />
                                                          <div className="absolute right-0 top-full mt-1 z-20 rounded-xl overflow-hidden"
                                                            style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 160, borderRadius: "var(--r-md)" }}>
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
                                                          </div>
                                                        </>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          </div>{/* end px-2 py-2 */}
                        </div>
                      );
                    })()}

                    {/* ── Add slot modal ─────────────────────────────────────────────────── */}
                    {addSlotPhase && (
                      <>
                        <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)" }}
                          onClick={() => setAddSlotPhase(null)} />
                        <div className="fixed inset-x-4 top-1/3 z-50 max-w-sm mx-auto rounded-2xl p-5 space-y-4"
                          style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)" }}>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>Add document slot</p>
                          {/* Type selector */}
                          <div className="grid grid-cols-2 gap-2">
                            {(["simple", "dual"] as const).map(tp => (
                              <button key={tp} type="button" onClick={() => setAddSlotType(tp)}
                                className="py-3 rounded-xl text-[12px] font-semibold text-center transition-all"
                                style={{ background: addSlotType === tp ? "var(--gdim)" : "var(--bg2)", color: addSlotType === tp ? "var(--gold)" : "var(--w2)", border: `1.5px solid ${addSlotType === tp ? "var(--border-gold)" : "var(--border)"}` }}>
                                {tp === "simple" ? "📄 Simple" : "📄📄 Dual (Original + Translated)"}
                              </button>
                            ))}
                          </div>
                          <input
                            type="text"
                            placeholder={addSlotType === "dual" ? "Label (original, e.g. Pflegediplom)" : "Label (e.g. Dokument 1)"}
                            value={addSlotLabel}
                            onChange={e => setAddSlotLabel(e.target.value)}
                            className="w-full px-3 py-2.5 text-[12.5px] outline-none"
                            style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--w)" }}
                          />
                          {addSlotType === "dual" && (
                            <input
                              type="text"
                              placeholder="Label translated (e.g. Pflegediplom Übersetzt)"
                              value={addSlotLabelTrans}
                              onChange={e => setAddSlotLabelTrans(e.target.value)}
                              className="w-full px-3 py-2.5 text-[12.5px] outline-none"
                              style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--w)" }}
                            />
                          )}
                          <div className="flex gap-2">
                            <button onClick={() => setAddSlotPhase(null)} disabled={addSlotSaving}
                              className="flex-1 py-2.5 rounded-xl text-[12.5px] font-semibold transition-all"
                              style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                              Cancel
                            </button>
                            <button
                              onClick={() => addPhaseSlot(addSlotPhase!, addSlotType, addSlotLabel, addSlotLabelTrans)}
                              disabled={addSlotSaving || !addSlotLabel.trim()}
                              className="flex-1 py-2.5 rounded-xl text-[12.5px] font-semibold transition-all disabled:opacity-40"
                              style={{ background: "var(--gold)", color: "#131312" }}>
                              {addSlotSaving ? "Saving…" : "Add"}
                            </button>
                          </div>
                        </div>
                      </>
                    )}

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
                              {slotPhase && (
                                <button
                                  onClick={() => { setAddSlotPhase(slotPhase); setAddSlotType("simple"); setAddSlotLabel(""); setAddSlotLabelTrans(""); }}
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
                                      <button onClick={() => setRevokeMenu(prev => prev === "passport_data_pdf" ? null : "passport_data_pdf")}
                                        title="Revoke approval" aria-label="More actions"
                                        className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full bv-touch"
                                        style={{ color: "var(--w2)" }}>
                                        <MoreHorizontal size={13} strokeWidth={1.8} />
                                      </button>
                                      {revokeMenu === "passport_data_pdf" && (
                                        <>
                                          <div className="fixed inset-0 z-10" onClick={() => setRevokeMenu(null)} />
                                          <div className="absolute left-0 top-full mt-1 z-20 rounded-xl overflow-hidden"
                                            style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 160, borderRadius: "var(--r-md)" }}>
                                            <button onClick={() => { setRevokeMenu(null); openRejectModal({ kind: "passport", label: item.label, initialFeedback: passportDataFeedback }); }}
                                              className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                              style={{ color: "var(--danger)" }}><RotateCcw size={11} strokeWidth={1.8} /> Revoke</button>
                                          </div>
                                        </>
                                      )}
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
                                          onClick={e => { e.stopPropagation(); setRevokeMenu(prev => prev === subDoc.id ? null : subDoc.id); }}
                                          className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                          style={{ color: "var(--w2)" }}>
                                          <MoreHorizontal size={15} strokeWidth={1.8} />
                                        </button>
                                        {revokeMenu === subDoc.id && (
                                          <>
                                            <div className="fixed inset-0" style={{ zIndex: 599 }}
                                              onClick={e => { e.stopPropagation(); setRevokeMenu(null); }} />
                                            <div className="absolute right-0 top-full mt-1 rounded-xl overflow-hidden"
                                              style={{ zIndex: 600, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 160, borderRadius: "var(--r-md)" }}>
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
                                            </div>
                                          </>
                                        )}
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
                                      a.download = `${item.label.replace(/\s+/g, "_")}_merged.pdf`;
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
                                  style={{ transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }} />
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
                      const rowColor = rowSt === "approved" ? "#16a34a" : rowSt === "pending" ? "#f59e0b" : null;

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
                                              <p className="text-xs font-medium truncate" style={{ color: "var(--w2)" }}>{d.file_name}</p>
                                              <p className="text-[10.5px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>
                                                <span className="font-semibold" style={{ color: dsc.txt }}>
                                                  {d.status === "approved" ? (lang === "fr" ? "Approuvé" : lang === "de" ? "Genehmigt" : "Approved") : d.status === "rejected" ? (lang === "fr" ? "Refusé" : lang === "de" ? "Abgelehnt" : "Rejected") : (lang === "fr" ? "En attente" : lang === "de" ? "Ausstehend" : "Pending")}
                                                </span>
                                              </p>
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
                                                  onClick={(e) => { e.stopPropagation(); setRevokeMenu(prev => prev === d.id ? null : d.id); }}
                                                  title="More actions" aria-label="More actions"
                                                  className="bv-icon-btn w-6 h-6 flex items-center justify-center rounded-full bv-touch"
                                                  style={{ color: "var(--w2)" }}
                                                ><MoreHorizontal size={11} strokeWidth={1.8} /></button>
                                                {revokeMenu === d.id && (
                                                  <>
                                                    <div className="fixed inset-0 z-10" onClick={() => setRevokeMenu(null)} />
                                                    <div className="absolute right-0 top-full mt-1 z-20 rounded-xl overflow-hidden"
                                                      style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 160, borderRadius: "var(--r-md)" }}>
                                                      {d.status === "approved" && (
                                                        <button
                                                          onClick={() => { setRevokeMenu(null); openRejectModal({ kind: "doc", docId: d.id, label: d.file_name, initialFeedback: d.feedback ?? "" }); }}
                                                          disabled={saving[d.id]}
                                                          className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                                          style={{ color: "var(--danger)" }}>
                                                          <RotateCcw size={11} strokeWidth={1.8} /> Revoke
                                                        </button>
                                                      )}
                                                    </div>
                                                  </>
                                                )}
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
                                  {doc.status === "pending" && !doc.uploaded_by_admin && (
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
                                        onClick={(e) => { e.stopPropagation(); setRevokeMenu(prev => prev === doc.id ? null : doc.id); }}
                                        title="More actions" aria-label="More actions"
                                        className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                        style={{ color: "var(--w2)" }}>
                                        <MoreHorizontal size={14} strokeWidth={1.8} />
                                      </button>
                                      {revokeMenu === doc.id && (
                                        <>
                                          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setRevokeMenu(null); }} />
                                          <div className="absolute right-0 top-full mt-1 z-20 rounded-xl overflow-hidden"
                                            style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 160, borderRadius: "var(--r-md)" }}>
                                            {item.key === "cv_de" && selectedUser && (
                                              <button
                                                onClick={(e) => { e.stopPropagation(); setRevokeMenu(null); window.open(`/portal/cv-builder?candidateId=${selectedUser}`, "_blank"); }}
                                                className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                                style={{ color: "var(--w)" }}>
                                                <FilePen size={11} strokeWidth={1.8} /> Edit CV
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
                                          </div>
                                        </>
                                      )}
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
            <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bv-modal-outer">
              <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
                style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
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
              setSigAdminSig(result);
              setSigAdminBgRemoving(true);
              Promise.all([removeImageBg(result), new Promise(r => setTimeout(r, 2200))])
                .then(([clean]) => { setSigAdminSig(clean); setSigAdminBgRemoving(false); });
            }
          };
          reader.readAsDataURL(file);
          e.target.value = "";
        }}
      />

      {/* ── Edit slot label modal ── */}
      {editingSlotId && (
        <div className="fixed inset-0 z-[800] flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
          onClick={() => setEditingSlotId(null)}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
            style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)" }}
            onClick={e => e.stopPropagation()}>
            <p className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>Edit slot label</p>
            <input type="text" placeholder="Label" value={editingSlotLabel}
              onChange={e => setEditingSlotLabel(e.target.value)} autoFocus
              className="w-full px-3 py-2.5 text-[13px] outline-none"
              style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--w)" }} />
            <input type="text" placeholder="Label translated (optional — dual slots)" value={editingSlotLabelTrans}
              onChange={e => setEditingSlotLabelTrans(e.target.value)}
              className="w-full px-3 py-2.5 text-[13px] outline-none"
              style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--w)" }} />
            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditingSlotId(null)}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold transition-all"
                style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                Cancel
              </button>
              <button onClick={() => saveSlotLabel(editingSlotId!, editingSlotLabel, editingSlotLabelTrans)}
                disabled={!editingSlotLabel.trim()}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-40"
                style={{ background: "var(--gold)", color: "#131312" }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Signature request modal ── */}
      {sigModal && (
        <div data-bv-sigmodal="1" className="fixed inset-0 z-[2147483600] flex items-center justify-center p-3 sm:p-6"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(10px)", position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
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
                <p className="text-[13.5px] font-semibold truncate tracking-tight" style={{ color: "var(--w)" }}>{sigModal.label}</p>
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
            {sigPdfBase64 && (sigMode === "admin-only" || sigZones.some(z => z.party === "admin")) && (
              <div className="flex-shrink-0 px-3 pt-3 pb-1" style={{ borderTop: "1px solid var(--border)" }}>
                <AdminSigSection party="admin" lang={lang}
                  sig={sigAdminSig} wantSave={sigAdminWantSave} bgRemoving={sigAdminBgRemoving}
                  onSig={setSigAdminSig} onWantSave={setSigAdminWantSave}
                  onUpload={() => { setSigUploadTarget("admin"); sigAdminUploadRef.current?.click(); }}
                  onDropFile={file => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = reader.result as string;
                      setSigAdminSig(result);
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
                      <button onClick={() => doSubmit("download")} disabled={sigSending || !hasPdf}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-opacity disabled:opacity-40"
                        style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
                        {sigSending ? spin : <><Download size={13} strokeWidth={2} /> {lang === "fr" ? "Télécharger" : lang === "de" ? "Herunterladen" : "Download"}</>}
                      </button>
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
            onSign={() => { setPreviewDoc(null); setShowPassportInfo(false); setSigModal({ docId: previewDoc.id, driveFileId: previewDoc.drive_file_id ?? null, label: previewDoc.file_name }); }}
            sideBySide={
              /pass/i.test(previewDoc.file_type)
              && (previewDoc.status !== "approved" || (profiles[previewDoc.user_id]?.passport_status !== "approved"))
              && showPassportInfo
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
                              transition: "color 0.2s, transform 0.2s, background 0.2s",
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
              <div className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--card)", borderRadius: "0 0 var(--r-xl) var(--r-xl)" }}>
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

          </div>
          )}

          {/* ── New-org modal ── */}
          {newOrgModal && typeof window !== "undefined" && createPortal(
            <>
              <div className="fixed inset-0 z-[800] bg-black/40 backdrop-blur-sm" onClick={() => !newOrgCreating && setNewOrgModal(false)} />
              <div className="fixed inset-0 z-[801] flex items-center justify-center p-4">
                <div className="w-full max-w-sm rounded-2xl overflow-hidden"
                  style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
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
              </div>
            </>,
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

      {/* ── Edit slot label modal ── */}
      {editingSlotId && (
        <div className="fixed inset-0 z-[800] flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
          onClick={() => setEditingSlotId(null)}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
            style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)" }}
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
            <input
              type="text"
              placeholder="Label translated (optional — dual slots)"
              value={editingSlotLabelTrans}
              onChange={e => setEditingSlotLabelTrans(e.target.value)}
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
                onClick={() => saveSlotLabel(editingSlotId!, editingSlotLabel, editingSlotLabelTrans)}
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
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(10px)", position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
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
                <p className="text-[13.5px] font-semibold truncate tracking-tight" style={{ color: "var(--w)" }}>{sigModal.label}</p>
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
            {sigPdfBase64 && (sigMode === "admin-only" || sigZones.some(z => z.party === "admin")) && (
              <div className="flex-shrink-0 px-3 pt-3 pb-1" style={{ borderTop: "1px solid var(--border)" }}>
                <AdminSigSection party="admin" lang={lang}
                  sig={sigAdminSig} wantSave={sigAdminWantSave} bgRemoving={sigAdminBgRemoving}
                  onSig={setSigAdminSig} onWantSave={setSigAdminWantSave}
                  onUpload={() => { setSigUploadTarget("admin"); sigAdminUploadRef.current?.click(); }}
                  onDropFile={file => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = reader.result as string;
                      setSigAdminSig(result);
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
                      <button onClick={() => doSubmit("download")} disabled={sigSending || !hasPdf}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-opacity disabled:opacity-40"
                        style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
                        {sigSending ? spin : <><Download size={13} strokeWidth={2} /> {lang === "fr" ? "Télécharger" : lang === "de" ? "Herunterladen" : "Download"}</>}
                      </button>
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


