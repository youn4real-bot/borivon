"use client";

import React, { useEffect, useState } from "react";
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
import { X as XIcon, RotateCcw, Download, ArrowLeft, MoreHorizontal, ChevronDown, Search, Trash2 } from "lucide-react";
import { Spinner, PageLoader, EmptyState } from "@/components/ui/states";
import { CandidateStagePreview, type JourneyMode } from "@/components/JourneyView";
import { VerifiedBadge } from "@/components/VerifiedBadge";

// ── File key → all possible translated labels ─────────────────────────────────
const FILE_KEY_ALL_LABELS: Record<string, Set<string>> = (() => {
  const keyToTKey: Record<string, keyof typeof translations.fr> = {
    id: "pTypeID", cv: "pTypeCV", langcert: "pTypeLangCert",
    diploma: "pTypeDiploma", studyprog: "pTypeStudyProg", transcript: "pTypeTranscript",
    abitur: "pTypeAbitur", abitur_transcript: "pTypeAbiturTranscript", praktikum: "pTypePraktikum",
    workcert: "pTypeWorkCert", letter: "pTypeLetter", other: "pTypeOther",
    work_experience: "pTypeWorkExp",
    cv_de: "pTypeCVde", diploma_de: "pTypeDiplomaDE", studyprog_de: "pTypeStudyProgDE",
    transcript_de: "pTypeTranscriptDE", abitur_de: "pTypeAbiturDE",
    abitur_transcript_de: "pTypeAbiturTranscriptDE", praktikum_de: "pTypePraktikumDE",
    workcert_de: "pTypeWorkcertDE", work_experience_de: "pTypeWorkExpDE",
  };
  const result: Record<string, Set<string>> = {};
  for (const [fileKey, tKey] of Object.entries(keyToTKey)) {
    result[fileKey] = new Set(Object.values(translations).map(lang => lang[tKey] as string));
  }
  result["workcert"].add("Berufserlaubnis");
  result["abitur_transcript"].add("Abitur Transcript");
  return result;
})();

const ADMIN_PHASES: { title: string; shortTitle: string; kind: PhaseKind; keys: string[] }[] = [
  // cv_de (Lebenslauf) lives in ID & CV — it's the candidate's primary CV.
  // Language certificate + free-form Other now live here too (the standalone
  // "Others" phase was removed to keep the admin pipeline aligned with the
  // candidate dashboard).
  { title: "ID & CV",      shortTitle: "ID",      kind: "id",           keys: ["id", "cv_de", "letter", "langcert", "other"] },
  { title: "Nursing",      shortTitle: "Nursing", kind: "nursing",      keys: ["diploma", "studyprog", "transcript", "abitur", "abitur_transcript", "praktikum", "workcert", "work_experience"] },
  { title: "Translations", shortTitle: "Trans.",  kind: "translations", keys: ["diploma_de", "studyprog_de", "transcript_de", "abitur_de", "abitur_transcript_de", "praktikum_de", "workcert_de", "work_experience_de"] },
];

function getPhaseIdx(fileType: string): number {
  for (let i = 0; i < ADMIN_PHASES.length; i++) {
    for (const key of ADMIN_PHASES[i].keys) {
      if (FILE_KEY_ALL_LABELS[key]?.has(fileType)) return i;
    }
  }
  return ADMIN_PHASES.length - 1;
}

type Doc = {
  id: string;
  user_id: string;
  file_name: string;
  file_type: string;
  uploaded_at: string;
  status: string;
  feedback: string | null;
  drive_file_id: string | null;
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
};
const DEFAULT_PIPELINE: AdminPipeline = {
  interview_link: "", interview_date: "", interview_status: "pending",
  recognition_unlocked: false, embassy_unlocked: false,
  visa_granted: false, visa_date: "", flight_date: "", flight_info: "",
  docs_approved: false,
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

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = diff / 3_600_000;
  const d = diff / 86_400_000;
  if (h < 48) return { isNew: true,  label: h < 1 ? "Just now" : `${Math.floor(h)}h ago` };
  if (d < 7)  return { isNew: false, label: `${Math.floor(d)}d ago` };
  return           { isNew: false, label: fmtDate(iso) };
}

// ── Preview modal moved to components/AdminDocPreviewModal.tsx ────────────────

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter();
  const { lang } = useLang();
  const t = translations[lang];
  const [accessToken, setAccessToken] = useState("");
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
  const [showArchive, setShowArchive]   = useState(false);
  const [expandedRow, setExpandedRow]   = useState<string | null>(null);
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
  // Passport DATA PDF download state (passport info modal)
  const [passportDataPdfDl, setPassportDataPdfDl] = useState(false);
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
        } : DEFAULT_PIPELINE);
        setPipelineLoaded(true);
      })
      .catch(err => { if (err.name !== "AbortError") console.error("Pipeline fetch error:", err); });
    return () => { mounted = false; controller.abort(); };
  }, [selectedUser, accessToken]);

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
      showError("Failed to save pipeline — please try again.");
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
      showError("Failed to save profile — please try again.");
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
      showError("Failed to update passport status — please try again.");
    } finally {
      setPassportInfoSaving(false);
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
        showError("Could not update verification — please try again.");
      }
    } catch (err) {
      console.error("toggleManualVerify error:", err);
      setProfiles(prev => ({
        ...prev,
        [selectedUser]: { ...prev[selectedUser], manually_verified: current },
      }));
      showError("Network error — please try again.");
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
      showError("Failed to save passport info — please try again.");
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
      showError("Failed to update document status — please try again.");
    } finally {
      setSaving(s => ({ ...s, [docId]: false }));
    }
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
        const msgBody = text.trim() ? text.trim() : `Rejected: ${rejectTarget.label}`;
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

      const PHASE_COUNT = 4; // ID, Nursing, Translations, Others
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
      if (e.key >= "1" && e.key <= "4") {
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

  // Archived: candidates with zero pending docs
  const archivedUserIds = Object.keys(grouped)
    .filter(uid => !grouped[uid].some(d => d.status === "pending"))
    .sort((a, b) => {
      const la = Math.max(...grouped[a].map(d => new Date(d.uploaded_at).getTime()));
      const lb = Math.max(...grouped[b].map(d => new Date(d.uploaded_at).getTime()));
      return lb - la;
    });

  const totalPending = docs.filter(d => d.status === "pending").length;

  // ── DETAIL VIEW ──────────────────────────────────────────────────────────────
  if (selectedUser) {
    const allDocs     = grouped[selectedUser] ?? [];
    const user        = users[selectedUser] ?? { name: selectedUser, email: selectedUser };
    const pendingDocs = allDocs.filter(d => d.status === "pending");

    // ── Same phase/item structure as candidate portal ──────────────────────────
    const PHASE_ITEMS: { title: string; shortTitle: string; kind: PhaseKind; items: { key: string; label: string; optional?: boolean }[] }[] = [
      { title: t.pWizardPhase1, shortTitle: t.pSideID,      kind: "id", items: [
        { key: "id",               label: t.pTypeID },
        // "Passport Data" is no longer a standalone row. The extracted
        // passport data lives behind a "Passport data" button inside the
        // passport doc preview modal — see AdminDocPreviewModal.
        // The Lebenslauf (German CV) lives here, not in Translations — it's
        // the candidate's primary CV document, generated by the CV builder
        // and uploaded as fileKey "cv_de".
        { key: "cv_de",            label: t.pTypeCVde },
        { key: "letter",           label: t.pTypeLetter },
        // Language certificate + free-form Other moved here from the
        // (deleted) "Others" phase to mirror the candidate dashboard.
        { key: "langcert",         label: t.pTypeLangCert },
        { key: "other",            label: t.pTypeOther },
      ]},
      { title: t.pWizardPhase2, shortTitle: t.pSideNursing,  kind: "nursing", items: [
        { key: "diploma",           label: t.pTypeDiploma,          optional: false },
        { key: "studyprog",         label: t.pTypeStudyProg,        optional: false },
        { key: "transcript",        label: t.pTypeTranscript,       optional: false },
        { key: "abitur",            label: t.pTypeAbitur,           optional: false },
        { key: "abitur_transcript", label: t.pTypeAbiturTranscript, optional: false },
        { key: "praktikum",         label: t.pTypePraktikum,        optional: false },
        { key: "workcert",          label: t.pTypeWorkCert,         optional: false },
        { key: "work_experience",   label: t.pTypeWorkExp,          optional: true  },
      ]},
      { title: t.pWizardPhase3, shortTitle: t.pSideTrans,    kind: "translations", items: [
        // cv_de removed — the Lebenslauf belongs to ID & CV (Phase 1), not
        // Translations. Translations are only for diplomas/transcripts/etc.
        { key: "diploma_de",           label: t.pTypeDiplomaDE },
        { key: "studyprog_de",         label: t.pTypeStudyProgDE },
        { key: "transcript_de",        label: t.pTypeTranscriptDE },
        { key: "abitur_de",            label: t.pTypeAbiturDE },
        { key: "abitur_transcript_de", label: t.pTypeAbiturTranscriptDE },
        { key: "praktikum_de",         label: t.pTypePraktikumDE },
        { key: "workcert_de",          label: t.pTypeWorkcertDE },
        { key: "work_experience_de",   label: t.pTypeWorkExpDE, optional: true },
      ]},
    ] as const;

    // Helper: get all docs for a file key
    function getAdminDocs(key: string): Doc[] {
      if (key === "passport_data_pdf") {
        const p = profiles[selectedUser ?? ""];
        if (!p || !p.passport_status) return [];
        const fn = (p.first_name ?? "vorname").toLowerCase().replace(/\s+/g, "_");
        const ln = (p.last_name  ?? "nachname").toLowerCase().replace(/\s+/g, "_");
        return [{ id: "passport_data_pdf", user_id: selectedUser ?? "", file_name: `${fn}_${ln}_reisepass_daten.pdf`, file_type: "Reisepass Daten", uploaded_at: new Date().toISOString(), status: p.passport_status, feedback: null, drive_file_id: null }];
      }
      const labels = FILE_KEY_ALL_LABELS[key];
      return labels ? allDocs.filter(d => labels.has(d.file_type)) : [];
    }

    // Sidebar color per phase (same logic as candidate portal)
    function phaseColor(pi: number): "empty" | "pending" | "approved" | "rejected" {
      const items = PHASE_ITEMS[pi].items;
      let anySubmitted = false, anyRejected = false, anyPending = false, allApproved = true;
      for (const item of items) {
        const ds = getAdminDocs(item.key);
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
          showError(j.error ?? "Failed to delete candidate");
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
              zIndex: 9999, pointerEvents: "none",
              background: "rgba(224,82,82,0.12)", color: "#e05252",
              border: "1px solid rgba(224,82,82,0.3)", borderRadius: 10,
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
              && (previewDoc.status !== "approved" || (profiles[previewDoc.user_id]?.passport_status !== "approved"))
              && showPassportInfo
            }
          />
        )}

        {/* Passport Info Modal — with approve / reject / edit */}
        {showPassportInfo && (() => {
          const pst = p_info?.passport_status ?? null;
          const pstBg    = pst === "approved" ? "rgba(52,199,89,0.12)"   : pst === "rejected" ? "rgba(224,82,82,0.12)"  : "rgba(212,175,55,0.12)";
          const pstColor = pst === "approved" ? "#34c759"                : pst === "rejected" ? "#e05252"               : "var(--gold)";
          const pstBdr   = pst === "approved" ? "rgba(52,199,89,0.3)"   : pst === "rejected" ? "rgba(224,82,82,0.3)"   : "rgba(212,175,55,0.35)";
          const pstLabel = pst === "approved" ? "Approved" : pst === "rejected" ? "Rejected" : pst === "pending" ? "Pending review" : "Not submitted";

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
                  style={{ borderBottom: "1px solid var(--border-gold)", background: "rgba(212,175,55,0.06)" }}>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--gold)" }}>
                      <IdCard size={13} strokeWidth={1.8} className="inline mr-1.5 -mt-0.5" /> Passport data
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
                        style={{ background: passportInfoEditMode ? "rgba(74,144,217,0.15)" : "var(--bg2)", color: passportInfoEditMode ? "#4a90d9" : "var(--w3)", border: `1px solid ${passportInfoEditMode ? "rgba(74,144,217,0.4)" : "var(--border)"}` }}>
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
                      <p className="text-sm font-medium" style={{ color: "var(--w2)" }}>No passport data yet</p>
                      <p className="text-xs mt-1" style={{ color: "var(--w3)" }}>Data will appear once the candidate confirms their passport details</p>
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
                        <p className="text-[10px]" style={{ color: "#e08a00" }}>
                          Compare each field against the passport document.
                        </p>
                        <div className="flex items-center gap-1.5">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <rect x="1" y="1" width="14" height="14" rx="3" stroke="#f59e0b" strokeWidth="1.5"/>
                          </svg>
                          <span style={{ color: "#aaa", fontSize: 9 }}>→</span>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <rect width="16" height="16" rx="3.5" fill="#22c55e"/>
                            <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <p className="text-[10px]" style={{ color: "#e08a00" }}>
                            Tick every box to confirm, then Approve.
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
                                      <rect width="16" height="16" rx="3.5" fill="#22c55e"/>
                                      <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  ) : (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                      <rect x="1" y="1" width="14" height="14" rx="3" stroke="#f59e0b" strokeWidth="1.5"/>
                                      <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.35"/>
                                    </svg>
                                  )}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px]" style={{ color: "var(--w3)" }}>{f.label}</p>
                                  <p className="text-xs font-semibold" style={{ color: "warn" in f && f.warn ? "#e05252" : "var(--w)" }}>
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
                  <div className="px-5 py-3 flex-shrink-0 flex items-center gap-2"
                    style={{ borderTop: "1px solid var(--border)" }}>
                    {passportInfoEditMode ? (
                      <>
                        <button
                          onClick={savePassportInfo}
                          disabled={passportInfoSaving || Object.keys(passportInfoEdits).length === 0}
                          className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                          style={{ background: "rgba(74,144,217,0.15)", color: "#4a90d9" }}>
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
                          style={{ background: "rgba(52,199,89,0.12)", color: "#34c759" }}>
                          {passportInfoSaving ? "…" : <><CheckCircle2 size={13} strokeWidth={1.8} /> Approve</>}
                        </button>
                        <button
                          onClick={() => reviewPassport("rejected")}
                          disabled={passportInfoSaving || pst === "rejected"}
                          className="flex-1 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                          style={{ background: "rgba(224,82,82,0.1)", color: "#e05252" }}>
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
                )}
              </div>
            </div>
          );
        })()}

        <main className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "calc(61px + 2rem)" }}>
          <div className="max-w-[780px] mx-auto px-4 pt-8 pb-16">

            {/* ── Back + premium candidate header ──
                Top-of-detail hero: round photo (or initial) on the left, name
                + email centered, status pills + actions clustered on the
                right. Sits on a CV-builder-style card surface (20px rounded,
                soft 1px shadow). */}
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => { setSelectedUser(null); }}
                aria-label="Back"
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
                      style={{ background: showHistory ? "rgba(212,175,55,0.12)" : "var(--bg2)", color: showHistory ? "var(--gold)" : "var(--w3)", border: `1px solid ${showHistory ? "rgba(212,175,55,0.3)" : "var(--border)"}` }}>
                      <Folder size={11} strokeWidth={1.8} /> {historyForUser.length} old
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
                <h1 className="text-[20px] font-semibold tracking-[-0.015em] inline-flex items-center gap-1 max-w-full" style={{ color: "var(--w)" }}>
                  <span className="truncate">{user.name}</span>
                  <VerifiedBadge verified={!!profiles[selectedUser]?.manually_verified} size="sm" />
                </h1>
                <p className="text-[12.5px] mt-1 truncate" style={{ color: "var(--w3)" }}>{user.email}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
                {pendingDocs.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
                    style={{ background: "rgba(201,162,64,0.12)", color: "#c9a240", border: "1px solid rgba(201,162,64,0.25)" }}>
                    {pendingDocs.length} {t.aPending}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[10.5px] px-3 py-1.5 rounded-full font-semibold tracking-wide uppercase"
                    style={{ background: "rgba(52,199,89,0.10)", color: "#34c759", border: "1px solid rgba(52,199,89,0.25)" }}>
                    <CheckCircle2 size={11} strokeWidth={1.8} /> {t.aDone}
                  </span>
                )}
                {/* Manual verification override — only the ultimate admin */}
                {(() => {
                  const isManual = !!profiles[selectedUser ?? ""]?.manually_verified;
                  return (
                    <button
                      onClick={toggleManualVerify}
                      title={isManual
                        ? "Manually verified — click to revoke the blue tick"
                        : "Grant the blue verified tick (overrides document checks)"}
                      aria-label="Toggle manual verification"
                      className="inline-flex items-center gap-1.5 text-[10.5px] px-3 py-1.5 rounded-full font-semibold tracking-wide uppercase transition-colors">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill={isManual ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                        style={{ color: isManual ? "#1da1f2" : "var(--w3)" }}>
                        <path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.3l-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z"/>
                      </svg>
                      <span style={isManual
                        ? { color: "#1da1f2" }
                        : { color: "var(--w3)" }}>
                        {isManual ? "Verified" : "Verify"}
                      </span>
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* Always two-column: sidebar + content */}
            <div className="flex gap-4 sm:gap-6 items-start">

              {/* Sidebar — doc phases + journey stages */}
              <aside className="shrink-0 w-[60px] sm:w-[72px]"
                style={{ position: "sticky", top: "calc(61px + 1.5rem)" }}>

                {/* Doc phase circles — blue only on active, plain otherwise */}
                {PHASE_ITEMS.map((ph, i) => {
                  const isActive   = i === activePhase && !activePipelineStage;
                  const pendingCnt = ph.items.reduce((n, item) => n + getAdminDocs(item.key).filter(d => d.status === "pending").length, 0);

                  return (
                    <div key={i} className="flex flex-col items-center">
                      <button onClick={() => { setActivePhase(i); setActivePipelineStage(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                        title={ph.title}
                        className="bv-lift-hover w-full flex flex-col items-center gap-1.5 py-1.5">
                        <span className="relative flex items-center justify-center w-10 h-10 rounded-full leading-none select-none transition-all duration-300"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: isActive ? "var(--gold)" : "var(--w3)",
                            transform: isActive ? "scale(1.08)" : "scale(1)",
                            transition: "color 0.2s, transform 0.15s",
                          }}>
                          <PhaseIcon kind={ph.kind} size={17} />
                          {pendingCnt > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center px-1"
                              style={{ background: "var(--gold)", color: "#131312", border: "1.5px solid var(--bg)" }}>{pendingCnt}</span>
                          )}
                        </span>
                        <span className="text-[9px] sm:text-[10px] text-center leading-tight font-medium px-0.5 w-full"
                          style={{ color: isActive ? "var(--gold)" : "var(--w3)" }}>{ph.shortTitle}</span>
                      </button>
                      {i < PHASE_ITEMS.length - 1 && <div className="w-px" style={{ height: 18, background: "var(--border)" }} />}
                    </div>
                  );
                })}

                {/* Separator */}
                <div className="w-full my-2" style={{ height: 1, background: "var(--border)" }} />

                {/* Journey stage icons — click to show that stage on the right */}
                {([
                  { key: "docs",        kind: "docs"        as PhaseKind, label: "Docs",      active: pipeline.docs_approved },
                  { key: "interview",   kind: "interview"   as PhaseKind, label: "Interview", active: pipeline.interview_status === "passed" || pipeline.interview_status === "failed" || !!pipeline.interview_link },
                  { key: "recognition", kind: "recognition" as PhaseKind, label: "Recog.",    active: pipeline.recognition_unlocked },
                  { key: "embassy",     kind: "embassy"     as PhaseKind, label: "Embassy",   active: pipeline.embassy_unlocked },
                  { key: "visa",        kind: "visa"        as PhaseKind, label: "Visa",      active: pipeline.visa_granted },
                  { key: "flight",      kind: "flight"      as PhaseKind, label: "Flight",    active: !!pipeline.flight_date },
                ]).map((js, ji, arr) => {
                  const isSel = activePipelineStage === js.key;
                  return (
                    <div key={js.label} className="flex flex-col items-center">
                      <button
                        onClick={() => { setActivePipelineStage(isSel ? null : js.key); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                        title={js.label}
                        className="bv-lift-hover w-full flex flex-col items-center gap-1 py-1"
                        style={{ background: "transparent", border: "none", cursor: "pointer" }}>
                        <span className="relative flex items-center justify-center w-9 h-9 rounded-full leading-none select-none transition-all duration-300"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: isSel ? "var(--gold)" : js.active ? "#34c759" : "var(--w3)",
                            transform: isSel ? "scale(1.08)" : "scale(1)",
                            transition: "color 0.2s, transform 0.15s",
                          }}>
                          <PhaseIcon kind={js.kind} size={15} />
                          {!js.active && !isSel && (
                            <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full"
                              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                              <Lock size={7} strokeWidth={2.2} style={{ color: "var(--w3)" }} />
                            </span>
                          )}
                        </span>
                        <span className="text-[9px] text-center leading-tight font-medium"
                          style={{ color: isSel ? "var(--gold)" : js.active ? "#34c759" : "var(--w3)" }}>
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
                    {/* Pipeline stage header — refined rhythm */}
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                          style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-md)" }}>
                          <PhaseIcon kind={activePipelineStage as PhaseKind} size={17} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--w3)" }}>Pipeline stage</p>
                          <h2 className="text-[20px] font-semibold tracking-[-0.015em] leading-tight" style={{ color: "var(--w)" }}>
                            {activePipelineStage === "docs" ? "Documents"
                              : activePipelineStage === "interview" ? "Interview"
                              : activePipelineStage === "recognition" ? "Recognition"
                              : activePipelineStage === "embassy" ? "Embassy"
                              : activePipelineStage === "visa" ? "Visa"
                              : "Flight"}
                          </h2>
                        </div>
                      </div>
                      <button onClick={savePipeline} disabled={pipelineSaving || !pipelineLoaded}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold transition-all disabled:opacity-40"
                        style={{
                          background: pipelineSaved ? "rgba(52,199,89,0.15)" : "var(--gold)",
                          color: pipelineSaved ? "#34c759" : "#131312",
                          border: pipelineSaved ? "1px solid rgba(52,199,89,0.32)" : "1px solid var(--gold)",
                          borderRadius: "var(--r-sm)",
                          boxShadow: pipelineSaved ? "none" : "var(--shadow-sm)",
                        }}>
                        {pipelineSaving ? "Saving…" : pipelineSaved ? <><CheckCircle2 size={12} strokeWidth={1.8} /> Saved</> : t.aPipelineSave}
                      </button>
                    </div>
                    {activePipelineStage === "docs" && (() => { const on = pipeline.docs_approved; return (
                      <div className="flex items-center gap-3 px-4 py-3.5" style={{ background: "var(--card)", border: `1px solid ${on ? "rgba(52,199,89,0.3)" : "var(--border)"}`, borderRadius: "var(--r-lg)" }}>
                        <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                          style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-md)" }}>
                          <Folder size={16} strokeWidth={1.7} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>Documents</p>
                          <p className="text-[11.5px] mt-0.5 inline-flex items-center gap-1" style={{ color: on ? "#34c759" : "var(--w3)" }}>
                            {on ? <><CheckCircle2 size={11} strokeWidth={2} /> Next step unlocked</> : "Next button locked for candidate"}
                          </p>
                        </div>
                        <button onClick={() => setPipeline(p => ({ ...p, docs_approved: !on }))}
                          className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 flex-shrink-0 transition-all"
                          style={{ background: on ? "rgba(52,199,89,0.12)" : "var(--bg2)", color: on ? "#34c759" : "var(--w2)", border: `1px solid ${on ? "rgba(52,199,89,0.3)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                          {on ? <><Lock size={11} strokeWidth={1.8} /> Lock</> : <><Unlock size={11} strokeWidth={1.8} /> Unlock</>}
                        </button>
                      </div>
                    ); })()}
                    {activePipelineStage === "interview" && (
                      <div className="overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
                        <div className="flex items-center gap-3 px-4 py-3.5">
                          <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-md)" }}>
                            <PhaseIcon kind="interview" size={16} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{t.pJourneyInterview}</p>
                            <p className="text-[11.5px] mt-0.5 inline-flex items-center gap-1" style={{ color: pipeline.interview_status === "passed" ? "#34c759" : pipeline.interview_status === "failed" ? "#e05252" : pipeline.interview_link ? "var(--gold)" : "var(--w3)" }}>
                              {pipeline.interview_status === "passed" ? <><CheckCircle2 size={11} strokeWidth={2} /> Passed</>
                                : pipeline.interview_status === "failed" ? <><XCircle size={11} strokeWidth={2} /> Failed</>
                                : pipeline.interview_link ? "Scheduled" : "Not scheduled yet"}
                            </p>
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0">
                            {(["passed","failed","pending"] as const).map(s => (
                              <button key={s} onClick={() => setPipeline(p => ({ ...p, interview_status: s }))}
                                title={s} aria-label={s}
                                className="w-7 h-7 flex items-center justify-center font-semibold transition-all"
                                style={{ background: pipeline.interview_status === s ? s === "passed" ? "rgba(52,199,89,0.18)" : s === "failed" ? "rgba(224,82,82,0.12)" : "rgba(201,162,64,0.12)" : "var(--bg2)", color: pipeline.interview_status === s ? s === "passed" ? "#34c759" : s === "failed" ? "#e05252" : "var(--gold)" : "var(--w3)", border: `1px solid ${pipeline.interview_status === s ? s === "passed" ? "rgba(52,199,89,0.3)" : s === "failed" ? "rgba(224,82,82,0.25)" : "rgba(201,162,64,0.3)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                                {s === "passed" ? <CheckCircle2 size={13} strokeWidth={1.8} /> : s === "failed" ? <XCircle size={13} strokeWidth={1.8} /> : <RotateCcw size={12} strokeWidth={1.8} />}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="px-4 pb-3.5 pt-2 grid grid-cols-2 gap-2.5" style={{ borderTop: "1px solid var(--border)" }}>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>Link</label>
                            <input type="url" value={pipeline.interview_link} onChange={e => setPipeline(p => ({ ...p, interview_link: e.target.value }))} placeholder="https://meet.google.com/..." className="w-full px-2.5 py-2 text-[11.5px] outline-none transition-colors" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "var(--r-sm)" }} />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>Date</label>
                            <input type="datetime-local" value={pipeline.interview_date} onChange={e => setPipeline(p => ({ ...p, interview_date: e.target.value }))} className="w-full px-2.5 py-2 text-[11.5px] outline-none transition-colors" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "var(--r-sm)" }} />
                          </div>
                        </div>
                      </div>
                    )}
                    {activePipelineStage === "recognition" && (() => { const on = pipeline.recognition_unlocked; return (
                      <div className="flex items-center gap-3 px-4 py-3.5" style={{ background: "var(--card)", border: `1px solid ${on ? "rgba(52,199,89,0.3)" : "var(--border)"}`, borderRadius: "var(--r-lg)" }}>
                        <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                          style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-md)" }}>
                          <PhaseIcon kind="recognition" size={16} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{t.pJourneyRecognition}</p>
                          <p className="text-[11.5px] mt-0.5 inline-flex items-center gap-1" style={{ color: on ? "#34c759" : "var(--w3)" }}>
                            {on ? <><CheckCircle2 size={11} strokeWidth={2} /> Unlocked</> : "Locked"}
                          </p>
                        </div>
                        <button onClick={() => setPipeline(p => ({ ...p, recognition_unlocked: !on }))}
                          className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 flex-shrink-0 transition-all"
                          style={{ background: on ? "rgba(52,199,89,0.12)" : "var(--bg2)", color: on ? "#34c759" : "var(--w2)", border: `1px solid ${on ? "rgba(52,199,89,0.3)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                          {on ? <><Lock size={11} strokeWidth={1.8} /> Lock</> : <><Unlock size={11} strokeWidth={1.8} /> Unlock</>}
                        </button>
                      </div>
                    ); })()}
                    {activePipelineStage === "embassy" && (() => { const on = pipeline.embassy_unlocked; return (
                      <div className="flex items-center gap-3 px-4 py-3.5" style={{ background: "var(--card)", border: `1px solid ${on ? "rgba(52,199,89,0.3)" : "var(--border)"}`, borderRadius: "var(--r-lg)" }}>
                        <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                          style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-md)" }}>
                          <PhaseIcon kind="embassy" size={16} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{t.pJourneyEmbassy}</p>
                          <p className="text-[11.5px] mt-0.5 inline-flex items-center gap-1" style={{ color: on ? "#34c759" : "var(--w3)" }}>
                            {on ? <><CheckCircle2 size={11} strokeWidth={2} /> Unlocked</> : "Locked"}
                          </p>
                        </div>
                        <button onClick={() => setPipeline(p => ({ ...p, embassy_unlocked: !on }))}
                          className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 flex-shrink-0 transition-all"
                          style={{ background: on ? "rgba(52,199,89,0.12)" : "var(--bg2)", color: on ? "#34c759" : "var(--w2)", border: `1px solid ${on ? "rgba(52,199,89,0.3)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                          {on ? <><Lock size={11} strokeWidth={1.8} /> Lock</> : <><Unlock size={11} strokeWidth={1.8} /> Unlock</>}
                        </button>
                      </div>
                    ); })()}
                    {activePipelineStage === "visa" && (
                      <div className="overflow-hidden" style={{ background: "var(--card)", border: `1px solid ${pipeline.visa_granted ? "rgba(52,199,89,0.3)" : "var(--border)"}`, borderRadius: "var(--r-lg)" }}>
                        <div className="flex items-center gap-3 px-4 py-3.5">
                          <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-md)" }}>
                            <PhaseIcon kind="visa" size={16} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{t.pJourneyVisa}</p>
                            <p className="text-[11.5px] mt-0.5 inline-flex items-center gap-1" style={{ color: pipeline.visa_granted ? "#34c759" : "var(--w3)" }}>
                              {pipeline.visa_granted ? <><CheckCircle2 size={11} strokeWidth={2} /> Granted</> : "Not granted yet"}
                            </p>
                          </div>
                          <button onClick={() => setPipeline(p => ({ ...p, visa_granted: !p.visa_granted }))}
                            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 flex-shrink-0 transition-all"
                            style={{ background: pipeline.visa_granted ? "rgba(52,199,89,0.12)" : "var(--bg2)", color: pipeline.visa_granted ? "#34c759" : "var(--w2)", border: `1px solid ${pipeline.visa_granted ? "rgba(52,199,89,0.3)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                            {pipeline.visa_granted
                              ? <><XCircle size={11} strokeWidth={1.8} /> Revoke</>
                              : <><CheckCircle2 size={11} strokeWidth={1.8} /> Grant</>}
                          </button>
                        </div>
                        {pipeline.visa_granted && (
                          <div className="px-4 pb-3.5 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                            <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>{t.aVisaDate}</label>
                            <input type="datetime-local" value={pipeline.visa_date} onChange={e => setPipeline(p => ({ ...p, visa_date: e.target.value }))} className="w-full px-2.5 py-2 text-[11.5px] outline-none transition-colors" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "var(--r-sm)" }} />
                          </div>
                        )}
                      </div>
                    )}
                    {activePipelineStage === "flight" && (
                      <div className="overflow-hidden" style={{ background: "var(--card)", border: `1px solid ${pipeline.flight_date ? "rgba(212,175,55,0.35)" : "var(--border)"}`, borderRadius: "var(--r-lg)" }}>
                        <div className="flex items-center gap-3 px-4 py-3.5">
                          <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-md)" }}>
                            <PhaseIcon kind="flight" size={16} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{t.pJourneyFlight}</p>
                            <p className="text-[11.5px] mt-0.5" style={{ color: pipeline.flight_date ? "var(--gold)" : "var(--w3)" }}>
                              {pipeline.flight_date ? new Date(pipeline.flight_date).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "No date set"}
                            </p>
                          </div>
                        </div>
                        <div className="px-4 pb-3.5 pt-2 grid grid-cols-2 gap-2.5" style={{ borderTop: "1px solid var(--border)" }}>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>{t.aFlightDate}</label>
                            <input type="date" value={pipeline.flight_date} onChange={e => setPipeline(p => ({ ...p, flight_date: e.target.value }))} className="w-full px-2.5 py-2 text-[11.5px] outline-none transition-colors" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "var(--r-sm)" }} />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: "var(--w3)" }}>{t.aFlightInfo}</label>
                            <input type="text" value={pipeline.flight_info} onChange={e => setPipeline(p => ({ ...p, flight_info: e.target.value }))} placeholder="e.g. RAM 704, CDG → FRA" className="w-full px-2.5 py-2 text-[11.5px] outline-none transition-colors" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "var(--r-sm)" }} />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Live candidate preview — shows exactly what the candidate sees
                        for this stage with the current pipeline state ── */}
                    {activePipelineStage !== "docs" && (
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
                          />
                        </div>
                      </div>
                    )}
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
                    {/* Phase header */}
                    <div className="flex items-center gap-3 px-6 pt-6 pb-3">
                      <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                        style={{ background: "var(--gdim)", color: "var(--gold)", borderRadius: "12px" }}>
                        <PhaseIcon kind={PHASE_ITEMS[activePhase].kind} size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--w3)" }}>Phase {activePhase + 1}</p>
                        <h2 className="text-[18px] font-semibold tracking-[-0.015em] leading-tight" style={{ color: "var(--w)" }}>
                          {PHASE_ITEMS[activePhase].title}
                        </h2>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium flex-shrink-0"
                        style={{ color: pendingDocs.length > 0 ? "var(--gold)" : "#34c759" }}>
                        {pendingDocs.length > 0
                          ? <><span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--gold)" }} />{pendingDocs.length} pending</>
                          : <><CheckCircle2 size={12} strokeWidth={1.8} /> All reviewed</>}
                      </span>
                    </div>

                    <div className="h-px mx-6" style={{ background: "var(--border)" }} />

                    {/* Doc slots — borderless rows inside the card */}
                    <div className="px-2 py-2">
                    {currentItems.map((item, idx) => {
                      // ── Special full render for Passport Data PDF ────────────────────────────
                      if (item.key === "passport_data_pdf") {
                        const p = profiles[selectedUser ?? ""];
                        const pst = p?.passport_status ?? null;
                        const hasData = !!pst;
                        const cSt = !hasData ? "empty" : pst === "approved" ? "approved" : pst === "rejected" ? "rejected" : "pending";
                        const sc2 = cSt === "approved" ? { bg: "rgba(52,199,89,0.10)",  txt: "#34c759", bdr: "1px solid rgba(52,199,89,0.28)" }
                                  : cSt === "rejected"  ? { bg: "rgba(224,82,82,0.08)",  txt: "#e05252", bdr: "1px solid rgba(224,82,82,0.24)" }
                                  : cSt === "pending"   ? { bg: "rgba(201,162,64,0.10)", txt: "#c9a240", bdr: "1px solid rgba(201,162,64,0.30)" }
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
                              <div className="flex items-start gap-3">
                                {/* Status circle */}
                                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                                  style={{ background: sc2.bg, color: sc2.txt, border: sc2.bdr }}>
                                  {cSymEl}
                                </div>
                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13.5px] font-medium tracking-tight" style={{ color: "var(--w)" }}>{item.label}</p>
                                  {!hasData && <p className="text-[11.5px] mt-0.5" style={{ color: "var(--w3)" }}>Not submitted yet</p>}
                                  {hasData && cSt === "rejected" && passportDataFeedback && (
                                    <p className="text-[11px] mt-1" style={{ color: "#e05252" }}>“{passportDataFeedback}”</p>
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
                                            <button onClick={() => { reviewPassport("rejected"); setRevokeMenu(null); }}
                                              className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                              style={{ color: "#e05252" }}><RotateCcw size={11} strokeWidth={1.8} /> Revoke</button>
                                            <div style={{ height: 1, background: "var(--border)" }} />
                                            <button onClick={() => { setRevokeMenu(null); openRejectModal({ kind: "passport", label: item.label, initialFeedback: passportDataFeedback }); }}
                                              className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                              style={{ color: "#e05252" }}><XCircle size={11} strokeWidth={1.8} /> Reject</button>
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
                      // ─────────────────────────────────────────────────────────────────────────

                      const isMulti   = item.key === "other";
                      const itemDocs  = getAdminDocs(item.key);
                      const doc       = isMulti ? undefined : itemDocs[0];
                      const submitted = isMulti ? itemDocs.length > 0 : !!doc;

                      // Aggregate status for multi-doc slots
                      const multiRej  = isMulti && itemDocs.some(d => d.status === "rejected");
                      const multiApp  = isMulti && itemDocs.length > 0 && itemDocs.every(d => d.status === "approved");

                      const circleStatus = !submitted ? "empty"
                        : isMulti ? (multiRej ? "rejected" : multiApp ? "approved" : "pending")
                        : doc!.status;

                      const sc =
                        circleStatus === "approved" ? { bg: "rgba(52,199,89,0.10)",  txt: "#34c759", bdr: "1px solid rgba(52,199,89,0.28)" }
                      : circleStatus === "rejected"  ? { bg: "rgba(224,82,82,0.08)",  txt: "#e05252", bdr: "1px solid rgba(224,82,82,0.24)" }
                      : circleStatus === "pending"   ? { bg: "rgba(201,162,64,0.10)", txt: "#c9a240", bdr: "1px solid rgba(201,162,64,0.30)" }
                      :                               { bg: "var(--bg2)",             txt: "var(--w3)", bdr: "1px solid var(--border)" };

                      const circleSymbolEl = circleStatus === "approved" ? <CheckCircle2 size={14} strokeWidth={1.8} />
                                          : circleStatus === "rejected" ? <XCircle      size={14} strokeWidth={1.8} />
                                          : circleStatus === "pending"  ? <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
                                          :                                <span className="w-1.5 h-1.5 rounded-full" style={{ border: "1px solid currentColor" }} />;

                      // Whole-row click previews the doc (admin parity with
                      // candidate portal). Inner action buttons stop
                      // propagation so they don't trigger the preview.
                      const adminRowClickable = !isMulti && submitted && doc?.drive_file_id;
                      const adminRowOnClick = adminRowClickable ? () => setPreviewDoc(doc!) : undefined;

                      return (
                        <div key={item.key}>
                          {idx > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                          <div
                            onClick={adminRowOnClick}
                            className={`px-3 py-3 transition-colors${adminRowClickable ? " bv-row-hover cursor-pointer" : ""}`}
                            style={{ minHeight: 60 }}>
                            <div className="flex items-start gap-3">

                              {/* Status circle — exact same as candidate portal */}
                              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                                style={{ background: sc.bg, color: sc.txt, border: sc.bdr }}>
                                {circleSymbolEl}
                              </div>

                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium" style={{ color: "var(--w)" }}>{item.label}</p>
                                  {"optional" in item && item.optional && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                                      style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                                      {t.pOptional}
                                    </span>
                                  )}
                                </div>

                                {/* Not submitted */}
                                {!submitted && (
                                  <p className="text-xs mt-0.5" style={{ color: "var(--w3)" }}>Not submitted yet</p>
                                )}

                                {/* Single-doc slot */}
                                {!isMulti && doc && (() => {
                                  const ta = timeAgo(doc.uploaded_at);
                                  return (
                                    <>
                                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        <span className="text-xs" style={{ color: "var(--w3)" }}>{ta.label}</span>
                                      </div>
                                      {doc.status === "rejected" && doc.feedback && (
                                        <p className="text-[11px] mt-1" style={{ color: "#e05252" }}>“{doc.feedback}”</p>
                                      )}
                                    </>
                                  );
                                })()}

                                {/* Multi-doc slot ("other") */}
                                {isMulti && itemDocs.length > 0 && (
                                  <div className="mt-2 space-y-2">
                                    {itemDocs.map(d => {
                                      const ta = timeAgo(d.uploaded_at);
                                      const dsc =
                                        d.status === "approved" ? { bg: "rgba(52,199,89,0.1)",  txt: "#34c759", bdr: "rgba(52,199,89,0.25)" }
                                      : d.status === "rejected"  ? { bg: "rgba(224,82,82,0.1)",  txt: "#e05252", bdr: "rgba(224,82,82,0.25)" }
                                      :                           { bg: "rgba(201,162,64,0.1)", txt: "#c9a240", bdr: "rgba(201,162,64,0.3)" };
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
                                                  {d.status === "approved" ? "Approved" : d.status === "rejected" ? "Rejected" : "Pending"}
                                                </span>
                                                <span className="mx-1"> · </span>
                                                {ta.label}
                                              </p>
                                            </div>
                                            {/* Download — always shown (parity with top-level peer rows) */}
                                            {d.drive_file_id && (
                                              <button
                                                onClick={(e) => { e.stopPropagation(); downloadDoc(d); }}
                                                title={t.aDownload} aria-label={t.aDownload}
                                                className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0"
                                                style={{ color: "var(--w2)" }}>
                                                <Download size={12} strokeWidth={1.8} />
                                              </button>
                                            )}
                                            {d.status === "pending" && (
                                              <>
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); openRejectModal({ kind: "doc", docId: d.id, label: d.file_name, initialFeedback: d.feedback ?? "" }); }}
                                                  disabled={saving[d.id]}
                                                  title="Reject" aria-label="Reject"
                                                  className="bv-icon-btn bv-icon-btn--reject w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 disabled:opacity-40">
                                                  <XCircle size={12} strokeWidth={1.8} />
                                                </button>
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); review(d.id, "approved"); }}
                                                  disabled={saving[d.id]}
                                                  title="Approve" aria-label="Approve"
                                                  className="bv-icon-btn bv-icon-btn--approve w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 disabled:opacity-40">
                                                  <CheckCircle2 size={12} strokeWidth={1.8} />
                                                </button>
                                              </>
                                            )}
                                            {d.status === "approved" && (
                                              <div className="relative flex-shrink-0">
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); setRevokeMenu(prev => prev === d.id ? null : d.id); }}
                                                  title="Revoke approval" aria-label="More actions"
                                                  className="bv-icon-btn w-6 h-6 flex items-center justify-center rounded-full bv-touch"
                                                  style={{ color: "var(--w2)" }}
                                                ><MoreHorizontal size={11} strokeWidth={1.8} /></button>
                                                {revokeMenu === d.id && (
                                                  <>
                                                    <div className="fixed inset-0 z-10" onClick={() => setRevokeMenu(null)} />
                                                    <div className="absolute right-0 top-full mt-1 z-20 rounded-xl overflow-hidden"
                                                      style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 160, borderRadius: "var(--r-md)" }}>
                                                      <button
                                                        onClick={() => { review(d.id, "rejected"); setRevokeMenu(null); }}
                                                        disabled={saving[d.id]}
                                                        className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                                        style={{ color: "#e05252" }}>
                                                        <RotateCcw size={11} strokeWidth={1.8} /> Revoke
                                                      </button>
                                                      <div style={{ height: 1, background: "var(--border)" }} />
                                                      <button
                                                        onClick={() => { setRevokeMenu(null); openRejectModal({ kind: "doc", docId: d.id, label: d.file_name, initialFeedback: d.feedback ?? "" }); }}
                                                        disabled={saving[d.id]}
                                                        className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                                        style={{ color: "#e05252" }}>
                                                        <XCircle size={11} strokeWidth={1.8} /> Reject
                                                      </button>
                                                    </div>
                                                  </>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                          {d.status === "rejected" && d.feedback && (
                                            <p className="text-[11px] mt-1.5" style={{ color: "#e05252" }}>“{d.feedback}”</p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {/* Right: single-row action icons —
                                  download / reject / approve. */}
                              {!isMulti && doc && (
                                <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                                  {doc.drive_file_id && (
                                    <button title={t.aDownload} aria-label={t.aDownload} onClick={(e) => { e.stopPropagation(); downloadDoc(doc); }}
                                      className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                      style={{ color: "var(--w2)" }}>
                                      <Download size={13} strokeWidth={1.8} />
                                    </button>
                                  )}
                                  {doc.status === "pending" && (
                                    <>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); openRejectModal({ kind: "doc", docId: doc.id, label: item.label, initialFeedback: doc.feedback ?? "" }); }}
                                        disabled={saving[doc.id]}
                                        title="Reject" aria-label="Reject"
                                        className="bv-icon-btn bv-icon-btn--reject w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40">
                                        <XCircle size={15} strokeWidth={1.8} />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); review(doc.id, "approved"); }}
                                        disabled={saving[doc.id]}
                                        title="Approve" aria-label="Approve"
                                        className="bv-icon-btn bv-icon-btn--approve w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40">
                                        <CheckCircle2 size={15} strokeWidth={1.8} />
                                      </button>
                                    </>
                                  )}
                                  {doc.status === "approved" && (
                                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setRevokeMenu(prev => prev === doc.id ? null : doc.id); }}
                                        title="Revoke approval" aria-label="More actions"
                                        className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                        style={{ color: "var(--w2)" }}>
                                        <MoreHorizontal size={14} strokeWidth={1.8} />
                                      </button>
                                      {revokeMenu === doc.id && (
                                        <>
                                          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setRevokeMenu(null); }} />
                                          <div className="absolute right-0 top-full mt-1 z-20 rounded-xl overflow-hidden"
                                            style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 160, borderRadius: "var(--r-md)" }}>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); review(doc.id, "rejected"); setRevokeMenu(null); }}
                                              disabled={saving[doc.id]}
                                              className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                              style={{ color: "#e05252" }}>
                                              <RotateCcw size={11} strokeWidth={1.8} /> Revoke
                                            </button>
                                            <div style={{ height: 1, background: "var(--border)" }} />
                                            <button
                                              onClick={(e) => { e.stopPropagation(); setRevokeMenu(null); openRejectModal({ kind: "doc", docId: doc.id, label: item.label, initialFeedback: doc.feedback ?? "" }); }}
                                              disabled={saving[doc.id]}
                                              className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                                              style={{ color: "#e05252" }}>
                                              <XCircle size={11} strokeWidth={1.8} /> Reject
                                            </button>
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
                          const stBg = st === "approved" ? "rgba(52,199,89,0.1)" : st === "rejected" ? "rgba(224,82,82,0.1)" : "rgba(201,162,64,0.1)";
                          const stCl = st === "approved" ? "#34c759" : st === "rejected" ? "#e05252" : "#c9a240";
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
            <div className="fixed inset-0 z-[1400] bg-black/40 backdrop-blur-sm" onClick={() => !deletingCandidate && setDeleteCandidateConfirm(false)} />
            <div className="fixed inset-0 z-[1401] flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
                style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center mb-1"
                    style={{ background: "rgba(255,59,48,0.1)" }}>
                    <Trash2 size={22} strokeWidth={1.6} style={{ color: "#ff3b30" }} />
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
                      background: deleteCandidateInput === "DELETE" && !deletingCandidate ? "#ff3b30" : "rgba(255,59,48,0.3)",
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
              && (previewDoc.status !== "approved" || (profiles[previewDoc.user_id]?.passport_status !== "approved"))
              && showPassportInfo
            }
          />
        )}
      <main className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "calc(61px + 2rem)" }}>
        <div className="max-w-[780px] mx-auto px-4 pt-8 pb-16">

          {/* Header — refined typography */}
          <div className="mb-6">
            <h1 className="text-[22px] font-semibold tracking-[-0.015em]" style={{ color: "var(--w)" }}>{t.aTitle}</h1>
            <p className="text-[13.5px] mt-1.5" style={{ color: "var(--w3)" }}>
              {totalPending > 0
                ? t.aSubPending
                    .replace("{n}", String(totalPending))
                    .replace("{s}", totalPending !== 1 ? "s" : "")
                : t.aSubAllDone}
            </p>
          </div>

          {/* Stats bar */}
          {Object.keys(grouped).length > 0 && (() => {
            const totalCandidates = Object.keys(grouped).length;
            const fullyApproved   = archivedUserIds.filter(uid =>
              grouped[uid].every(d => d.status === "approved")
            ).length;
            return (
              <div className="grid grid-cols-3 gap-3 mb-8">
                {[
                  { label: "Candidates",    value: totalCandidates, color: "var(--gold)" },
                  { label: "Pending docs",  value: totalPending,    color: "#ff9500" },
                  { label: "Fully approved", value: fullyApproved,  color: "#34c759" },
                ].map(s => (
                  <div key={s.label} className="px-5 py-5 text-center transition-all hover:-translate-y-0.5"
                    style={{
                      background: "var(--card)",
                      borderRadius: "20px",
                      border: "none",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    }}>
                    <p className="text-[28px] font-semibold tracking-[-0.02em] tabular-nums leading-none" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[10.5px] mt-2.5 font-medium uppercase tracking-[0.14em]" style={{ color: "var(--w3)" }}>{s.label}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Search + filter row — works on the full candidate list (pending + archived combined) */}
          {(pendingUserIds.length + archivedUserIds.length) > 0 && (() => {
            const all = [...pendingUserIds, ...archivedUserIds];
            const HOUR = 60 * 60 * 1000;
            const stuckCount = all.filter(uid => {
              const recent = Math.max(...grouped[uid].map(d => new Date(d.uploaded_at).getTime()));
              return grouped[uid].some(d => d.status === "pending") && (Date.now() - recent) / HOUR >= 7 * 24;
            }).length;
            const clearCount = archivedUserIds.length;
            const pendingCount = pendingUserIds.length;
            return (
              <div className="mb-4 space-y-3">
                {/* Search — CV-builder field styling */}
                <div className="relative">
                  <Search size={14} strokeWidth={1.8}
                    className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: "var(--w3)" }} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search candidates by name or email…"
                    className="w-full pl-10 pr-10 py-3 text-[13px] outline-none transition-colors focus:border-[var(--gold)]"
                    style={{
                      background: "var(--card)",
                      border: "none",
                      color: "var(--w)",
                      borderRadius: "14px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    }} />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} aria-label="Clear search"
                      className="bv-icon-btn absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full"
                      style={{ color: "var(--w3)" }}>
                      <XIcon size={13} strokeWidth={1.8} />
                    </button>
                  )}
                </div>
                {/* Filter chips */}
                <div className="flex items-center gap-2 flex-wrap">
                  {([
                    { key: "all"     as const, label: "All",            count: all.length },
                    { key: "pending" as const, label: "Pending review", count: pendingCount },
                    { key: "stuck"   as const, label: "Stuck > 7d",     count: stuckCount },
                    { key: "clear"   as const, label: "All clear",      count: clearCount },
                  ]).map(chip => {
                    const active = filterMode === chip.key;
                    return (
                      <button key={chip.key}
                        onClick={() => setFilterMode(chip.key)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium tracking-tight transition-colors"
                        style={{
                          background: active ? "var(--gdim)" : "var(--bg2)",
                          color: active ? "var(--gold)" : "var(--w2)",
                          border: `1px solid ${active ? "var(--border-gold)" : "var(--border)"}`,
                          borderRadius: "999px",
                        }}>
                        {chip.label}
                        <span className="text-[10.5px] tabular-nums opacity-70">{chip.count}</span>
                      </button>
                    );
                  })}
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
                return <EmptyState Icon={Search} title="No candidates found" sub={`No matches for "${searchQuery}".`} />;
              }
              if (filterMode === "stuck") {
                return <EmptyState Icon={CheckCircle2} tone="success" title="Nothing stuck" sub="No candidates have been waiting more than 7 days." />;
              }
              return <EmptyState Icon={CheckCircle2} tone="success" title={t.aNothingTitle} sub={t.aNothing} />;
            }

            return (
            <div className="bv-enter-stagger" style={{ borderTop: "1px solid var(--border)" }}>
              {visibleIds.map(uid => {
                const allDocs    = grouped[uid];
                const pendingDocs = allDocs.filter(d => d.status === "pending");
                const pendingCnt = pendingDocs.length;
                const isClear    = pendingCnt === 0;
                const user       = users[uid] ?? { name: uid, email: uid };
                const mostRecent = pendingDocs
                  .reduce((latest, d) => new Date(d.uploaded_at) > new Date(latest) ? d.uploaded_at : latest,
                    allDocs[0].uploaded_at);
                const ta = timeAgo(mostRecent);
                const isExpanded = expandedRow === uid;
                const openPanel = () => { setSelectedUser(uid); setActivePhase(0); setPassportDataFeedback(profiles[uid]?.passport_feedback ?? ""); };

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
                        <p className="text-[13.5px] font-semibold truncate inline-flex items-center gap-0.5" style={{ color: "var(--w)" }}>
                          {user.name}
                          <VerifiedBadge verified={!!profiles[uid]?.manually_verified} size="xs" />
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

                      {/* Time-since label — quiet text only, no chip */}
                      <span className="text-[10.5px] flex-shrink-0 hidden sm:inline" style={{ color: "var(--w3)" }}>
                        {ta.label}
                      </span>

                      {/* Status — colored text only, no chip */}
                      {isClear ? (
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold flex-shrink-0"
                          style={{ color: "#34c759" }}>
                          <CheckCircle2 size={12} strokeWidth={2.2} /> All clear
                        </span>
                      ) : (
                        <span className="text-[11.5px] font-semibold flex-shrink-0"
                          style={{ color: "#c9a240" }}>
                          {pendingCnt} {t.aPending}
                        </span>
                      )}

                      {/* Inline expand chevron — borderless, color-only */}
                      {!isClear && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : uid); }}
                        aria-label={isExpanded ? "Collapse" : "Peek pending docs"}
                        aria-expanded={isExpanded}
                        className="w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0"
                        style={{
                          color: isExpanded ? "var(--gold)" : "var(--w3)",
                          background: "transparent",
                          border: "none",
                          transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                          transition: "color 0.2s, transform 0.2s",
                        }}>
                        <ChevronDown size={14} strokeWidth={1.8} />
                      </button>
                      )}
                    </div>

                    {/* Inline pending-docs peek */}
                    {isExpanded && (
                      <div className="px-5 pb-4 pt-1 bv-enter"
                        style={{ borderTop: "1px solid var(--border)" }}>
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-2.5 mt-2.5" style={{ color: "var(--w3)" }}>
                          Pending review ({pendingCnt})
                        </p>
                        <div className="space-y-1">
                          {pendingDocs.slice(0, 8).map(d => {
                            const dta = timeAgo(d.uploaded_at);
                            return (
                              <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                                style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--gold)" }} />
                                <span className="text-[12.5px] font-medium truncate flex-1" style={{ color: "var(--w2)" }}>{d.file_type}</span>
                                <span className="text-[10.5px] flex-shrink-0" style={{ color: "var(--w3)" }}>{dta.label}</span>
                              </div>
                            );
                          })}
                          {pendingDocs.length > 8 && (
                            <p className="text-[11px] mt-2 text-center" style={{ color: "var(--w3)" }}>
                              + {pendingDocs.length - 8} more — open full panel to review
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            );
          })()}

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
                    const allDocs    = grouped[uid];
                    const approvedCnt = allDocs.filter(d => d.status === "approved").length;
                    const rejectedCnt = allDocs.filter(d => d.status === "rejected").length;
                    const user       = users[uid] ?? { name: uid, email: uid };
                    return (
                      <button key={uid}
                        onClick={() => { setSelectedUser(uid); setActivePhase(0); setPassportDataFeedback(profiles[uid]?.passport_feedback ?? ""); }}
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
                          <p className="text-[12.5px] font-medium truncate tracking-tight inline-flex items-center gap-0.5" style={{ color: "var(--w)" }}>
                            {user.name}
                            <VerifiedBadge verified={!!profiles[uid]?.manually_verified} size="xs" />
                          </p>
                          <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--w3)" }}>{user.email}</p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          {approvedCnt > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold"
                              style={{ color: "#34c759" }}>
                              <CheckCircle2 size={11} strokeWidth={2} /> {approvedCnt}
                            </span>
                          )}
                          {rejectedCnt > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold"
                              style={{ color: "#e05252" }}>
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

      {/* Standalone reject popup — same component used everywhere */}
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
