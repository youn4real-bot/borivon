"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { LABEL_TO_FILE_KEY, FILE_KEY_ALL_LABELS } from "@/lib/fileKeys";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { DOC_EXAMPLES } from "@/lib/docExamples";
import { MAPS_URL, DEMANDE_EXAMPLE_URL } from "@/lib/workLicenseGuide";
import { COUNTRY_MAP, natToLang as natToLangShared } from "@/lib/countries";
import {
  PhaseIcon, type PhaseKind,
  Lock, Mail, Calendar, ExternalLink, AlertTriangle, PartyPopper,
  IdCard, User, Home, Eye, FilePen, Sparkles, Paperclip, CheckCircle2, XCircle,
  Stethoscope, Languages, FileText,
} from "@/components/PortalIcons";
import { X as XIcon, Download, Upload, RefreshCw, Info, ChevronDown, MoreHorizontal } from "lucide-react";
import { PdfViewer } from "@/components/PdfViewer";
import { DocxViewer } from "@/components/DocxViewer";
import { ZoomPanRotateViewer } from "@/components/ZoomPanRotateViewer";
import { Spinner, PageLoader, AutosaveIndicator } from "@/components/ui/states";
import { JourneyView } from "@/components/JourneyView";
import { OrgCodeModal } from "@/components/OrgCodeModal";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { buildProfileSlug } from "@/lib/profile-slug";
import { VerifiedCelebration } from "@/components/VerifiedCelebration";
import { MatchedCelebration } from "@/components/MatchedCelebration";
import { PaymentCelebration } from "@/components/PaymentCelebration";
import { PortalTopNav } from "@/components/PortalTopNav";
import { PendingSignatures } from "@/components/PendingSignatures";

// Onboarding tour is shown at most once per user (gated by a localStorage
// flag). Lazy-load so returning users don't pay for it.
const OnboardingTour = dynamic(
  () => import("@/components/OnboardingTour").then(m => ({ default: m.OnboardingTour })),
  { ssr: false, loading: () => null },
);

// FILE_KEY_ALL_LABELS imported from @/lib/fileKeys — shared with admin page.

// Map fileKey → phase index (0-3) for notification deep-linking.
// cv_de (Lebenslauf) lives in Phase 0 (ID & CV) — it's the candidate's main
// CV, not a translation of another doc.
const FILE_KEY_PHASE: Record<string, number> = {
  id: 0, cv: 0, cv_de: 0, letter: 0,
  diploma: 1, studyprog: 1, transcript: 1, abitur: 1,
  abitur_transcript: 1, praktikum: 1, workcert: 1, work_experience: 1,
  diploma_de: 2, studyprog_de: 2, transcript_de: 2,
  abitur_de: 2, abitur_transcript_de: 2, praktikum_de: 2,
  workcert_de: 2, work_experience_de: 2,
  langcert: 3, other: 3,
};

type ViewMode = "docs" | "interview" | "recognition" | "visum" | "reise" | "integration" | "start";

type Pipeline = {
  interview_link: string | null;
  interview_date: string | null;
  interview_status: string; // "pending" | "passed" | "failed"
  recognition_unlocked: boolean;
  embassy_unlocked: boolean;
  visa_granted: boolean;
  visa_date: string | null;
  flight_date: string | null;
  flight_info: string | null;
  docs_approved: boolean;
  integration_unlocked?: boolean | null;
  start_unlocked?: boolean | null;
};

const JOURNEY_STAGES = [
  { key: "interview"   as const, kind: "interview"   as PhaseKind },
  { key: "recognition" as const, kind: "recognition" as PhaseKind },
  { key: "visum"       as const, kind: "embassy"      as PhaseKind },
  { key: "reise"       as const, kind: "flight"      as PhaseKind },
  { key: "integration" as const, kind: "integration" as PhaseKind },
  { key: "start"       as const, kind: "start"       as PhaseKind },
];

function isJourneyUnlocked(stage: Exclude<ViewMode,"docs">, p: Pipeline | null): boolean {
  if (!p) return false;
  switch (stage) {
    case "interview":   return !!(p.interview_link) || p.interview_status !== "pending";
    case "recognition": return p.recognition_unlocked;
    case "visum":       return p.embassy_unlocked;
    case "reise":       return !!(p.flight_date);
    case "integration": return !!(p.integration_unlocked);
    case "start":       return !!(p.start_unlocked);
  }
}

/** Whether admin has explicitly unlocked this stage for the candidate.
 *  True → candidate bypasses Premium gate for this stage only.
 *  Never changes payment_tier — purely a temporary access grant. */
function isAdminUnlocked(stage: string, p: Pipeline | null): boolean {
  if (!p) return false;
  switch (stage) {
    case "interview":   return !!p.docs_approved;
    case "recognition": return !!p.recognition_unlocked;
    case "visum":       return !!p.embassy_unlocked;
    case "reise":       return !!p.flight_date;
    case "integration": return !!p.integration_unlocked;
    case "start":       return !!p.start_unlocked;
    default:            return false;
  }
}

type Doc = {
  id: string;
  file_name: string;
  file_type: string;
  uploaded_at: string;
  status: string;
  feedback: string | null;
  drive_file_id: string | null;
};

const ALLOWED_PDF_ONLY = ["application/pdf"];
const ALLOWED_ALL = [
  "application/pdf", "image/jpeg", "image/png", "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const OTHER_KEYS = ["other"];
const ID_KEYS = ["id"]; // passport — PDF or image both accepted; OCR runs on images only
const MAX_MB = 10;

// Renders **bold** markers in translation strings
function B({ text }: { text: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return <>{parts.map((p, i) => i % 2 === 1 ? <strong key={i}>{p}</strong> : p)}</>;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}


export default function DashboardPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dynamic phase slots — loaded from API (replaces static bea_*/vis_* placeholders)
  type PhaseSlot = { id: string; phase: string; type: "simple" | "dual"; label: string; label_trans: string | null; position: number };
  const [dynamicSlots, setDynamicSlots] = useState<{ bea: PhaseSlot[]; vis: PhaseSlot[] }>({ bea: [], vis: [] });
  const [dynamicSlotsLoaded, setDynamicSlotsLoaded] = useState(false);

  type PhItem = { key: string; label: string; hint: string; optional?: boolean; transKey?: string; transHint?: string; };
  const PHASES: { title: string; shortTitle: string; desc: string; kind: PhaseKind; isTranslations: boolean; items: PhItem[] }[] = [
    {
      title: t.pWizardPhase1,  shortTitle: t.pSideID,
      desc: t.pWizardPhase1Desc,
      kind: "id" as PhaseKind,
      isTranslations: false,
      items: [
        { key: "id",     label: t.pTypeID,     hint: t.pHintID },
        // The Lebenslauf is the candidate's main CV — generated by the CV
        // builder and uploaded as fileKey "cv_de". Belongs in ID & CV, not
        // in the Translations phase.
        { key: "cv_de",  label: t.pTypeCVde,   hint: t.pHintCV },
        { key: "letter", label: t.pTypeLetter, hint: t.pHintLetter },
        // Language certificate + free-form Other moved here from the
        // (deleted) "Others" phase so they stay accessible.
        { key: "langcert", label: t.pTypeLangCert, hint: t.pHintLangCert },
        { key: "other",    label: t.pTypeOther,    hint: "" },
      ],
    },
    {
      title: t.pWizardPhase2,  shortTitle: t.pSideNursing,
      desc: t.pWizardPhase2Desc,
      kind: "nursing" as PhaseKind,
      isTranslations: false,
      items: [
        { key: "diploma",           transKey: "diploma_de",           label: t.pTypeDiploma,          hint: t.pHintDiploma,          transHint: t.pHintDiplomaDE },
        { key: "studyprog",         transKey: "studyprog_de",         label: t.pTypeStudyProg,        hint: t.pHintStudyProg,        transHint: t.pHintStudyProgDE },
        { key: "transcript",        transKey: "transcript_de",        label: t.pTypeTranscript,       hint: t.pHintTranscript,       transHint: t.pHintTranscriptDE },
        { key: "abitur",            transKey: "abitur_de",            label: t.pTypeAbitur,           hint: t.pHintAbitur,           transHint: t.pHintAbiturDE },
        { key: "abitur_transcript", transKey: "abitur_transcript_de", label: t.pTypeAbiturTranscript, hint: t.pHintAbiturTranscript, transHint: t.pHintAbiturTranscriptDE },
        { key: "praktikum",         transKey: "praktikum_de",         label: t.pTypePraktikum,        hint: t.pHintPraktikum,        transHint: t.pHintPraktikumDE },
        { key: "workcert",          transKey: "workcert_de",          label: t.pTypeWorkCert,         hint: t.pHintWorkCert,         transHint: t.pHintWorkcertDE },
        { key: "work_experience",   transKey: "work_experience_de",   label: t.pTypeWorkExp,          hint: t.pHintWorkExp,          transHint: t.pHintWorkExpDE, optional: true as const },
      ],
    },
    {
      title: t.pJourneyRecognition, shortTitle: "Bea.",
      desc: "",
      kind: "recognition" as PhaseKind,
      isTranslations: false,
      items: dynamicSlots.bea.map(s => ({
        key: s.id, label: s.label, hint: "",
        ...(s.type === "dual" ? { transKey: s.id + "_de", transHint: "" } : {}),
      })),
    },
    {
      title: t.pJourneyVisum, shortTitle: "Visum",
      desc: "",
      kind: "embassy" as PhaseKind,
      isTranslations: false,
      items: dynamicSlots.vis.map(s => ({
        key: s.id, label: s.label, hint: "",
        ...(s.type === "dual" ? { transKey: s.id + "_de", transHint: "" } : {}),
      })),
    },
  ];
  // Only the first two phases (Essentielles + Qualifikation) show in the top sidebar rail.
  // Bearbeitung and Visum are reached via the journey stage sidebar icons below.
  const DOC_SIDEBAR_PHASES = PHASES.slice(0, 2);

  // ALL_ITEMS must include both original and translated keys so the upload
  // handler, progress counter and slot-message renderer can find any key.
  const TRANS_ITEMS_EXTRA = [
    { key: "diploma_de",           label: t.pTypeDiplomaDE,          hint: t.pHintDiplomaDE },
    { key: "studyprog_de",         label: t.pTypeStudyProgDE,        hint: t.pHintStudyProgDE },
    { key: "transcript_de",        label: t.pTypeTranscriptDE,       hint: t.pHintTranscriptDE },
    { key: "abitur_de",            label: t.pTypeAbiturDE,           hint: t.pHintAbiturDE },
    { key: "abitur_transcript_de", label: t.pTypeAbiturTranscriptDE, hint: t.pHintAbiturTranscriptDE },
    { key: "praktikum_de",         label: t.pTypePraktikumDE,        hint: t.pHintPraktikumDE },
    { key: "workcert_de",          label: t.pTypeWorkcertDE,         hint: t.pHintWorkcertDE },
    { key: "work_experience_de",   label: t.pTypeWorkExpDE,          hint: t.pHintWorkExpDE, optional: true as const },
  ];
  const ALL_ITEMS = [...PHASES.flatMap(p => p.items), ...TRANS_ITEMS_EXTRA];

  const [userId, setUserId]         = useState("");
  const [authToken, setAuthToken]   = useState("");
  const [firstName, setFirstName]   = useState("");
  const [lastName, setLastName]     = useState("");
  // Track which decided-doc IDs the candidate has already opened (seen).
  // Badge disappears once they click the document row.
  const [seenDocIds, setSeenDocIds] = useState<Set<string>>(new Set());
  const [userName, setUserName]     = useState("");
  const [docs, setDocs]           = useState<Doc[]>([]);
  const [loading, setLoading]     = useState(true);
  const [mode, setMode]           = useState<"wizard">("wizard");
  const [phase, setPhase]         = useState(0);
  const [isReturn, setIsReturn]   = useState(false);

  type MsgType = "success" | "errPdfOnly" | "errAllTypes" | "errSize" | "errUpload" | "errNetwork" | "errDownload";
  type SlotMsg = { key: string; ok: boolean; type: MsgType; label?: string };

  // Paired master-box expand state (nursing phase: which doc pairs are open)
  const [expandedPairs, setExpandedPairs] = useState<Set<string>>(new Set());
  const [mergingPair, setMergingPair]     = useState<string | null>(null);

  // Upload state
  const [activeKey, setActiveKey]       = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [slotProgress, setSlotProgress] = useState(0);
  const [slotMsg, setSlotMsg]           = useState<SlotMsg | null>(null);
  const [dragOverKey, setDragOverKey]   = useState<string | null>(null);
  const [skipMsg, setSkipMsg]           = useState(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const skipTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slotMsgTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Issue 13.1: tracks which "other" doc to delete AFTER a successful replacement
  // upload. We also store the slot key so a stale ref can't accidentally delete
  // a doc when the user uploads to a *different* slot after cancelling a replace.
  const replaceDocIdRef  = useRef<string | null>(null);
  const replaceForKeyRef = useRef<string | null>(null);

  // Organization invite-code modal — shown until candidate joins an org or
  // explicitly dismisses ("Later"). Dismissal is session-only; resets on next login.
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgChecked, setOrgChecked]     = useState(false);
  // Orgs this candidate is approved-linked to — shown as partner cards on
  // the dashboard. Rejected entries are filtered out. Polled every 30 s so
  // admin-initiated placements appear without a page reload.
  const [linkedOrgs, setLinkedOrgs] = useState<{ id: string; name: string; status: string }[]>([]);
  // Celebration modal — shown once per (user, orgId) on first detection of an approved match
  const [celebrateOrg, setCelebrateOrg] = useState<{ id: string; name: string } | null>(null);

  // Payment tier — gates journey/pipeline access
  const [paymentTier, setPaymentTier] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  // Verification flag — backend (admin/route.ts maybeGrantVerified or
  // /verify-user) flips this to true when the candidate is fully approved.
  // Source of truth for the gold tick + public profile slug everywhere.
  const [manuallyVerified, setManuallyVerified] = useState(false);
  // Upgrade modal — shown when candidate tries a Premium-tier feature
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  // Which journey stage triggered the upgrade modal (so auto-close only fires for that stage)
  const [upgradeTargetStage, setUpgradeTargetStage] = useState<string | null>(null);
  // Payment success toast — shown when user returns from Stripe checkout
  const [paymentCelebration, setPaymentCelebration] = useState<{ plan: string } | null>(null);
  // Helper: does the user have the Premium plan?
  const hasPremium = paymentTier === "premium";

  // Sign requests — documents sent for digital signature
  type SignReq = { id: string; document_name: string; note: string | null; status: "pending" | "signed" | "declined"; signed_at: string | null; created_at: string; signature_zone: { page: number; x: number; y: number; w: number; h: number } | null; pdf_preview_url: string | null; };
  const [signRequests, setSignRequests] = useState<SignReq[]>([]);

  // (Mobile drawer + bottom-bar hamburger removed — sidebar is now always
  // visible on every breakpoint, matching the admin dashboard layout.)

  // Helper: set slotMsg and auto-clear it after 5 s
  const setSlotMsgTimed = (msg: SlotMsg | null) => {
    if (slotMsgTimer.current) clearTimeout(slotMsgTimer.current);
    setSlotMsg(msg);
    if (msg) slotMsgTimer.current = setTimeout(() => setSlotMsg(null), 5000);
  };

  // Cleanup XHR and timers on unmount
  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
      if (slotMsgTimer.current) clearTimeout(slotMsgTimer.current);
    };
  }, []);
  const [exampleUrl, setExampleUrl]     = useState<string | null>(null);
  const [showWorkGuide, setShowWorkGuide] = useState(false);
  const [tipPopup, setTipPopup]         = useState<{ itemKey: string; isWorkCert: boolean } | null>(null);

  // ── Nationality / country i18n helpers (uses shared @/lib/countries) ─────────
  const NAT_MAP = COUNTRY_MAP;

  function natToLang(value: string, target: "fr"|"en"|"de"): string {
    return natToLangShared(value, target) || value;
  }

  function normalizeSex(s: string, toLang: "fr"|"en"|"de"): string {
    const canon = s === "W" ? "F" : s; // W → F canonical
    return toLang === "de" && canon === "F" ? "W" : canon;
  }

  // Re-translate sex display when language switches (nationality uses ISO so no translation needed)
  useEffect(() => {
    setPassportModal(p => p ? { ...p, sex: normalizeSex(p.sex, lang) } : p);
  }, [lang]);

  // Passport confirmation modal
  type PassportData = {
    first_name: string; last_name: string;
    dob: string; sex: string; nationality: string;
    city_of_birth: string; country_of_birth: string;
    passport_no: string; passport_expiry: string;
    issuing_authority: string; issue_date: string;
    address_street: string; address_number: string; address_postal: string;
    city_of_residence: string; country_of_residence: string;
    marital_status: string; children_ages: string; // children_ages = JSON array e.g. "[14,8]"
  };
  const [passportModal, setPassportModal] = useState<PassportData | null>(null);
  const [passportSaving, setPassportSaving] = useState(false);
  const [confirmedFields, setConfirmedFields] = useState<Set<keyof PassportData>>(new Set());

  /**
   * Re-open the passport-data modal AFTER first confirmation, populated from
   * whatever the candidate already saved in candidate_profiles. Used by the
   * "Passport data" button in the doc preview popup AND by the auto-open
   * effect that fires while the passport is still in the verification phase.
   */
  const reopenPassportData = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("candidate_profiles")
      .select("first_name, last_name, dob, sex, nationality, city_of_birth, country_of_birth, passport_no, passport_expiry, issuing_authority, issue_date, address_street, address_number, address_postal, city_of_residence, country_of_residence, marital_status, children_ages")
      .eq("user_id", userId)
      .maybeSingle();
    type ProfileRow = Partial<PassportData>;
    const p = (data ?? {}) as ProfileRow;
    const blank: PassportData = { first_name: "", last_name: "", dob: "", sex: "", nationality: "", city_of_birth: "", country_of_birth: "", passport_no: "", passport_expiry: "", issuing_authority: "", issue_date: "", address_street: "", address_number: "", address_postal: "", city_of_residence: "", country_of_residence: "", marital_status: "", children_ages: "" };
    const filled: PassportData = { ...blank };
    (Object.keys(blank) as (keyof PassportData)[]).forEach(k => {
      const v = p[k];
      if (typeof v === "string") filled[k] = v;
    });
    setPassportModal({ ...filled, sex: normalizeSex(filled.sex, lang) });
    // Issue 6.2: auto-confirm fields that already have saved values so the
    // candidate doesn't have to re-tick every checkbox just to review their
    // data. Editing any field un-ticks it (handled in the onChange handler).
    const preConfirmed = new Set(
      (Object.keys(filled) as (keyof PassportData)[]).filter(k => filled[k]?.trim())
    );
    setConfirmedFields(preConfirmed);
  }, [userId, lang]);
  const [passportHint, setPassportHint] = useState<keyof PassportData | null>(null);
  const addressHintShown = useRef(false);
  const postalHintShown = useRef(false);
  const authorityHintShown = useRef(false);

  // Autosave indicator for passport modal
  const [passportSavedAt, setPassportSavedAt]   = useState<Date | null>(null);
  const [passportSaveError, setPassportSaveError] = useState(false);

  // Persist passport modal to localStorage so a page refresh doesn't lose unconfirmed data
  useEffect(() => {
    if (!userId) return;
    const key = `bv-passport-pending-${userId}`;
    if (passportModal) {
      try {
        localStorage.setItem(key, JSON.stringify(passportModal));
        setPassportSavedAt(new Date());
        setPassportSaveError(false);
      } catch { setPassportSaveError(true); }
    } else {
      localStorage.removeItem(key);
      setPassportSavedAt(null); // closing the modal clears the indicator
      setPassportSaveError(false);
    }
  }, [passportModal, userId]);
  const [viewMode, setViewMode]         = useState<ViewMode>("docs");
  const [pipeline, setPipeline]         = useState<Pipeline | null>(null);
  const [infoPassportData, setInfoPassportData] = useState<Record<string, string | null> | null>(null);
  // Document-hint popup state — when set, the row's "What is this?" info icon
  // was clicked. Holds both the title and hint text so the modal can render.
  const [docHintOpen, setDocHintOpen] = useState<{ title: string; hint: React.ReactNode } | null>(null);
  const [infoPassportLoading, setInfoPassportLoading] = useState(false);
  // passport_status from candidate_profiles — drives info button color independently of doc status
  const [passportStatus, setPassportStatus] = useState<string | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  // 3-dot menu state for sub-doc rows (mirrors admin's revokeMenu)
  const [candSubMenu, setCandSubMenu] = useState<string | null>(null);

  // Poll org placement every 30 s + on focus so admin-initiated placements
  // appear without a page reload. Uses authToken (available after login).
  useEffect(() => {
    if (!authToken) return;
    const refresh = () => {
      fetch("/api/portal/me/organizations", { headers: { Authorization: `Bearer ${authToken}` } })
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (!j?.orgs) return;
          const list = (j.orgs as { id: string; name: string; status: string }[])
            .filter(o => o.status !== "rejected");
          setLinkedOrgs(prev => {
            // Check if a NEW approved org appeared — show a subtle notification
            const prevIds = new Set(prev.filter(o => o.status === "approved").map(o => o.id));
            const newOrg = list.find(o => o.status === "approved" && !prevIds.has(o.id));
            if (newOrg) {
              // Dispatch event so any listeners (future notifications) can react
              window.dispatchEvent(new CustomEvent("bv-org-placed", { detail: { name: newOrg.name } }));
              // Show the celebration modal ONCE per (user, orgId).
              // Write to localStorage immediately (before the modal mounts) so
              // a quick refresh can't trigger the celebration a second time.
              if (userId) {
                try {
                  const key = `bv-celebrated-orgs-${userId}`;
                  const seen = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
                  if (!seen.includes(newOrg.id)) {
                    seen.push(newOrg.id);
                    localStorage.setItem(key, JSON.stringify(seen));
                    setCelebrateOrg({ id: newOrg.id, name: newOrg.name });
                  }
                } catch {
                  setCelebrateOrg({ id: newOrg.id, name: newOrg.name });
                }
              }
            }
            return list;
          });
        })
        .catch(() => {});
    };
    refresh(); // initial load — without this the first org list takes 30s
    const t = setInterval(refresh, 30_000);
    const onFocus = () => refresh();
    const onVis   = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [authToken, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plan-gate fallback: non-Premium users can't reach journey views unless the
  // admin has explicitly unlocked that specific stage — bounce back to docs if
  // neither condition is met. Race-safe; runs as an effect, not during render.
  useEffect(() => {
    if (viewMode !== "docs" && profileLoaded && !hasPremium) {
      if (!isAdminUnlocked(viewMode, pipeline)) setViewMode("docs");
    }
  }, [viewMode, profileLoaded, hasPremium, pipeline]);

  // Auto-dismiss upgrade modal the moment admin unlocks the specific stage
  // the candidate was trying to access. Using upgradeTargetStage (not viewMode)
  // prevents a false-close when the user is already inside an admin-unlocked
  // stage and clicks a *different* locked stage.
  useEffect(() => {
    if (upgradeOpen && upgradeTargetStage && isAdminUnlocked(upgradeTargetStage, pipeline)) {
      setUpgradeOpen(false);
      setUpgradeTargetStage(null);
    }
  }, [pipeline, upgradeOpen, upgradeTargetStage]);

  // Issue 4.3: live passport status — no page refresh needed when admin approves/rejects
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`profile-status-${userId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "candidate_profiles", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { passport_status?: string; manually_verified?: boolean; payment_tier?: string | null; profile_photo?: string | null };
          if (row.passport_status !== undefined) setPassportStatus(row.passport_status);
          // Pick up payment_tier changes pushed by the Stripe webhook (no page refresh needed).
          if (row.payment_tier !== undefined) {
            setPaymentTier(row.payment_tier ?? null);
            // Notify the navbar so the upgrade modal / Starter card hides
            // immediately without waiting for a page reload.
            window.dispatchEvent(new CustomEvent("bv-payment-tier-changed", { detail: { tier: row.payment_tier ?? null } }));
          }
          // Live profile photo updates — fired when the supreme admin (or
          // the user themselves elsewhere) swaps the photo. The navbar
          // ProfileIcon listens to this event and refreshes its avatar.
          if (row.profile_photo !== undefined) {
            window.dispatchEvent(new CustomEvent("bv-profile-photo-changed", { detail: { photo: row.profile_photo ?? null } }));
          }
          // Fire celebration the instant admin flips manually_verified to true.
          if (row.manually_verified !== undefined) {
            setManuallyVerified(!!row.manually_verified);
          }
          if (row.manually_verified === true) {
            // Notify the navbar ProfileIcon so the badge appears immediately.
            window.dispatchEvent(new CustomEvent("bv-verified-changed"));
            try {
              if (!localStorage.getItem(`bv-verified-celebrated-${userId}`)) {
                setShowCelebration(true);
              }
            } catch { /* private mode */ }
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // Realtime: keep pipeline unlock flags in sync when admin changes them
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`pipeline-unlock-${userId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "candidate_pipeline", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as Partial<Pipeline>;
          setPipeline(prev => prev ? { ...prev, ...row } : (row as Pipeline));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const [previewDoc, setPreviewDoc]         = useState<Doc | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Set when a notification click carries a doc_id — resolved to a preview
  // once docs have loaded (handles both same-page and fresh-navigation cases).
  const [pendingOpenDocId, setPendingOpenDocId] = useState<string | null>(null);

  // Auto-open passport-data modal only during the first-time submission flow
  // (passportStatus is null = never submitted). Once submitted (pending /
  // approved / rejected) the candidate can open it manually via the button.
  useEffect(() => {
    if (!previewDoc) return;
    if (!/pass/i.test(previewDoc.file_type)) return;
    if (passportStatus) return; // already submitted — don't auto-open
    if (passportModal) return; // already open
    reopenPassportData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDoc?.id, passportStatus]);

  // Deep-link from notification: listens for 'bv-nav-doc' custom events
  // dispatched by the CandidateBell. Works for both initial-load (URL param)
  // and same-page navigation (user already on dashboard).
  useEffect(() => {
    function applyNavDoc(detail: { docId: string | null }) {
      if (detail?.docId) setPendingOpenDocId(detail.docId);
      window.history.replaceState({}, "", window.location.pathname);
    }

    function onNavDocEvent(e: Event) {
      applyNavDoc((e as CustomEvent<{ docId: string | null }>).detail);
    }
    window.addEventListener("bv-nav-doc", onNavDocEvent);
    return () => window.removeEventListener("bv-nav-doc", onNavDocEvent);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!previewDoc?.drive_file_id) { setPreviewBlobUrl(null); return; }
    let mounted = true;
    let objectUrl = "";
    const controller = new AbortController();
    setPreviewLoading(true);
    fetch(`/api/portal/file?id=${previewDoc.drive_file_id}`, {
        signal: controller.signal,
        cache: "no-store",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      })
      .then(r => r.blob())
      .then(blob => {
        if (!mounted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewBlobUrl(objectUrl);
      })
      .catch(err => { if (err.name !== "AbortError") console.error("Preview fetch error:", err); })
      .finally(() => { if (mounted) setPreviewLoading(false); });
    return () => {
      mounted = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewDoc?.drive_file_id]);

  // Load seen-doc IDs from localStorage whenever userId becomes available.
  useEffect(() => {
    if (!userId) return;
    try {
      const raw = localStorage.getItem(`bv-seen-docs-${userId}`);
      if (raw) setSeenDocIds(new Set(JSON.parse(raw) as string[]));
    } catch { /* private mode / corrupt JSON */ }
  }, [userId]);

  function handlePreview(doc: Doc) {
    // Mark this doc as seen so its badge clears immediately.
    if (userId && (doc.status === "approved" || doc.status === "rejected")) {
      setSeenDocIds(prev => {
        const next = new Set(prev);
        next.add(doc.id);
        try { localStorage.setItem(`bv-seen-docs-${userId}`, JSON.stringify([...next])); } catch { /* private mode */ }
        return next;
      });
    }
    setPreviewDoc(doc);
  }

  // When a notification carried a doc_id, open its preview as soon as docs are loaded.
  useEffect(() => {
    if (!pendingOpenDocId || docs.length === 0) return;
    const doc = docs.find(d => d.id === pendingOpenDocId);
    if (doc) {
      setPendingOpenDocId(null);
      setPreviewDoc(doc);
    }
  }, [pendingOpenDocId, docs]);

  useEffect(() => {
    // Issue 4.1: wrap getSession in a 12-second timeout so slow mobile
    // connections don't leave the candidate on the loading screen forever.
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 12_000));
    Promise.race([supabase.auth.getSession(), timeout]).then(async (result) => {
      if (!result) { setLoading(false); router.replace("/portal"); return; }
      const { data: { session } } = result as Awaited<ReturnType<typeof supabase.auth.getSession>>;
      const user = session?.user;
      if (!user) { setLoading(false); router.replace("/portal"); return; }
      // Server-side role lookup — avoid exposing the admin email in the bundle.
      try {
        const res = await fetch("/api/portal/me/role", {
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        });
        const { role } = await res.json().catch(() => ({ role: null }));
        if (role === "admin" || role === "sub_admin") { router.replace("/portal/admin"); return; }
        if (role === "org_member") { router.replace("/portal/org/dashboard"); return; }
      } catch { /* offline — continue as candidate */ }
      setUserId(user.id);
      setAuthToken(session?.access_token ?? "");
      setFirstName(user.user_metadata?.first_name ?? "");
      setLastName(user.user_metadata?.last_name ?? "");
      setUserName(user.user_metadata?.full_name ?? user.email ?? "");

      // Load sign requests in background
      fetch("/api/portal/me/sign-requests", {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      }).then(r => r.ok ? r.json() : { requests: [] })
        .then(j => setSignRequests((j as { requests: SignReq[] }).requests ?? []))
        .catch(() => {});

      // Auto-redeem invite code stored in user metadata at registration time.
      // Fires once per session; safe to re-run (server ignores already-used codes).
      const storedCode = user.user_metadata?.invite_code as string | undefined;
      if (storedCode && session?.access_token) {
        const redeemKey = `bv-invite-redeemed-${user.id}`;
        if (!localStorage.getItem(redeemKey)) {
          fetch(`/api/portal/invite/${encodeURIComponent(storedCode)}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
            .then(r => r.json())
            .then(() => {
              try { localStorage.setItem(redeemKey, "1"); } catch { /* private mode */ }
            })
            .catch(() => {/* ignore errors — will retry on next login */});
        }
      }
      // Restore unconfirmed passport modal if user refreshed before submitting
      const pendingRaw = localStorage.getItem(`bv-passport-pending-${user.id}`);
      if (pendingRaw) {
        try {
          const parsed = JSON.parse(pendingRaw) as PassportData;
          setPassportModal({ ...parsed, sex: normalizeSex(parsed.sex ?? "", lang) });
          setConfirmedFields(new Set()); // user must re-review after refresh
        } catch { /* ignore corrupt data */ }
      }
      loadDocs(user.id);
      loadDynamicSlots(session?.access_token ?? "");
      // Load passport_status for info-button color
      // Load profile — passport status + payment tier + verified flag
      (async () => {
        try {
          const { data } = await supabase
            .from("candidate_profiles")
            .select("passport_status, manually_verified, payment_tier")
            .eq("user_id", user.id)
            .maybeSingle();
          setPassportStatus(data?.passport_status ?? null);
          setPaymentTier((data as { payment_tier?: string | null } | null)?.payment_tier ?? null);
          setManuallyVerified(!!data?.manually_verified);
          // Show celebration if verified and not yet celebrated this session.
          if (data?.manually_verified) {
            const uid = user.id;
            // Notify the navbar ProfileIcon to show the badge.
            window.dispatchEvent(new CustomEvent("bv-verified-changed"));
            try {
              if (!localStorage.getItem(`bv-verified-celebrated-${uid}`)) {
                setShowCelebration(true);
              }
            } catch { /* private mode */ }
          }
        } catch { /* ignore */ } finally {
          setProfileLoaded(true); // guard: ensure plan gate renders after profile load
        }
      })();
      // Load pipeline — JWT-authenticated
      const token = session?.access_token ?? "";
      fetch(`/api/portal/pipeline/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then(r => r.json())
        .then(({ pipeline: p }) => setPipeline(p ?? null))
        .catch(err => console.error("Pipeline fetch error:", err));

      // Org check — show invite-code modal if candidate has no approved org yet
      fetch(`/api/portal/me/organizations`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then(r => r.json())
        .then(({ orgs }) => {
          // Filter out rejected rows — candidates should never see those.
          const list = ((orgs ?? []) as { id: string; name: string; status: string }[])
            .filter(o => o.status !== "rejected");
          setLinkedOrgs(list);
          setOrgChecked(true);
          // Show MatchedCelebration for any approved org not yet celebrated.
          // This handles the "placed" notification → navigate to dashboard flow.
          const approvedOrgs = list.filter(o => o.status === "approved");
          if (approvedOrgs.length > 0) {
            try {
              const key = `bv-celebrated-orgs-${user.id}`;
              const seen = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
              const uncelebrated = approvedOrgs.find(o => !seen.includes(o.id));
              if (uncelebrated) {
                seen.push(uncelebrated.id);
                localStorage.setItem(key, JSON.stringify(seen));
                setCelebrateOrg({ id: uncelebrated.id, name: uncelebrated.name });
              }
            } catch { /* private mode */ }
          }
        })
        .catch(() => setOrgChecked(true));
    });

    // Issue 16.1: keep authToken fresh across token rotations
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) setAuthToken(session.access_token);
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDynamicSlots(token: string) {
    if (dynamicSlotsLoaded) return;
    setDynamicSlotsLoaded(true);
    try {
      const [beaRes, visRes] = await Promise.all([
        fetch("/api/portal/phase-slots?phase=bearbeitung", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/portal/phase-slots?phase=visum",        { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const beaJ = beaRes.ok ? await beaRes.json() : { slots: [] };
      const visJ = visRes.ok ? await visRes.json() : { slots: [] };
      setDynamicSlots({ bea: beaJ.slots ?? [], vis: visJ.slots ?? [] });
    } catch { /* ignore — slots stay empty */ }
  }

  async function loadDocs(uid: string, keepPhase = false) {
    let fetched: Doc[] = [];
    try {
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
        .eq("user_id", uid)
        .order("uploaded_at", { ascending: false });
      if (error) console.error("loadDocs error:", error.message);
      // Deduplicate: only keep the latest doc per file slot (fileKey).
      // Docs are sorted DESC so first occurrence per fileKey = latest version.
      // EXCEPTION: "other" (Sonstiges) is a multi-doc slot — every uploaded
      // file is a peer, so we keep them all.
      const seenKeys = new Set<string>();
      fetched = (data ?? []).filter(d => {
        const fk = LABEL_TO_FILE_KEY[d.file_type] ?? d.file_type;
        if (fk === "other") return true; // multi-doc slot — never dedupe
        if (seenKeys.has(fk)) return false;
        seenKeys.add(fk);
        return true;
      });
      setDocs(fetched);
    } catch (err) {
      console.error("loadDocs exception:", err);
    } finally {
      setLoading(false);
    }

    // Post-upload refresh: only update docs, never touch mode/phase
    if (keepPhase) return;

    // Stripe return — handle regardless of whether the user has docs yet
    const searchParams = new URLSearchParams(window.location.search);
    const paymentParam = searchParams.get("payment");
    const planParam    = searchParams.get("plan");
    const upsellParam  = searchParams.get("upsell");
    if (paymentParam === "success" && planParam) {
      setPaymentTier(planParam);
      setPaymentCelebration({ plan: planParam });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (paymentParam === "cancelled") {
      window.history.replaceState({}, "", window.location.pathname);
    } else if (upsellParam === "premium") {
      // Coming back from the CV builder gate (or any other Premium-locked
      // feature). Auto-open the upgrade modal so the candidate sees why
      // they were redirected — unless admin has already unlocked this stage.
      // (Pipeline may still be loading; auto-close effect handles that race.)
      if (!isAdminUnlocked(viewMode, pipeline)) { setUpgradeTargetStage(viewMode); setUpgradeOpen(true); }
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (fetched.length > 0) {
      setIsReturn(true);
      // Only check static phases (0=ID&CV, 1=Qualification) for landing step.
      // Dynamic phases (2=Bearbeitung, 3=Visum) depend on slots that load
      // asynchronously; including them here would produce wrong results before
      // dynamicSlotsLoaded is true.
      const firstIncomplete = PHASES.slice(0, 2).findIndex(p =>
        p.items.filter(i => !i.optional).some(i => {
          const origLabels = FILE_KEY_ALL_LABELS[i.key];
          if (!fetched.find(d => origLabels?.has(d.file_type))) return true;
          if (i.transKey) {
            const transLabels = FILE_KEY_ALL_LABELS[i.transKey];
            if (!fetched.find(d => transLabels?.has(d.file_type))) return true;
          }
          return false;
        })
      );
      setPhase(firstIncomplete === -1 ? 0 : firstIncomplete);
      setMode("wizard");

      // Deep-link from notification: open doc preview directly
      const navDocId = new URLSearchParams(window.location.search).get("nav_doc_id");
      if (navDocId) {
        setPendingOpenDocId(navDocId);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }

  function getDoc(key: string, fromDocs = docs): Doc | undefined {
    const labels = FILE_KEY_ALL_LABELS[key];
    if (labels) return fromDocs.find(d => labels.has(d.file_type));
    return fromDocs.find(d => d.file_type === key);
  }

  function getDocAll(key: string, fromDocs = docs): Doc[] {
    const labels = FILE_KEY_ALL_LABELS[key];
    if (labels) return fromDocs.filter(d => labels.has(d.file_type));
    return fromDocs.filter(d => d.file_type === key);
  }

  // ── Auto-upload (no confirm step) ──────────────────────────────────────────
  function handleFile(file: File, key: string) {
    const ALLOWED_ID = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    const allowed = ID_KEYS.includes(key)    ? ALLOWED_ID
                  : OTHER_KEYS.includes(key) ? ALLOWED_ALL
                  : ALLOWED_PDF_ONLY;
    if (!allowed.includes(file.type)) {
      setSlotMsgTimed({ key, ok: false, type: OTHER_KEYS.includes(key) ? "errAllTypes" : "errPdfOnly" });
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setSlotMsgTimed({ key, ok: false, type: "errSize" });
      return;
    }
    uploadFile(file, key);
  }

  function uploadFile(file: File, key: string) {
    if (!userId) return;
    setUploadingKey(key);
    setSlotProgress(0);
    setSlotMsg(null);

    const item = ALL_ITEMS.find(i => i.key === key);
    // Dynamic slot keys are UUIDs (36 chars) or UUID_de — detect by pattern
    const UUID_PAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_de)?$/i;
    const isDynamic = UUID_PAT.test(key);
    if (!item && !isDynamic) {
      console.error("[upload] unknown fileKey:", key);
      setUploadingKey(null);
      setSlotMsg({ key, ok: false, type: "errUpload" });
      return;
    }
    // Dynamic slots store the UUID as file_type so getDoc(slotId) can match directly
    const fileType = isDynamic ? key : item!.label;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("fileType", fileType);
    fd.append("fileKey", key);
    fd.append("userId", userId);
    fd.append("firstName", firstName);
    fd.append("lastName", lastName);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) setSlotProgress(Math.round((e.loaded / e.total) * 90));
    });
    xhr.addEventListener("load", () => {
      xhrRef.current = null;
      setSlotProgress(100);
      try {
        if (xhr.status >= 200 && xhr.status < 300) {
          setSlotMsgTimed({ key, ok: true, type: "success" });
          if (fileInputRef.current) fileInputRef.current.value = "";
          // Issue 13.1: delete the OLD "other" doc AFTER the new upload
          // succeeded — never before, so a failed upload never empties the slot.
          // Guard by key: only delete if this upload is for the same slot the
          // replace was initiated from (prevents stale ref from leaking).
          const oldId     = replaceDocIdRef.current;
          const oldForKey = replaceForKeyRef.current;
          replaceDocIdRef.current  = null;
          replaceForKeyRef.current = null;
          if (oldId && oldForKey === key) {
            fetch(`/api/portal/documents/${oldId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${authToken}` },
            }).catch(e => console.error("[replace] cleanup delete failed:", e));
          }
          loadDocs(userId, true);
          // Passport: show confirmation modal with extracted data
          if (key === "id") {
            const json = JSON.parse(xhr.responseText);
            const blank: PassportData = { first_name: "", last_name: "", dob: "", sex: "", nationality: "", city_of_birth: "", country_of_birth: "", passport_no: "", passport_expiry: "", issuing_authority: "", issue_date: "", address_street: "", address_number: "", address_postal: "", city_of_residence: "", country_of_residence: "", marital_status: "", children_ages: "" };
            const raw = json.passportData ? { ...blank, ...json.passportData } : blank;
            // nationality and country_of_birth are ISO codes — select labels translate automatically
            setPassportModal({ ...raw, sex: normalizeSex(raw.sex, lang) });
            setConfirmedFields(new Set());
          }
        } else {
          replaceDocIdRef.current = null; replaceForKeyRef.current = null;
          setSlotMsgTimed({ key, ok: false, type: "errUpload" });
        }
      } catch {
        replaceDocIdRef.current = null; replaceForKeyRef.current = null;
        setSlotMsgTimed({ key, ok: false, type: "errUpload" });
      }
      setUploadingKey(null);
    });
    xhr.addEventListener("error", () => {
      xhrRef.current = null;
      replaceDocIdRef.current = null; replaceForKeyRef.current = null;
      setSlotMsgTimed({ key, ok: false, type: "errNetwork" });
      setUploadingKey(null);
    });
    xhr.addEventListener("abort", () => {
      xhrRef.current = null;
      replaceDocIdRef.current = null; replaceForKeyRef.current = null;
      setUploadingKey(null);
    });
    xhr.open("POST", "/api/portal/upload");
    if (authToken) xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
    xhr.send(fd);
  }

  function openPicker(key: string) {
    setActiveKey(key);
    setTimeout(() => fileInputRef.current?.click(), 0);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && activeKey) handleFile(file, activeKey);
  }

  // Issue 13.2: give visible feedback when a download fails (used by both the
  // per-slot Download button and the "other" sub-row button)
  function handleDownload(driveFileId: string, fileName: string, slotKey: string) {
    fetch(`/api/portal/file?id=${driveFileId}`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = fileName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      })
      .catch(err => {
        console.error("Download error:", err);
        setSlotMsgTimed({ key: slotKey, ok: false, type: "errDownload" });
      });
  }

  async function handleUpgradeToPremium(plan: "premium_onetime" | "premium_monthly" = "premium_onetime") {
    if (upgradeLoading) return; // double-click guard
    setUpgradeLoading(true);
    try {
      const res = await fetch("/api/portal/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.url) {
        window.location.href = json.url;
      } else {
        // Stripe not configured — show contact info
        alert(lang === "de" ? "Bitte kontaktieren Sie uns, um auf den Premium-Plan zu upgraden." : lang === "en" ? "Please contact us to upgrade to the Premium plan." : "Veuillez nous contacter pour passer au plan Premium.");
        setUpgradeOpen(false);
      }
    } catch {
      alert(lang === "de" ? "Upgrade momentan nicht verfügbar. Bitte kontaktieren Sie uns." : "Upgrade not available right now. Please contact us.");
      setUpgradeOpen(false);
    } finally {
      setUpgradeLoading(false);
    }
  }

  const onDrop = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    setDragOverKey(null);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file, key);
  // handleFile depends on userId/docs via closure — re-create when they change
  }, [userId, docs]); // eslint-disable-line react-hooks/exhaustive-deps

  function goNextPhase() {
    setSlotMsg(null); setDragOverKey(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setPhase(p => (p < PHASES.length - 1 ? p + 1 : 0));
  }

  function goPrevPhase() {
    if (phase === 0) return;
    setSlotMsg(null); setDragOverKey(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setPhase(p => p - 1);
  }

  function skipPhase() {
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    // On the last phase: just show "progress saved" — don't cycle back to phase 0
    if (phase === PHASES.length - 1) {
      setSkipMsg(true);
      skipTimerRef.current = setTimeout(() => setSkipMsg(false), 1800);
      return;
    }
    setSkipMsg(true);
    skipTimerRef.current = setTimeout(() => {
      setSkipMsg(false);
      goNextPhase();
    }, 1800);
  }

  const totalCount    = ALL_ITEMS.length;
  const doneCount     = ALL_ITEMS.filter(i => getDoc(i.key)).length;
  const pct           = Math.round((doneCount / totalCount) * 100);

  // Verified profile — single source of truth is the manually_verified flag,
  // which the backend flips when passport doc + passport data are both
  // approved (admin/route.ts → maybeGrantVerified) or when the supreme admin
  // grants it directly via /verify-user. Local doc-state fallback covers the
  // brief window between approval and the realtime push landing.
  const cvDoc       = getDoc("cv_de");
  const isVerified  = manuallyVerified || (passportStatus === "approved" && cvDoc?.status === "approved");
  const profileSlug = isVerified && userId
    ? buildProfileSlug(firstName, lastName, userId)
    : "";
  const currentPhase  = PHASES[phase];
  const phaseUploaded = currentPhase.items.filter(i => getDoc(i.key) || (i.transKey && getDoc(i.transKey))).length;
  const requiredItems = currentPhase.items.filter(i => !i.optional);
  const phaseComplete = requiredItems.every(i =>
    !!getDoc(i.key) && (!i.transKey || !!getDoc(i.transKey))
  );

  async function downloadMergedPdf(pairKey: string, origDocId: string, transDocId: string, label: string) {
    setMergingPair(pairKey);
    try {
      const res = await fetch(
        `/api/portal/documents/merge-pdf?origDocId=${encodeURIComponent(origDocId)}&transDocId=${encodeURIComponent(transDocId)}`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      if (!res.ok) throw new Error("merge failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const fn   = `${firstName}_${lastName}_${label.toLowerCase().replace(/\s+/g, "_")}_complet.pdf`;
      a.href = url; a.download = fn; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error("[merge-pdf]", e); }
    finally { setMergingPair(null); }
  }

  const statusColor = (s: string) =>
    s === "approved" ? { bg: "var(--success-bg)", text: "var(--success)", border: "var(--success-border)" } :
    s === "rejected"  ? { bg: "var(--danger-bg)", text: "var(--danger)", border: "var(--danger-bg)" } :
    { bg: "rgba(245,158,11,0.12)", text: "#f59e0b", border: "rgba(245,158,11,0.3)" };

  const statusLabel = (s: string) =>
    s === "approved" ? t.pStatusApproved :
    s === "rejected"  ? t.pStatusRejected : t.pStatusPending;

  if (loading) return <PageLoader />;

  // ── WIZARD ─────────────────────────────────────────────────────────────────
  return (
    <>
    {orgChecked && orgModalOpen && authToken && (
      <OrgCodeModal
        accessToken={authToken}
        onJoined={() => {
          setOrgModalOpen(false);
          // Refresh linked orgs so the badge appears immediately
          fetch(`/api/portal/me/organizations`, {
            headers: { Authorization: `Bearer ${authToken}` },
          })
            .then(r => r.json())
            .then(({ orgs }) => setLinkedOrgs(
              ((orgs ?? []) as { id: string; name: string; status: string }[]).filter(o => o.status !== "rejected")
            ))
            .catch(() => {});
        }}
        onSkip={() => {
          // Issue 4.2: persist dismiss so modal doesn't reappear on next login
          try { localStorage.setItem("bv-org-dismissed", "1"); } catch { /* private mode */ }
          setOrgModalOpen(false);
        }}
      />
    )}
    {/* Premium upgrade modal — shown when a free user tries a gated feature */}
    {upgradeOpen && (
      <>
        {/* Backdrop — locked while a Stripe checkout is being created so a
            stray click can't cancel the redirect mid-request. */}
        <div className="fixed inset-0 z-[1200]"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", animation: "bvFadeRise 0.2s var(--ease-out)", cursor: upgradeLoading ? "wait" : "pointer" }}
          onClick={() => { if (!upgradeLoading) { setUpgradeOpen(false); setUpgradeTargetStage(null); } }} />
        <div className="fixed inset-0 z-[1201] flex items-end sm:items-center justify-center p-4 pointer-events-none">
          <div className="w-full max-w-[380px] max-h-[90dvh] overflow-y-auto flex flex-col pointer-events-auto"
            style={{ background: "var(--card)", borderRadius: "24px", boxShadow: "0 24px 64px rgba(0,0,0,0.4)", animation: "bvFadeRise 0.26s var(--ease-out)" }}>
            {/* Header */}
            <div className="px-6 pt-7 pb-1 text-center">
              <span className="mx-auto mb-4 flex items-center justify-center w-14 h-14 rounded-full"
                style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
                <PhaseIcon kind="flight" size={24} style={{ color: "var(--gold)" }} />
              </span>
              <h3 className="text-[18px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                {lang === "de" ? "Premium-Plan erforderlich" : lang === "en" ? "Premium Plan Required" : "Plan Premium requis"}
              </h3>
            </div>
            {/* Price box — €19/month featured, €99 one-time underneath */}
            <div className="mx-6 my-5 px-4 py-3 rounded-2xl flex items-center gap-2"
              style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
              <span className="flex items-center gap-1.5 text-[13px] font-semibold flex-shrink-0" style={{ color: "var(--gold)" }}>
                <VerifiedBadge verified size="md" color="gold" />
                {lang === "de" ? "Premium" : "Premium"}
              </span>
              <span className="flex-1" />
              <div className="flex flex-col items-end leading-tight">
                <span className="flex items-end gap-1 leading-none">
                  <span className="text-[20px] font-bold tracking-tight leading-none" style={{ color: "var(--w)" }}>€19</span>
                  <span className="text-[11px] leading-none pb-[2px]" style={{ color: "var(--w3)" }}>
                    {lang === "de" ? "/Monat" : lang === "en" ? "/month" : "/mois"}
                  </span>
                </span>
                <span className="text-[10.5px] mt-0.5 flex items-center gap-1" style={{ color: "var(--w3)" }}>
                  {lang === "de" ? "oder €99 einmalig" : lang === "en" ? "or €99 one-time" : "ou 99€ unique"}
                </span>
              </div>
            </div>
            {/* Features */}
            <div className="px-6 pb-2 space-y-2">
              {([
                lang === "de" ? "Interview-Vorbereitung & Termin" : lang === "en" ? "Interview scheduling & preparation" : "Planification et préparation d'entretien",
                lang === "de" ? "Anerkennungs-Tracking" : lang === "en" ? "Recognition tracking" : "Suivi de reconnaissance",
                lang === "de" ? "Botschafts-Vorbereitung" : lang === "en" ? "Embassy preparation" : "Préparation ambassade",
                lang === "de" ? "Visum-Status-Updates" : lang === "en" ? "Visa status updates" : "Mises à jour du statut de visa",
                lang === "de" ? "Flugbuchungs-Info" : lang === "en" ? "Flight booking info" : "Informations de vol",
              ] as string[]).map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-[12.5px]" style={{ color: "var(--w2)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>{f}</span>
                </div>
              ))}
              {/* Gold verified badge row */}
              <div className="flex items-start gap-2 text-[12.5px]" style={{ color: "var(--w2)" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>{lang === "de" ? "Goldenes Abzeichen — Top-Priorität bei Einstellungen" : lang === "en" ? "Gold badge — top recruitment priority" : "Badge or — priorité maximale de recrutement"}</span>
              </div>
              {/* Refund — gold shimmer text */}
              <style>{`@keyframes bvWave{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}`}</style>
              <div className="flex items-start gap-2 text-[12.5px]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span className="font-semibold"
                  style={{ background: "linear-gradient(90deg,var(--gold),#f0dfa0,var(--gold),#a07830)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", animation: "bvWave 2.5s linear infinite" }}>
                  {lang === "de" ? "Rückerstattung, sobald Sie mit uns in Deutschland ankommen" : lang === "en" ? "Refundable once you land in Germany with us" : "Remboursable dès que vous arrivez en Allemagne avec nous"}
                </span>
              </div>
            </div>
            {/* CTAs — primary one-time (gold, save-13%) + secondary monthly (outline) */}
            <div className="p-5 pt-4 flex flex-col gap-2">
              <button
                onClick={() => handleUpgradeToPremium("premium_onetime")}
                disabled={upgradeLoading}
                className="w-full py-3 rounded-xl text-[14px] font-semibold tracking-tight transition-all hover:opacity-90 inline-flex items-center justify-center gap-2"
                style={{ background: "var(--gold)", color: "#131312", cursor: upgradeLoading ? "wait" : "pointer" }}>
                {upgradeLoading
                  ? (lang === "de" ? "Bitte warten…" : lang === "en" ? "Please wait…" : "Veuillez patienter…")
                  : (
                    <>
                      {lang === "de" ? "€99 einmalig" : lang === "en" ? "€99 one-time" : "99€ unique"}
                      <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ background: "rgba(19,19,18,0.15)", color: "#131312", border: "1px solid rgba(19,19,18,0.25)" }}>
                        -13%
                      </span>
                    </>
                  )}
              </button>
              <button
                onClick={() => handleUpgradeToPremium("premium_monthly")}
                disabled={upgradeLoading}
                className="w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "transparent", color: "var(--gold)", border: "1px solid var(--border-gold)", cursor: upgradeLoading ? "wait" : "pointer" }}>
                {lang === "de" ? "€19/Monat — Abo" : lang === "en" ? "€19/month — subscribe" : "19€/mois — abonnement"}
              </button>
              <button
                onClick={() => setUpgradeOpen(false)} disabled={upgradeLoading}
                className="w-full py-2 text-[13px] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: "var(--w3)", cursor: "pointer", background: "none", border: "none" }}>
                {lang === "de" ? "Später" : lang === "en" ? "Maybe later" : "Plus tard"}
              </button>
            </div>
          </div>
        </div>
      </>
    )}
    {/* Document-hint popup — opened by the small blue info circle next to
        each document row. Shows the "What is this?" explanation in the
        candidate's UI language. Identical look to the CV-builder popups
        so the help system feels consistent across the site. */}
    {docHintOpen && (
      <>
        <div className="fixed inset-0 z-[1100]"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", animation: "bvFadeRise 0.2s var(--ease-out)" }}
          onClick={() => setDocHintOpen(null)} />
        <div className="fixed inset-0 z-[1101] flex items-center justify-center p-4 pointer-events-none">
          <div className="w-full max-w-[400px] max-h-[85vh] overflow-y-auto flex flex-col pointer-events-auto"
            style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)" }}>
            <div className="px-6 pt-6 pb-2 text-center">
              <span className="mx-auto mb-3 flex items-center justify-center w-12 h-12 rounded-full"
                style={{ background: "var(--info-bg)", color: "var(--info)" }}>
                <Info size={20} strokeWidth={1.8} />
              </span>
              <h3 className="text-[16px] font-semibold mb-3" style={{ color: "var(--w)" }}>{docHintOpen.title}</h3>
              <p className="text-[13.5px] leading-relaxed text-left" style={{ color: "var(--w2)" }}>
                {docHintOpen.hint}
              </p>
            </div>
            <div className="p-4">
              <button type="button" onClick={() => setDocHintOpen(null)}
                className="block w-full text-center px-5 py-3 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90"
                style={{ background: "var(--gold)", color: "#131312", borderRadius: "12px", border: "none", cursor: "pointer" }}>
                {lang === "de" ? "Verstanden" : lang === "en" ? "Got it" : "Compris"}
              </button>
            </div>
          </div>
        </div>
      </>
    )}
    {/* Passport Info modal */}
    {infoPassportData !== null && (() => {
      const d = infoPassportData;
      const fmt_i = (iso: string | null | undefined) => {
        if (!iso) return "—";
        const dt = new Date(iso);
        const dd = String(dt.getUTCDate()).padStart(2, "0");
        const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
        const yyyy = dt.getUTCFullYear();
        return `${dd}.${mm}.${yyyy}`;
      };
      const cap_i = (s: string | null | undefined) => s
        ? s.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ")
        : "—";
      // For nationality: always show German adjective ("marokkanisch"); for country fields: show country name in current language
      const nat_i = (v: string | null | undefined) => {
        if (!v || v === "—") return "—";
        const translated = natToLang(v, lang);
        return translated || cap_i(v);
      };
      const natAdj_i = (v: string | null | undefined) => nat_i(v);
      const sex_i = d.sex === "M"
        ? (lang === "fr" ? "Masculin" : lang === "de" ? "Männlich" : "Male")
        : d.sex === "F"
          ? (lang === "fr" ? "Féminin" : lang === "de" ? "Weiblich" : "Female")
          : d.sex || "—";
      const expired = d.passport_expiry && new Date(d.passport_expiry) < new Date();
      return (
        <div className="fixed inset-x-0 bottom-0 z-[820] flex items-center justify-center p-4 bv-modal-outer"
          style={{ top: "calc(58px + var(--bv-subnav-h, 0px))", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setInfoPassportData(null)}>
          <div className="w-full max-w-md overflow-hidden flex flex-col"
            style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
              maxHeight: "88vh", animation: "bvFadeRise .28s var(--ease-out)",
            }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] flex items-center gap-2" style={{ color: "var(--gold)" }}>
                <IdCard size={12} strokeWidth={1.8} />
                {lang === "fr" ? "Données du passeport — extraites" : lang === "de" ? "Passdaten — extrahiert" : "Passport data — extracted"}
              </p>
              <button onClick={() => setInfoPassportData(null)}
                className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center text-xs"
                style={{ color: "var(--w3)" }}><XIcon size={13} strokeWidth={1.8} /></button>
            </div>
            {/* Content */}
            <div className="overflow-y-auto flex-1 px-5 py-4">
              {[
                { title: (lang === "fr" ? "Personnel" : lang === "de" ? "Persönlich" : "Personal"), fields: [
                  { label: t.pFieldLastName,        value: cap_i(d.last_name) },
                  { label: t.pFieldFirstName,       value: cap_i(d.first_name) },
                  { label: t.pFieldDob,             value: fmt_i(d.dob) },
                  { label: t.pFieldSex,             value: sex_i },
                  { label: t.pFieldNationality,     value: natAdj_i(d.nationality) },
                  { label: t.pFieldCityOfBirth,     value: cap_i(d.city_of_birth) },
                  { label: t.pFieldCountryOfBirth,  value: nat_i(d.country_of_birth) },
                ]},
                { title: (lang === "fr" ? "Passeport" : lang === "de" ? "Reisepass" : "Passport"), fields: [
                  { label: t.pFieldPassportNo,        value: d.passport_no ?? "—" },
                  { label: t.pFieldIssueDate,         value: fmt_i(d.issue_date) },
                  { label: t.pFieldExpiry,            value: fmt_i(d.passport_expiry), warn: !!expired },
                  { label: t.pFieldIssuingAuthority,  value: cap_i(d.issuing_authority) },
                ]},
                { title: (lang === "fr" ? "Adresse" : lang === "de" ? "Adresse" : "Address"), fields: [
                  { label: lang === "fr" ? "Rue" : lang === "de" ? "Straße" : "Street",                     value: cap_i(d.address_street) },
                  { label: t.pFieldAddressNumber,     value: d.address_number ?? "—" },
                  { label: t.pFieldAddressPostal,     value: d.address_postal ?? "—" },
                  { label: t.pFieldCityOfResidence,   value: cap_i(d.city_of_residence) },
                  { label: t.pFieldCountryOfResidence, value: nat_i(d.country_of_residence) },
                ]},
              ].map((group, gi) => (
                <div key={group.title} className={gi > 0 ? "mt-4" : ""}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--w3)" }}>{group.title}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    {group.fields.map(f => (
                      <div key={f.label}>
                        <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--w3)" }}>{f.label}</p>
                        <p className="text-[12px] font-semibold mt-0.5" style={{ color: "warn" in f && f.warn ? "var(--danger)" : "var(--w)" }}>
                          {f.value}{"warn" in f && f.warn ? <AlertTriangle size={11} strokeWidth={1.8} className="inline ml-1 -mt-0.5" /> : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                  {gi < 2 && <div className="mt-3" style={{ height: 1, background: "var(--border)" }} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    })()}

    {/* Doc preview modal */}
    {previewDoc && (() => {
      // Verification phase = the previewed doc IS a passport AND it isn't
      // fully approved yet. While that's true, the data form auto-opens
      // alongside this preview (laptop: side-by-side, phone: stacked) — same
      // rule the admin side uses.
      const isPassportDoc = /pass/i.test(previewDoc.file_type);
      // Side-by-side only during first-time submission (no status yet).
      // Once submitted (pending / approved / rejected) the doc viewer
      // shows full-screen with zoom/rotation; data opens as standalone popup.
      const verificationPhase = isPassportDoc && !passportStatus;
      return (
      <div className={`fixed inset-x-0 z-[700] flex justify-center px-2 bv-cand-preview-outer ${verificationPhase && passportModal ? "bv-side-preview-cand" : "items-center"}`}
        style={{
          top: "calc(58px + var(--bv-subnav-h, 0px))",
          paddingTop: "6px",
          bottom: 0,
          background: verificationPhase && passportModal ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.72)",
          backdropFilter: verificationPhase && passportModal ? "blur(8px)" : undefined,
        }}
        onClick={() => setPreviewDoc(null)}>
        <style>{`
          .bv-cand-preview-card {
            height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 6px - env(safe-area-inset-bottom, 0px));
            max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 6px - env(safe-area-inset-bottom, 0px));
          }
          @media (max-width: 639.98px) {
            .bv-cand-preview-outer { padding-bottom: calc(72px + 6px + env(safe-area-inset-bottom, 0px)) !important; }
            .bv-cand-preview-card  {
              height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 72px - 6px - env(safe-area-inset-bottom, 0px)) !important;
              max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 72px - 6px - env(safe-area-inset-bottom, 0px)) !important;
            }
            .bv-side-preview-cand {
              top: calc(58px + var(--bv-subnav-h, 0px)) !important;
              bottom: calc(50dvh + 0.25rem) !important;
              padding-bottom: 0.25rem !important;
              align-items: center !important;
            }
            .bv-side-preview-cand .bv-cand-preview-card {
              height: 100% !important;
              max-height: 100% !important;
            }
          }
          @media (min-width: 640px) {
            .bv-side-preview-cand {
              top: calc(58px + var(--bv-subnav-h, 0px));
              bottom: 0;
              align-items: center;
              justify-content: flex-end !important;
              padding-right: 50vw;
              padding-left: 1rem;
            }
            .bv-side-preview-cand .bv-cand-preview-card {
              max-height: 620px !important;
              height: auto !important;
            }
          }
        `}</style>
        <div className={`bv-cand-preview-card w-full overflow-hidden flex flex-col ${verificationPhase && passportModal ? "sm:max-w-[560px]" : "max-w-3xl"}`}
          style={{
            background: "var(--card)", border: "1px solid var(--border)",
            borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
            height: verificationPhase && passportModal ? "auto" : undefined,
            maxHeight: verificationPhase && passportModal ? "620px" : undefined,
            minHeight: verificationPhase && passportModal ? "420px" : undefined,
            animation: "bvFadeRise .28s var(--ease-out)",
          }}
          onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5"
            style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="min-w-0 flex-1 mr-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-0.5" style={{ color: "var(--w3)" }}>{previewDoc.file_type}</p>
              <p className="text-[13.5px] font-semibold truncate tracking-tight" style={{ color: "var(--w)" }}>{previewDoc.file_name}</p>
            </div>
            {/* "Passport data" button — only on passport docs. Re-opens the
                same data form they confirmed at upload, populated from
                whatever they already saved. Always available; auto-opens
                during the verification phase via the effect below. */}
            {isPassportDoc && (
              <button
                type="button"
                onClick={() => { reopenPassportData(); }}
                title={lang === "de" ? "Passdaten" : lang === "fr" ? "Données du passeport" : "Passport data"}
                aria-label={lang === "de" ? "Passdaten" : lang === "fr" ? "Données du passeport" : "Passport data"}
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 h-8 rounded-full transition-colors"
                style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2"/>
                  <circle cx="9" cy="10" r="2"/>
                  <line x1="14" y1="9" x2="18" y2="9"/>
                  <line x1="14" y1="13" x2="18" y2="13"/>
                  <line x1="6" y1="16" x2="18" y2="16"/>
                </svg>
                {lang === "de" ? "Passdaten" : lang === "fr" ? "Données" : "Passport data"}
              </button>
            )}
            {previewBlobUrl && (
              <a
                href={previewBlobUrl}
                download={previewDoc.file_name}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
                style={{ color: "var(--w2)" }}
                aria-label={lang === "de" ? "Herunterladen" : lang === "fr" ? "Télécharger" : "Download"}
                title={lang === "de" ? "Herunterladen" : lang === "fr" ? "Télécharger" : "Download"}>
                <Download size={14} strokeWidth={1.8} />
              </a>
            )}
            <button onClick={() => setPreviewDoc(null)}
              aria-label={lang === "de" ? "Schließen" : lang === "fr" ? "Fermer" : "Close"}
              className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
              style={{ color: "var(--w3)" }}>
              <XIcon size={14} strokeWidth={1.8} />
            </button>
          </div>
          {/* Preview — PDF, image, or fallback download. */}
          <div className="flex-1" style={{ minHeight: 0, position: "relative" }}>
            {previewLoading || !previewBlobUrl ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#525659" }}>
                <Spinner size="md" />
              </div>
            ) : (() => {
              const ext = (previewDoc.file_name.split(".").pop() ?? "").toLowerCase();
              if (ext === "pdf") return (
                <PdfViewer
                  src={previewBlobUrl}
                  onRotate={() => {
                    fetch(`/api/portal/documents/${previewDoc.id}`, {
                      method: "PATCH",
                      headers: {
                        "Content-Type": "application/json",
                        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                      },
                      body: JSON.stringify({ deltaRotation: 90 }),
                    }).catch(e => console.error("[rotation] persist failed:", e));
                  }}
                />
              );
              if (ext === "docx") return <DocxViewer src={previewBlobUrl} fileName={previewDoc.file_name} />;
              if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) {
                return (
                  <ZoomPanRotateViewer>
                    { /* eslint-disable-next-line @next/next/no-img-element */ }
                    <img src={previewBlobUrl} alt={previewDoc.file_name}
                      draggable={false}
                      style={{ maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", userSelect: "none", pointerEvents: "none" }} />
                  </ZoomPanRotateViewer>
                );
              }
              return (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#525659", color: "#fff", padding: "1rem", textAlign: "center" }}>
                  <p className="text-[14px] font-semibold mb-2">Preview not available for .{ext}</p>
                  <p className="text-[12.5px] opacity-80 mb-4">Download the file to open it in your default app.</p>
                  <a href={previewBlobUrl} download={previewDoc.file_name}
                    className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold"
                    style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-sm)" }}>
                    <Download size={13} strokeWidth={1.8} /> Download
                  </a>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
      );
    })()}
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="max-w-[780px] mx-auto px-4 pt-8 pb-16">

        {/* Header — refined typographic hierarchy */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.015em] inline-flex items-center" style={{ color: "var(--w)" }}>
              {isReturn ? t.pWelcomeBack : t.pDashWelcome} {userName.split(" ")[0]}
              {/* Verified blue check shows once both passport AND Lebenslauf
                  are approved by an admin — this is the candidate's
                  "verified profile" signal across the entire site. */}
              <VerifiedBadge verified={isVerified} size="sm"
                title={lang === "de" ? "Verifiziert" : lang === "en" ? "Verified" : "Vérifié"} />
            </h1>
            <p className="text-[13.5px] mt-1.5" style={{ color: "var(--w3)" }}>
              {isReturn ? t.pWelcomeBackSub : t.pDashSpace}
            </p>
            {linkedOrgs.filter(o => o.status === "pending").length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {linkedOrgs.filter(o => o.status === "pending").map(o => (
                  <span key={o.id}
                    className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5"
                    title={`${lang === "de" ? "Anfrage an" : lang === "en" ? "Request to" : "Demande à"} ${o.name} — ${lang === "de" ? "wartet auf Genehmigung" : lang === "en" ? "pending approval" : "en attente d'approbation"}`}
                    style={{
                      background: "var(--gdim)", color: "var(--gold)",
                      border: "1px solid var(--border-gold)", borderRadius: "var(--r-sm)",
                    }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
                    </svg>
                    {o.name} · {lang === "de" ? "ausstehend" : lang === "en" ? "pending" : "en attente"}
                  </span>
                ))}
              </div>
            )}
          </div>
          {/* Progress indicator (2/21 · 10%) intentionally removed —
              will be redesigned in a future phase. Keep doneCount /
              totalCount / pct in the local state in case other places
              start consuming them again. */}
        </div>

        {/* Verified-profile panel — appears once the candidate has the blue
            check. Shows their permanent public URL with a copy button.
            Premium card surface (matches CV builder), with the blue accent
            held to the badge + URL color so the card itself stays neutral. */}
        {isVerified && profileSlug && (
          <div className="mb-6 px-5 py-4 flex items-center gap-3"
            style={{
              background: "var(--card)",
              borderRadius: "20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}>
            <VerifiedBadge verified={true} size="md" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>
                {lang === "de" ? "Glückwunsch — Ihr Profil ist verifiziert!" : lang === "en" ? "Congrats — your profile is verified!" : "Félicitations — votre profil est vérifié !"}
              </p>
              <p className="text-[12px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>
                borivon.com/{profileSlug}
              </p>
            </div>
            <button
              onClick={() => {
                try { navigator.clipboard.writeText(`https://borivon.com/${profileSlug}`); } catch { /* ignore */ }
              }}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-full transition-opacity hover:opacity-80 flex-shrink-0"
              style={{ background: "var(--bg2)", color: "var(--w)", border: "none" }}>
              {lang === "de" ? "Kopieren" : lang === "en" ? "Copy" : "Copier"}
            </button>
          </div>
        )}

        {/* ── Pending signature requests ── */}
        {signRequests.length > 0 && (
          <div className="mb-6">
            <PendingSignatures
              requests={signRequests}
              lang={(lang as "en" | "fr" | "de") in { en: 1, fr: 1, de: 1 } ? lang as "en" | "fr" | "de" : "en"}
              authToken={authToken}
              onSigned={(id) => setSignRequests(prev => prev.map(r => r.id === id ? { ...r, status: "signed" } : r))}
            />
          </div>
        )}

        {/* ── Partner Organization cards ──
            Shown for every approved org the candidate is placed in.
            Admin-initiated placements appear here within ~30 s of being set. */}
        {linkedOrgs.filter(o => o.status === "approved").map(org => (
          <div key={org.id} className="mb-4 px-5 py-4 flex items-center gap-3"
            style={{
              background: "var(--card)",
              borderRadius: "20px",
              border: "1px solid var(--border-gold)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}>
            {/* Building icon */}
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
                <path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                {org.name}
              </p>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--w3)" }}>
                {lang === "de" ? "Ihr Partner-Unternehmen" : lang === "en" ? "Your partner organization" : "Votre organisation partenaire"}
              </p>
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full flex-shrink-0"
              style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
              {lang === "de" ? "Verbunden" : lang === "en" ? "Matched" : "Associé"}
            </span>
          </div>
        ))}


        {/* Two-column: sidebar stepper + main content */}
        <div className="flex gap-4 sm:gap-6 items-start">

          {/* ── Vertical sidebar — always visible, same pattern as the
              admin dashboard. No hamburger drawer on mobile; the rail just
              shrinks to 60px on phones so it stays inline with the content. */}
          <aside className={`shrink-0 w-[44px] sm:w-[52px]`}
            style={{ position: "sticky", top: "calc(61px + 1.5rem)" }}>
            {DOC_SIDEBAR_PHASES.map((ph, i) => {
              const isActive = i === phase && viewMode === "docs";

              // Gold on active — minimalist borderless treatment
              const circleText   = isActive ? "var(--gold)" : "var(--w3)";
              const lineColor    = "var(--border)";

              // Candidate-side badge: count docs the ADMIN has acted on
              // (approved OR rejected) that the candidate hasn't opened yet.
              // Once the candidate clicks the doc row the ID is saved to
              // localStorage and the badge count drops to zero.
              const decidedCnt = ph.items.reduce((n, it) => {
                const list = getDocAll(it.key);
                if (list.length === 0) return n;
                return n + list.filter(d =>
                  (d.status === "approved" || d.status === "rejected") && !seenDocIds.has(d.id)
                ).length;
              }, 0);
              const rejectedCnt = ph.items.reduce((n, it) => {
                const list = getDocAll(it.key);
                if (list.length === 0) return n;
                return n + list.filter(d => d.status === "rejected" && !seenDocIds.has(d.id)).length;
              }, 0);
              const badgeColor = rejectedCnt > 0 ? "var(--danger)" : "var(--gold)";

              return (
                <div key={i} className="flex flex-col items-center">
                  <button
                    onClick={() => { setPhase(i); setViewMode("docs"); setSlotMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    title={ph.title}
                    className="bv-lift-hover w-full flex flex-col items-center gap-1 py-1"
                  >
                    <span
                      className="relative flex items-center justify-center w-8 h-8 rounded-full leading-none select-none transition-all duration-300"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: circleText,
                        transform: isActive ? "scale(1.08)" : "scale(1)",
                        transition: "color 0.2s, transform 0.15s",
                      }}
                    >
                      <PhaseIcon kind={ph.kind} size={14} />
                      {decidedCnt > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center px-1"
                          style={{ background: badgeColor, color: "#131312", border: "1.5px solid var(--bg)" }}>
                          {decidedCnt}
                        </span>
                      )}
                    </span>
                    <span
                      className="text-[8px] text-center leading-tight font-medium px-0.5 w-full"
                      style={{ color: circleText }}
                    >
                      {ph.shortTitle}
                    </span>
                  </button>
                  <div className="w-px transition-colors duration-500" style={{ height: 18, background: lineColor }} />
                </div>
              );
            })}

            {/* Journey stage icons */}
            {JOURNEY_STAGES.map((js, ji) => {
              const unlocked = isJourneyUnlocked(js.key, pipeline);
              const adminOpen = isAdminUnlocked(js.key, pipeline);
              // recognition → docs phase 2, visum → docs phase 3 (upload-first stages)
              const isDocsStage = js.key === "recognition" || js.key === "visum";
              const docsPhaseIdx = js.key === "recognition" ? 2 : 3;
              const isActive = isDocsStage
                ? (viewMode === "docs" && phase === docsPhaseIdx)
                : viewMode === js.key;
              const stageLabel = t[`pJourney${js.key.charAt(0).toUpperCase() + js.key.slice(1)}` as keyof typeof t] as string;
              // Inert = Premium but stage not yet opened by admin
              const isInert = hasPremium && !unlocked && !adminOpen;
              // Accessible = Premium user OR admin explicitly unlocked this stage
              const accessible = hasPremium || adminOpen;
              return (
                <div key={js.key} className="flex flex-col items-center">
                  <button
                    onClick={() => {
                      // Non-premium + stage not admin-unlocked → show upgrade modal
                      if (!hasPremium && !adminOpen) { setUpgradeTargetStage(js.key); setUpgradeOpen(true); return; }
                      if (unlocked || adminOpen) {
                        if (isDocsStage) {
                          setPhase(docsPhaseIdx); setViewMode("docs"); setSlotMsg(null);
                        } else {
                          setViewMode(js.key);
                        }
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }
                    }}
                    disabled={isInert}
                    title={accessible ? stageLabel : t.pJourneyLocked}
                    aria-label={accessible ? stageLabel : `${stageLabel} — ${t.pJourneyLocked}`}
                    className="w-full flex flex-col items-center gap-1 py-1 bv-lift-hover"
                    style={{ cursor: isInert ? "not-allowed" : "pointer", opacity: (unlocked || adminOpen) ? 1 : 0.45, WebkitTapHighlightColor: "transparent" }}
                  >
                    <span
                      className="relative flex items-center justify-center w-8 h-8 rounded-full leading-none select-none transition-all duration-300"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: isActive ? "var(--gold)" : "var(--w3)",
                        transform: isActive ? "scale(1.08)" : "scale(1)",
                        transition: "color 0.2s, transform 0.15s",
                      }}>
                      <PhaseIcon kind={js.kind} size={13} />
                      {!unlocked && !adminOpen && (
                        <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full"
                          style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                          <Lock size={7} strokeWidth={2.2} style={{ color: "var(--w3)" }} />
                        </span>
                      )}
                    </span>
                    <span className="text-[8px] text-center leading-tight font-medium"
                      style={{ color: isActive ? "var(--gold)" : "var(--w3)" }}>
                      {stageLabel}
                    </span>
                  </button>
                  {ji < JOURNEY_STAGES.length - 1 && (
                    <div className="w-px" style={{ height: 18, background: "var(--border)" }} />
                  )}
                </div>
              );
            })}
          </aside>

          {/* ── Main content ── */}
          <div className="flex-1 min-w-0">

            {/* ── Journey stage views ──
                The plan-gate effect above bounces non-Premium users back to
                docs; we render JourneyView only when they're allowed in. */}
            {viewMode !== "docs" && (!profileLoaded || hasPremium || isAdminUnlocked(viewMode, pipeline)) && (
              <JourneyView mode={viewMode} pipeline={pipeline} t={t} lang={lang} onBack={() => { setViewMode("docs"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
            )}

            {/* Doc upload UI — only shown in docs mode.
                Phase header (icon, "PHASE 1", title, description) removed
                for minimalism — the active phase is already indicated by the
                gold icon in the left rail, that's enough context. */}
            {viewMode === "docs" && <div key={`docs-phase-${phase}`} className="bv-enter">

            {/* Premium phase card — mirrors the admin candidate-detail panel
                so both sides share one visual language. Header inside the
                card (gold icon + "Phase N" eyebrow + title + pending count),
                notice strip below the divider, then borderless doc rows. */}
            <div className="overflow-hidden mb-4"
              style={{
                background: "var(--card)",
                borderRadius: "20px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}>

              {/* Phase header */}
              {(() => {
                const pending = currentPhase.items.reduce((n, i) => {
                  const keys = [i.key, ...(i.transKey ? [i.transKey] : [])];
                  return n + keys.reduce((m, k) => m + getDocAll(k).filter(d => d.status === "pending").length, 0);
                }, 0);
                return (
                  <div className="flex items-center gap-3 px-6 pt-6 pb-3">
                    <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                      style={{ background: "var(--gdim)", color: "var(--gold)", borderRadius: "12px" }}>
                      <PhaseIcon kind={currentPhase.kind} size={15} />
                    </span>
                    <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                      <h2 className="text-[18px] font-semibold tracking-[-0.015em] leading-tight" style={{ color: "var(--w)" }}>
                        {currentPhase.title}
                      </h2>
                      <button
                        type="button"
                        onClick={() => setDocHintOpen({
                          title: lang === "de" ? "Wichtig" : lang === "fr" ? "Important" : "Important",
                          hint: (
                            <span className="flex flex-col gap-4">
                              <span className="flex flex-col gap-1">
                                <span className="font-semibold text-[12px] uppercase tracking-wider" style={{ color: "var(--w3)" }}>
                                  {lang === "de" ? "Scan" : lang === "fr" ? "Numérisation" : "Scan"}
                                </span>
                                <span>{lang === "de" ? "Nur Maschinenscanner. Handyfotos abgelehnt." : lang === "fr" ? "Scanner uniquement. Photos de téléphone refusées." : "Machine scanner only. Phone photos rejected."}</span>
                              </span>
                              {phase === 1 && (
                                <span className="flex flex-col gap-1.5 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                                  <span className="font-semibold text-[12px] uppercase tracking-wider" style={{ color: "var(--w3)" }}>
                                    {lang === "de" ? "Nur vereidigte Übersetzer akzeptiert" : lang === "fr" ? "Seuls les traducteurs assermentés acceptés" : "Only sworn translators accepted"}
                                  </span>
                                  <a href="https://rabat.diplo.de/resource/blob/2417070/461b64d35650206a0f64ffb772feee9f/uebersetzer-liste-data.pdf"
                                    target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--gold)" }}>
                                    {lang === "de" ? "Marokko" : lang === "fr" ? "Maroc" : "Morocco"} ↗
                                  </a>
                                  <a href="https://www.justiz-dolmetscher.de/Recherche/de/Suchen"
                                    target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--gold)" }}>
                                    {lang === "de" ? "Deutschland" : lang === "fr" ? "Allemagne" : "Germany"} ↗
                                  </a>
                                </span>
                              )}
                            </span>
                          ),
                        })}
                        aria-label={lang === "de" ? "Wichtig" : lang === "fr" ? "Important" : "Important"}
                        title={lang === "de" ? "Wichtig" : lang === "fr" ? "Important" : "Important"}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full transition-opacity hover:opacity-80 flex-shrink-0"
                        style={{ background: "var(--info-bg)", color: "var(--info)", border: "none", cursor: "pointer" }}>
                        <Info size={11} strokeWidth={2.2} />
                      </button>
                    </div>
                    {pending > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium flex-shrink-0"
                        style={{ color: "var(--gold)" }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--gold)" }} />
                        {pending} {lang === "de" ? "in Prüfung" : lang === "en" ? "pending" : "en attente"}
                      </span>
                    )}
                  </div>
                );
              })()}

              <div className="h-px mx-6" style={{ background: "var(--border)" }} />


              {/* Empty state for dynamic phases with no slots configured yet */}
              {dynamicSlotsLoaded && currentPhase.items.length === 0 && (phase === 2 || phase === 3) && (
                <div className="px-6 py-10 text-center">
                  <p className="text-[12px]" style={{ color: "var(--w3)" }}>
                    {lang === "de" ? "Dokumente werden konfiguriert." : lang === "fr" ? "Documents en cours de configuration." : "Documents being configured."}
                  </p>
                </div>
              )}

              {/* Doc rows — borderless minimalist list */}
              <div className="px-3 pb-2">
          {currentPhase.items.map((item, idx) => {
            // ── Paired master box (nursing items with original + translation) ──
            if (item.transKey) {
              const origDoc    = getDoc(item.key);
              const transDoc   = getDoc(item.transKey);
              const isExpanded = expandedPairs.has(item.key);
              const origSt  = !origDoc  ? "empty" : origDoc.status  === "approved" ? "approved" : origDoc.status  === "rejected" ? "rejected" : "pending";
              const transSt = !transDoc ? "empty" : transDoc.status === "approved" ? "approved" : transDoc.status === "rejected" ? "rejected" : "pending";
              const bothApproved = origSt === "approved" && transSt === "approved";
              const hasRejected  = origSt === "rejected"  || transSt === "rejected";
              const hasPending   = origSt === "pending"   || transSt === "pending";
              const pairColor = bothApproved ? "#16a34a" : hasRejected ? "#ef4444" : hasPending ? "#f59e0b" : null;
              return (
                <div key={item.key}>
                  {idx > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                  {/* Master header — mirrors admin pair master row */}
                  <div
                    className={`px-3 py-3 flex items-center gap-2${origDoc && transDoc ? " cursor-pointer bv-row-hover" : ""}`}
                    onClick={() => setExpandedPairs(prev => { const n = new Set(prev); n.has(item.key) ? n.delete(item.key) : n.add(item.key); return n; })}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[11.5px] font-medium tracking-tight" style={{ color: pairColor ?? "var(--w)" }}>{item.label}</p>
                        {item.key === "workcert" && (
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); setShowWorkGuide(true); }}
                            aria-label={t.pWhatIsThis} title={t.pWhatIsThis}
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full transition-opacity hover:opacity-80"
                            style={{ background: "var(--info-bg)", color: "var(--info)", border: "none", cursor: "pointer" }}>
                            <Info size={11} strokeWidth={2.2} />
                          </button>
                        )}
                      </div>
                      {item.optional && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>{t.pOptional}</span>
                      )}
                    </div>
                    {origDoc && transDoc && (
                      <button type="button"
                        disabled={mergingPair === item.key}
                        title={lang === "de" ? "Kombi-PDF" : "Merged PDF"}
                        aria-label="Download merged PDF"
                        className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40 flex-shrink-0"
                        style={{ color: "var(--w2)" }}
                        onClick={e => { e.stopPropagation(); downloadMergedPdf(item.key, origDoc.id, transDoc.id, item.label); }}>
                        {mergingPair === item.key
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
                        setExpandedPairs(prev => { const n = new Set(prev); n.has(item.key) ? n.delete(item.key) : n.add(item.key); return n; });
                      }}>
                      <ChevronDown size={13} strokeWidth={1.8}
                        style={{ transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }} />
                    </button>
                  </div>
                  {/* Sub-boxes — only shown when expanded. Mirrors admin layout 1:1. */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-1.5">
                      {([
                        { subKey: item.key,      subDoc: origDoc,  subLabel: "Original" },
                        { subKey: item.transKey, subDoc: transDoc, subLabel: lang === "de" ? "Übersetzt" : lang === "fr" ? "Traduit" : "Translated" },
                      ] as { subKey: string; subDoc: typeof origDoc; subLabel: string }[]).map(sub => {
                        const sst = !sub.subDoc ? "empty" : sub.subDoc.status;
                        const ssc = sst === "approved" ? { bg: "var(--success-bg)", txt: "var(--success)", bdr: "var(--success-border)" }
                          : sst === "rejected" ? { bg: "var(--danger-bg)", txt: "var(--danger)", bdr: "var(--danger-bg)" }
                          : sst === "pending"  ? { bg: "rgba(245,158,11,0.12)", txt: "#f59e0b", bdr: "rgba(245,158,11,0.3)" }
                          : { bg: "var(--bg2)", txt: "var(--w3)", bdr: "var(--border)" };
                        const isSubUp = uploadingKey === sub.subKey;
                        const isDragSub = dragOverKey === sub.subKey;
                        const subMsg = slotMsg?.key === sub.subKey ? slotMsg : null;
                        const menuOpen = candSubMenu === sub.subKey;
                        return (
                          <div key={sub.subKey}
                            onDragOver={e => { e.preventDefault(); setDragOverKey(sub.subKey); }}
                            onDragLeave={() => setDragOverKey(null)}
                            onDrop={e => onDrop(e, sub.subKey)}
                            onClick={() => {
                              if (isSubUp) return;
                              if (sub.subDoc) handlePreview(sub.subDoc);
                              else openPicker(sub.subKey);
                            }}
                            className={`rounded-xl px-3 py-3${isSubUp ? "" : " bv-row-hover cursor-pointer"}`}
                            style={{ background: isDragSub ? "var(--gdim)" : "var(--bg2)", border: `1px solid ${isDragSub ? "var(--gold)" : "var(--border)"}`, minHeight: 60 }}>
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <p className="text-[11.5px] font-medium tracking-tight" style={{ color: sub.subDoc ? ssc.txt : "var(--w2)" }}>{sub.subLabel}</p>
                                  {sst !== "approved" && (
                                    <span className="text-[10px] font-mono tracking-wide" style={{ color: "var(--w3)" }}>PDF</span>
                                  )}
                                </div>
                                {sub.subDoc && sst === "rejected" && sub.subDoc.feedback && (
                                  <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--danger)" }}>{sub.subDoc.feedback}</p>
                                )}
                                {isSubUp && <div className="mt-1"><div className="w-full rounded-full h-1" style={{ background: "var(--border)" }}><div className="h-1 rounded-full" style={{ width: `${slotProgress}%`, background: "var(--gold)" }} /></div><p className="text-[9px] mt-0.5" style={{ color: "var(--w3)" }}>{slotProgress}%</p></div>}
                                {subMsg && <p className="mt-1 text-[9.5px]" style={{ color: subMsg.ok ? "var(--success)" : "var(--danger)" }}>{subMsg.ok ? t.pUploadSuccess.replace("{label}", sub.subLabel) : subMsg.type === "errPdfOnly" ? t.pErrPdfOnly : subMsg.type === "errAllTypes" ? t.pErrAllTypes : subMsg.type === "errSize" ? t.pErrSize : t.pErrUpload}</p>}
                              </div>
                              {!isSubUp && !sub.subDoc && (
                                <span
                                  aria-hidden="true"
                                  className="inline-flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
                                  style={{ color: "var(--gold)" }}>
                                  <Upload size={13} strokeWidth={1.8} />
                                </span>
                              )}
                              {!isSubUp && sub.subDoc && (
                                <div className="flex items-center gap-1 flex-shrink-0"
                                  onClick={e => e.stopPropagation()}
                                  onMouseDown={e => e.stopPropagation()}>
                                  {sub.subDoc.drive_file_id && (
                                    <button type="button"
                                      onClick={() => handleDownload(sub.subDoc!.drive_file_id!, sub.subDoc!.file_name, sub.subKey)}
                                      title={lang === "de" ? "Herunterladen" : lang === "fr" ? "Télécharger" : "Download"}
                                      className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                      style={{ color: "var(--w2)" }}>
                                      <Download size={13} strokeWidth={1.8} />
                                    </button>
                                  )}
                                  <div className="relative flex-shrink-0" style={{ zIndex: menuOpen ? 600 : undefined }}>
                                    <button
                                      onClick={e => { e.stopPropagation(); setCandSubMenu(prev => prev === sub.subKey ? null : sub.subKey); }}
                                      className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                                      style={{ color: "var(--w2)" }}>
                                      <MoreHorizontal size={15} strokeWidth={1.8} />
                                    </button>
                                    {menuOpen && (
                                      <>
                                        <div className="fixed inset-0" style={{ zIndex: 599 }}
                                          onClick={e => { e.stopPropagation(); setCandSubMenu(null); }} />
                                        <div className="absolute right-0 top-full mt-1 rounded-xl overflow-hidden"
                                          style={{ zIndex: 600, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", minWidth: 160, borderRadius: "var(--r-md)" }}>
                                          {sub.subDoc.status !== "approved" && (
                                            <button
                                              onClick={e => { e.stopPropagation(); setCandSubMenu(null); openPicker(sub.subKey); }}
                                              className="bv-row-hover w-full text-left px-3 py-2.5 text-[11px] font-medium inline-flex items-center gap-1.5"
                                              style={{ color: "var(--w)" }}>
                                              <RefreshCw size={11} strokeWidth={1.8} /> {t.pReplaceBtn}
                                            </button>
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                            {isDragSub && <p className="text-[9.5px] mt-1 text-center" style={{ color: "var(--gold)" }}>{t.pDropHere}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            // ── Regular item (ID phase — no transKey) ─────────────────────────
            const isOther     = OTHER_KEYS.includes(item.key);
            const allOtherDocs = isOther ? getDocAll(item.key) : [];
            const doc        = isOther ? undefined : getDoc(item.key);
            const uploaded   = isOther ? allOtherDocs.length > 0 : !!doc;

            // For "other": derive aggregate status
            const otherHasRejected = allOtherDocs.some(d => d.status === "rejected");
            const otherAllApproved = allOtherDocs.length > 0 && allOtherDocs.every(d => d.status === "approved");
            const rowSt: "approved" | "rejected" | "pending" | null = !uploaded ? null
              : isOther ? (otherHasRejected ? "rejected" : otherAllApproved ? "approved" : "pending")
              : (doc!.status === "approved" ? "approved" : doc!.status === "rejected" ? "rejected" : "pending");
            const rowColor = rowSt === "approved" ? "#16a34a" : rowSt === "rejected" ? "#ef4444" : rowSt === "pending" ? "#f59e0b" : null;

            const exUrl      = DOC_EXAMPLES[item.key];
            const isUploading = uploadingKey === item.key;
            const isDragOver  = dragOverKey === item.key;
            const msg         = slotMsg?.key === item.key ? slotMsg : null;
            const fileLabel   = isOther ? "PDF / IMG / DOCX" : "PDF";

            // Whole-row click previews the doc when one is uploaded — saves
            // space vs a dedicated Eye icon. Inner buttons (Replace, Download,
            // info, hint) stop propagation so they don't accidentally trigger
            // the preview.
            // Whole-row click: previews when uploaded, opens the file picker
            // when empty (incl. multi-doc 'other' under the 5-file cap), or
            // routes to the CV builder for the CV row.
            const isCv = item.key === "cv" || item.key === "cv_de";
            const rowEmptyUpload = !uploaded && !isOther && !isCv;
            const rowEmptyOther  = isOther && allOtherDocs.length < 5;
            const rowEmptyCv     = isCv && !uploaded;
            const rowClickable =
              (!isOther && uploaded && doc?.drive_file_id && !isUploading) ||
              ((rowEmptyUpload || rowEmptyOther || rowEmptyCv) && !isUploading);
            const rowOnClick = !rowClickable
              ? undefined
              : rowEmptyCv ? () => router.push("/portal/cv-builder")
              : (!uploaded || isOther) ? () => openPicker(item.key)
              : () => handlePreview(doc!);

            return (
              <div key={item.key}>
                {idx > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOverKey(item.key); }}
                  onDragLeave={() => setDragOverKey(null)}
                  onDrop={(e) => onDrop(e, item.key)}
                  onClick={rowOnClick}
                  className={`px-2 py-3 transition-all duration-500${rowClickable ? " bv-row-hover cursor-pointer" : ""}`}
                  style={{
                    minHeight: 60,
                    ...(isDragOver ? { background: "var(--gdim)" } : null),
                  }}>

                  <div className="flex items-center gap-3">
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-[11.5px] font-medium tracking-tight" style={{ color: rowColor ?? "var(--w)" }}>{item.label}</p>
                        {/* Per-doc info button — workcert only */}
                        {item.key === "workcert" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.key === "workcert") {
                                setShowWorkGuide(true);
                              } else {
                                setDocHintOpen({ title: item.label, hint: item.hint });
                              }
                            }}
                            aria-label={t.pWhatIsThis}
                            title={t.pWhatIsThis}
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full transition-opacity hover:opacity-80"
                            style={{ background: "var(--info-bg)", color: "var(--info)", border: "none", cursor: "pointer" }}>
                            <Info size={11} strokeWidth={2.2} />
                          </button>
                        )}
                        {/* File type — borderless mono tag, quieter. Hide once
                            the doc is approved so the row reads cleanly. */}
                        {rowSt !== "approved" && (
                          <span className="text-[10px] font-mono tracking-wide" style={{ color: "var(--w3)" }}>
                            {fileLabel}
                          </span>
                        )}
                        {item.optional && (
                          <span className="text-[10px] italic" style={{ color: "var(--w3)" }}>
                            {t.pOptional}
                          </span>
                        )}
                      </div>

                      {/* Upload progress bar */}
                      {isUploading && (
                        <div className="mt-2">
                          <div className="w-full rounded-full h-1.5" style={{ background: "var(--border)" }}>
                            <div className="h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${slotProgress}%`, background: "var(--gold)" }} />
                          </div>
                          <p className="text-xs mt-1" style={{ color: "var(--w3)" }}>{slotProgress}%</p>
                        </div>
                      )}

                      {/* ── "other" key: count summary on the parent row ──
                          Each individual doc renders as its own peer-style
                          row UNDER this header (see below). The header just
                          shows how many files are uploaded so far. */}
                      {isOther && allOtherDocs.length > 0 && !isUploading && (
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>
                          {allOtherDocs.length} / 5 {lang === "de" ? "Dateien hochgeladen" : lang === "en" ? "files uploaded" : "fichier(s) téléversé(s)"}
                        </p>
                      )}

                      {/* ── Single-doc status + date (non-other) ──
                          Compact one-line meta. Status word inherits the
                          status color (no chip, no border) so it reads as
                          subtitle text rather than a heavy badge. */}
                      {!isOther && uploaded && !isUploading && (
                        <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>
                          <span className="font-semibold" style={{ color: rowColor ?? "inherit" }}>
                            {statusLabel(doc!.status ?? "pending")}
                          </span>
                          <span className="mx-1.5">·</span>
                          {fmtDate(doc!.uploaded_at)}
                        </p>
                      )}

                      {/* Rejection panel (non-other) — structured "What to fix" with re-upload CTA.
                          Also shown when passport data (passport_status) was rejected — candidate
                          must re-upload the full passport. */}
                      {!isOther && uploaded && (doc!.status === "rejected" || (item.key === "id" && passportStatus === "rejected")) && (
                        <div className="mt-2.5 overflow-hidden"
                          style={{
                            background: "var(--danger-bg)",
                            border: "1px solid var(--danger-bg)",
                            borderLeft: "3px solid var(--danger)",
                            borderRadius: "var(--r-md)",
                          }}>
                          <div className="px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] inline-flex items-center gap-1.5 mb-1.5"
                              style={{ color: "var(--danger)" }}>
                              <AlertTriangle size={11} strokeWidth={1.8} />
                              {lang === "fr" ? "Action requise" : lang === "de" ? "Aktion erforderlich" : "Action needed"}
                            </p>
                            <p className="text-[12.5px] font-semibold tracking-tight mb-2" style={{ color: "var(--w)" }}>
                              {lang === "fr" ? "Document à renvoyer" : lang === "de" ? "Dokument muss neu hochgeladen werden" : "Re-upload required"}
                            </p>
                            {doc!.feedback && (
                              <p className="text-[12px] leading-relaxed mb-3 pl-2.5"
                                style={{ color: "var(--w2)", borderLeft: "2px solid var(--danger-bg)" }}>
                                {doc!.feedback}
                              </p>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); openPicker(item.key); }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-semibold tracking-tight transition-opacity hover:opacity-90"
                              style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-sm)", boxShadow: "var(--shadow-sm)" }}>
                              <Upload size={12} strokeWidth={1.8} />
                              {lang === "fr" ? "Renvoyer le document" : lang === "de" ? "Neu hochladen" : "Re-upload"}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Slot message */}
                      {msg && (
                        <p className="mt-1.5 text-xs" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>
                          {msg.type === "success" ? t.pUploadSuccess.replace("{label}", ALL_ITEMS.find(i => i.key === msg.key)?.label ?? "") :
                           msg.type === "errPdfOnly" ? t.pErrPdfOnly :
                           msg.type === "errAllTypes" ? t.pErrAllTypes :
                           msg.type === "errSize" ? t.pErrSize.replace("{size}", String(MAX_MB)) :
                           msg.type === "errNetwork" ? t.pErrNetwork :
                           msg.type === "errDownload" ? (lang === "fr" ? "Échec du téléchargement — réessayez." : lang === "de" ? "Herunterladen fehlgeschlagen — erneut versuchen." : "Download failed — please try again.") :
                           t.pErrUpload}
                        </p>
                      )}

                      {/* Drag hint */}
                      {isDragOver && (
                        <p className="text-xs mt-1" style={{ color: "var(--gold)" }}>{t.pDropHere}</p>
                      )}
                    </div>

                    {/* Right buttons — preview is now triggered by clicking
                        the whole row (cleaner, fewer icons). When uploaded
                        you only see [Replace] and [Download] side by side. */}
                    {!isUploading && (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Helpers (Example, CV builder) — only useful before
                            upload. Hide once a doc is in the slot. */}
                        {!uploaded && exUrl && (
                          <button onClick={(e) => { e.stopPropagation(); setExampleUrl(exUrl); }}
                            className="bv-row-hover text-xs px-2.5 py-1.5"
                            style={{ color: "var(--gold)" }}>
                            {t.pExampleBtn}
                          </button>
                        )}
                        {/* CV slots: candidates MUST use the builder so every
                            CV follows our format. No upload option, just the
                            primary "Build my CV" CTA in gold. */}
                        {!uploaded && (item.key === "cv" || item.key === "cv_de") && (
                          <span
                            aria-hidden="true"
                            className="inline-flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
                            style={{ color: "var(--gold)" }}>
                            <Sparkles size={13} strokeWidth={1.8} />
                          </span>
                        )}

                        {/* Empty state → decorative upload icon. The whole row
                            is the click target, so the icon stays purely visual
                            (no button hover bg). */}
                        {!uploaded && !isOther && item.key !== "cv" && item.key !== "cv_de" && (
                          <span
                            aria-hidden="true"
                            className="inline-flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
                            style={{ color: "var(--gold)" }}>
                            <Upload size={13} strokeWidth={1.8} />
                          </span>
                        )}

                        {/* "other" key — same decorative icon; the row body
                            triggers the picker. */}
                        {isOther && allOtherDocs.length < 5 && (
                          <span
                            aria-hidden="true"
                            className="inline-flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
                            style={{ color: "var(--gold)" }}>
                            <Upload size={13} strokeWidth={1.8} />
                          </span>
                        )}

                        {/* Uploaded (single-doc, non-other): just two borderless
                            icons — Replace on the left, Download on the right.
                            Hover state: a soft circular pill fades in behind
                            the icon + the icon scales up to 1.18 so the user
                            can clearly see which one is targeted. Click =
                            press-down (scale 0.92). Preview is the whole-row
                            click handler. */}
                        {!isOther && uploaded && doc?.drive_file_id && doc.status !== "approved" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              // CVs must be rebuilt via the builder — never
                              // replaced with an arbitrary upload, so we
                              // route to /portal/cv-builder instead of
                              // opening the file picker.
                              if (item.key === "cv" || item.key === "cv_de") {
                                window.open("/portal/cv-builder", "_blank");
                              } else {
                                openPicker(item.key);
                              }
                            }}
                            aria-label={t.pReplaceBtn}
                            title={t.pReplaceBtn}
                            className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                            style={{ color: "var(--w2)" }}>
                            <RefreshCw size={15} strokeWidth={1.8} />
                          </button>
                        )}
                        {!isOther && uploaded && doc?.drive_file_id && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(doc!.drive_file_id!, doc!.file_name, item.key);
                            }}
                            aria-label={lang === "fr" ? "Télécharger" : lang === "de" ? "Herunterladen" : "Download"}
                            title={lang === "fr" ? "Télécharger" : lang === "de" ? "Herunterladen" : "Download"}
                            className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                            style={{ color: "var(--w2)" }}>
                            <Download size={15} strokeWidth={1.8} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {/* ── Child rows for the "other" multi-doc slot ──
                    Each uploaded file is rendered as a self-contained rounded
                    card (same nested look the admin panel uses), indented
                    slightly so the parent-child relationship reads at a glance.
                    Whole-card click previews; Replace + Download icons live
                    on the right and ALWAYS show (download is permanent like
                    the peer doc rows). */}
                {isOther && allOtherDocs.length > 0 && (
                  <div className="px-2 pb-3 pt-1 space-y-2">
                    {allOtherDocs.map(d => {
                      const dStatus = d.status ?? "pending";
                      const dsc = statusColor(dStatus);
                      const sym = dStatus === "approved" ? <CheckCircle2 size={14} strokeWidth={1.8} />
                                : dStatus === "rejected" ? <XCircle size={14} strokeWidth={1.8} />
                                :                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />;
                      const isClickable = !!d.drive_file_id;
                      return (
                        <div key={`${item.key}_${d.id}`}
                          onClick={isClickable ? () => handlePreview(d) : undefined}
                          className={`rounded-xl px-3 py-2.5 transition-colors${isClickable ? " bv-row-hover cursor-pointer" : ""}`}
                          style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                              style={{ background: dsc.bg, color: dsc.text, border: `1px solid ${dsc.border}` }}>
                              {sym}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold tracking-tight truncate" style={{ color: "var(--w)" }}>
                                {d.file_name}
                              </p>
                              <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>
                                <span className="font-semibold" style={{ color: dsc.text }}>
                                  {statusLabel(dStatus)}
                                </span>
                                <span className="mx-1.5">·</span>
                                {fmtDate(d.uploaded_at)}
                              </p>
                            </div>
                            {/* Action buttons — always present, just like top-level peer rows */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {/* Replace (delete + open picker) — only when not approved */}
                              {isClickable && dStatus !== "approved" && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Issue 13.1 fix: store the old doc id AND
                                    // the slot key. The old doc is deleted ONLY
                                    // after the new upload to THIS slot succeeds.
                                    // Storing the key prevents a stale ref from
                                    // deleting the doc if the user cancels and
                                    // then uploads to a different slot.
                                    replaceDocIdRef.current  = d.id;
                                    replaceForKeyRef.current = item.key;
                                    openPicker(item.key);
                                  }}
                                  aria-label={t.pReplaceBtn} title={t.pReplaceBtn}
                                  className="bv-icon-btn w-8 h-8 flex items-center justify-center rounded-full"
                                  style={{ color: "var(--w2)" }}>
                                  <RefreshCw size={13} strokeWidth={1.8} />
                                </button>
                              )}
                              {/* Download — always shown */}
                              {isClickable && (
                                <button onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownload(d.drive_file_id!, d.file_name, item.key);
                                  }}
                                  aria-label={lang === "fr" ? "Télécharger" : lang === "de" ? "Herunterladen" : "Download"}
                                  title={lang === "fr" ? "Télécharger" : lang === "de" ? "Herunterladen" : "Download"}
                                  className="bv-icon-btn w-8 h-8 flex items-center justify-center rounded-full"
                                  style={{ color: "var(--w2)" }}>
                                  <Download size={13} strokeWidth={1.8} />
                                </button>
                              )}
                            </div>
                          </div>
                          {dStatus === "rejected" && d.feedback && (
                            <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: "var(--danger)" }}>
                              “{d.feedback}”
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
              </div>
            </div>


        {/* Navigation — Back + Next only */}
        <div className="flex gap-3">
          {phase > 0 && (
            <button onClick={goPrevPhase}
              className="bv-row-hover py-3 px-5 font-semibold text-sm flex items-center gap-2 flex-shrink-0"
              style={{ color: "var(--w2)" }}>
              ← {t.backLabel}
            </button>
          )}
          {phase === PHASES.length - 1 ? (
            pipeline?.docs_approved ? (
              <button
                onClick={() => { setViewMode("interview"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                className="flex-1 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90"
                style={{ background: "var(--success)", color: "#fff" }}>
                {t.pWizardNext}
              </button>
            ) : (
              <div className="flex-1 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 select-none"
                style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)", cursor: "not-allowed" }}>
                <Lock size={14} strokeWidth={1.8} /> {t.pWizardNext}
              </div>
            )
          ) : (
            <button onClick={goNextPhase}
              className="flex-1 py-3 font-semibold text-[13.5px] tracking-tight transition-opacity hover:opacity-90"
              style={{
                background: phaseComplete ? "var(--success)" : "var(--gold)",
                color: "#131312",
                borderRadius: "var(--r-md)",
                boxShadow: "var(--shadow-sm)",
              }}>
              {t.pWizardNext}
            </button>
          )}
        </div>
        </div> /* end viewMode === "docs" */}

        <p className="mt-10 text-xs text-center" style={{ color: "var(--w3)" }}>
          {t.pContact}{" "}
          <a href="mailto:contact@borivon.com" className="underline underline-offset-4" style={{ color: "var(--gold)" }}>
            contact@borivon.com
          </a>
        </p>

          </div>{/* end flex-1 min-w-0 */}
        </div>{/* end flex gap-4 row */}
      </div>{/* end max-w-[780px] container */}

      <input ref={fileInputRef} type="file" className="hidden"
        accept={
          activeKey && OTHER_KEYS.includes(activeKey) ? ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" :
          activeKey && ID_KEYS.includes(activeKey)    ? ".pdf,.jpg,.jpeg,.png,.webp" :
          ".pdf"
        }
        onChange={onFileChange} />

      {/* "What is this?" popup — hint/label resolved live from t so they update with language */}
      {tipPopup && (() => {
        const popItem = ALL_ITEMS.find(i => i.key === tipPopup.itemKey);
        if (!popItem) return null;
        return (
          <div className="fixed inset-x-0 bottom-0 z-[820] flex items-center justify-center p-4 bv-modal-outer"
            style={{ top: "calc(58px + var(--bv-subnav-h, 0px))", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
            onClick={() => setTipPopup(null)}>
            <div className="w-full max-w-sm overflow-hidden"
              style={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
                animation: "bvFadeRise .28s var(--ease-out)",
              }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4"
                style={{ borderBottom: "1px solid var(--border)" }}>
                <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{popItem.label}</p>
                <button onClick={() => setTipPopup(null)}
                  className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center text-xs"
                  style={{ color: "var(--w3)" }}><XIcon size={13} strokeWidth={1.8} /></button>
              </div>
              <div className="px-5 py-4 space-y-3">
                {popItem.hint && (
                  <p className="text-sm leading-relaxed" style={{ color: "var(--w2)" }}>{popItem.hint}</p>
                )}
                {tipPopup.isWorkCert && (
                  <button onClick={() => { setTipPopup(null); setShowWorkGuide(true); }}
                    className="bv-row-hover text-xs px-3 py-1.5"
                    style={{ color: "var(--info)" }}>
                    {t.pGuideBtn}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Passport confirmation modal ─────────────────────────────────────── */}
      {passportModal && (() => {
        const isPassportApproved = passportStatus === "approved";
        const isPassportPending  = passportStatus === "pending";
        // Compute whether all filled fields have been confirmed by the user
        const _allFieldKeys: (keyof PassportData)[] = [
          "last_name","first_name","dob","sex","nationality","city_of_birth","country_of_birth",
          "passport_no","issue_date","passport_expiry","issuing_authority",
          "address_street","address_number","address_postal","city_of_residence","country_of_residence",
        ];
        const _isFilled = (k: keyof PassportData) => {
          const v = passportModal[k]; return !!(v && v !== "—" && v.trim() !== "");
        };
        const allConfirmed = _allFieldKeys.filter(_isFilled).every(k => confirmedFields.has(k));
        // Side-by-side rule: when this modal is open WHILE the doc preview
        // is showing an unapproved passport, dock to the right half on
        // laptop and to the bottom half on phone (so passport is above,
        // data below — never overlapping).
        // Dock to the side only during first-time submission (no status yet).
        const splitWithPreview = !!previewDoc
          && /pass/i.test(previewDoc.file_type)
          && !passportStatus;
        return (
        <div className={`fixed inset-x-0 z-[750] flex justify-center p-4 bv-passport-modal-outer ${splitWithPreview ? "bv-side-data-cand" : "items-center"}`}
          style={{
            // Reserve clearance for the navbar (58px) AND the sub-nav strip
            // (Tableau de bord / Communauté tabs) so the modal isn't half-
            // hidden under the chrome. Bottom: leave a small gap on desktop.
            top: splitWithPreview ? undefined : "calc(58px + var(--bv-subnav-h, 0px))",
            bottom: splitWithPreview ? undefined : "0",
            background: splitWithPreview ? "transparent" : "rgba(0,0,0,0.45)",
            backdropFilter: splitWithPreview ? undefined : "blur(8px)",
            pointerEvents: splitWithPreview ? "none" : "auto",
          }}
          onClick={!splitWithPreview ? (e) => { if (e.target === e.currentTarget) setPassportModal(null); } : undefined}>
          {/* Phone: leave clearance for the bottom action bar so the modal
              never slides behind it. Laptop: the top + bottom inline above
              already creates the gap. */}
          <style>{`
            @media (max-width: 639.98px) {
              .bv-passport-modal-outer { padding-bottom: calc(1rem + 72px) !important; }
              .bv-passport-modal-card  {
                max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 1rem - 72px - 1rem) !important;
              }
              .bv-side-data-cand {
                top: calc(58px + var(--bv-subnav-h, 0px) + 50dvh - 0.25rem) !important;
                bottom: 0 !important;
                padding-top: 0.25rem !important;
                align-items: center !important;
              }
              .bv-side-data-cand .bv-passport-modal-card {
                max-height: 100% !important;
              }
            }
            @media (min-width: 640px) {
              .bv-passport-modal-card {
                /* Desktop: keep the card tall enough to be useful but
                   short enough to leave a visible gap above and below. */
                max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 2rem) !important;
              }
              .bv-side-data-cand {
                top: calc(58px + var(--bv-subnav-h, 0px));
                bottom: 0;
                align-items: center;
                justify-content: flex-start !important;
                padding-left: 50vw;
                padding-right: 1rem;
              }
            }
          `}</style>
          <div className={`bv-passport-modal-card w-full flex flex-col ${splitWithPreview ? "sm:max-w-[440px]" : "max-w-lg"}`}
            style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
              animation: "bvFadeRise .28s var(--ease-out)",
              pointerEvents: "auto",
            }}>
            {/* Header */}
            <div className="px-5 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] inline-flex items-center gap-1.5 mb-1" style={{ color: "var(--gold)" }}>
                    <IdCard size={12} strokeWidth={1.8} />
                    {t.pPassportTitle}
                  </p>
                  <p className="text-[12.5px]" style={{ color: "var(--w3)" }}>{t.pPassportSubtitle}</p>
                </div>
                {isPassportApproved ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
                      <CheckCircle2 size={11} strokeWidth={1.8} /> {lang === "de" ? "Genehmigt" : lang === "fr" ? "Approuvé" : "Approved"}
                    </span>
                    <button onClick={() => setPassportModal(null)}
                      className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full"
                      style={{ color: "var(--w3)" }}>
                      <XIcon size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                ) : isPassportPending ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                      {lang === "de" ? "In Prüfung" : lang === "fr" ? "En attente" : "Pending review"}
                    </span>
                    <button onClick={() => setPassportModal(null)}
                      className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full"
                      style={{ color: "var(--w3)" }}>
                      <XIcon size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                ) : (
                  <AutosaveIndicator savedAt={passportSavedAt} error={passportSaveError} className="flex-shrink-0 mt-0.5" />
                )}
              </div>
            </div>
            {/* Fields — 2-column grid, scrollable */}
            <div className="px-5 py-4 overflow-y-auto flex-1">
              {(() => {
                // Country names in current language (for country_of_birth / country_of_residence)
                const countryOpts = [{ v: "", l: "—" }, ...Object.entries(NAT_MAP).map(([iso, n]) => ({ v: iso, l: n[lang] })).sort((a,b) => a.l.localeCompare(b.l))];
                // Nationality dropdown shows German adjective (Staatsangehörigkeit is always in German)
                const natOpts = [{ v: "", l: "—" }, ...Object.entries(NAT_MAP).map(([iso, n]) => ({ v: iso, l: n[lang] })).sort((a,b) => a.l.localeCompare(b.l))];
                const sexOpts = [{ v: "", l: "—" }, { v: "M", l: "M" }, { v: lang === "de" ? "W" : "F", l: lang === "de" ? "W" : "F" }];
                const fields: { key: keyof PassportData; label: string; type?: string; opts?: {v:string;l:string}[]; wide?: boolean; manual?: boolean; optional?: boolean; numericOnly?: boolean; wordsOnly?: boolean; uppercase?: boolean }[] = [
                  { key: "last_name",         label: t.pFieldLastName,         uppercase: true },
                  { key: "first_name",        label: t.pFieldFirstName,        uppercase: true },
                  { key: "dob",               label: t.pFieldDob,     type: "text" },
                  { key: "sex",               label: t.pFieldSex,     type: "select", opts: sexOpts },
                  { key: "nationality",       label: t.pFieldNationality, type: "select", opts: natOpts },
                  { key: "city_of_birth",     label: t.pFieldCityOfBirth,      uppercase: true },
                  { key: "country_of_birth",  label: t.pFieldCountryOfBirth, type: "select", opts: countryOpts },
                  { key: "passport_no",       label: t.pFieldPassportNo,       uppercase: true },
                  { key: "issue_date",        label: t.pFieldIssueDate,       type: "text" },
                  { key: "passport_expiry",   label: t.pFieldExpiry,          type: "text" },
                  { key: "issuing_authority", label: t.pFieldIssuingAuthority, wide: true, optional: true, uppercase: true },
                  { key: "address_street",    label: t.pFieldAddressStreet,    wide: true, manual: true, uppercase: true },
                  { key: "address_number",    label: t.pFieldAddressNumber,    manual: true, optional: true, numericOnly: true },
                  { key: "address_postal",    label: t.pFieldAddressPostal,    manual: true, numericOnly: true },
                  { key: "city_of_residence",     label: t.pFieldCityOfResidence,     manual: true, wordsOnly: true, uppercase: true },
                  { key: "country_of_residence",  label: t.pFieldCountryOfResidence,  type: "select", opts: countryOpts, manual: true },
                ];

                // ── Empty / missing ───────────────────────────────────────────────
                const isEmpty = (f: typeof fields[0]) => !passportModal[f.key] || passportModal[f.key] === "—" || passportModal[f.key].trim() === "";
                const missingKeys = new Set(fields.filter(isEmpty).map(f => f.key));
                const hasAnyMissing = missingKeys.size > 0;

                // ── Suspicious (filled but likely wrong) ─────────────────────────
                const suspiciousKeys = new Set<keyof PassportData>();
                const suspiciousHints: Partial<Record<keyof PassportData, string>> = {};
                fields.forEach(f => {
                  const v = passportModal[f.key];
                  if (!v || v === "—" || v.trim() === "") return; // handled by missing
                  if (f.key === "address_postal" && !/^\d{5}$/.test(v.trim())) {
                    suspiciousKeys.add(f.key);
                    suspiciousHints[f.key] = t.dValMust5;
                  }
                  if (f.wordsOnly) {
                    if (/\d/.test(v)) {
                      // Issue 6.3: only flag digits-in-name, never flag cities by whitelist
                      // (non-Moroccan candidates have perfectly valid non-Moroccan cities)
                      suspiciousKeys.add(f.key); suspiciousHints[f.key] = t.dValLettersOnly;
                    }
                  }
                });

                const inputCls = "w-full rounded-lg px-2.5 py-1.5 text-xs outline-none";
                const labelStyle = { color: "var(--w3)" };

                // SVG checkmark icons
                const IconEmpty = (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="1" width="14" height="14" rx="3" stroke="var(--border2)" strokeWidth="1.5"/>
                  </svg>
                );
                const IconUnchecked = (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="1" width="14" height="14" rx="3" stroke="var(--warning)" strokeWidth="1.5"/>
                    <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="var(--warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.35"/>
                  </svg>
                );
                const IconChecked = (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect width="16" height="16" rx="3.5" fill="var(--success)"/>
                    <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                );

                // ── Read-only view (approved or pending) ─────────────────────────
                if (isPassportApproved || isPassportPending) {
                  const fmtPassDate = (v: string) => {
                    if (!v || v === "—") return "—";
                    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                    return m ? `${m[3]}.${m[2]}.${m[1]}` : v;
                  };
                  const fmtCountry = (v: string) =>
                    (!v || v === "—") ? "—" : (natToLangShared(v, lang as "fr"|"en"|"de") || v);
                  const fmtSex = (v: string) => {
                    if (!v || v === "—") return "—";
                    if (v === "M") return lang === "de" ? "Männlich" : lang === "fr" ? "Masculin" : "Male";
                    if (v === "F" || v === "W") return lang === "de" ? "Weiblich" : lang === "fr" ? "Féminin" : "Female";
                    return v;
                  };
                  const displayVal = (f: typeof fields[0]): string => {
                    const v = passportModal[f.key] ?? "";
                    if (!v || v === "—" || v.trim() === "") return "—";
                    if (f.key === "nationality" || f.key === "country_of_birth" || f.key === "country_of_residence") return fmtCountry(v);
                    if (f.key === "dob" || f.key === "issue_date" || f.key === "passport_expiry") return fmtPassDate(v);
                    if (f.key === "sex") return fmtSex(v);
                    return v;
                  };
                  return (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {fields.map(f => {
                        const display = displayVal(f);
                        return (
                          <div key={f.key} className={f.wide ? "col-span-2" : ""}>
                            <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] mb-0.5" style={{ color: "var(--w3)" }}>{f.label}</p>
                            <p className="text-[12.5px] font-medium" style={{ color: display === "—" ? "var(--w3)" : "var(--w)" }}>{display}</p>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                return (
                  <>
                    {/* ── Always-visible orange review note ───────────────── */}
                    <div className="mb-3 px-1 space-y-1">
                      <p className="text-[10px]" style={{ color: "var(--warning)" }}>
                        {t.pPassportReviewNote}
                      </p>
                      <div className="flex items-center gap-1.5">
                        {/* Visual: reuse exact same icons as the form checkboxes */}
                        {IconUnchecked}
                        <span style={{ color: "#aaa", fontSize: 9 }}>→</span>
                        {IconChecked}
                        <p className="text-[10px]" style={{ color: "var(--warning)" }}>
                          {t.pPassportReviewNote2}
                        </p>
                      </div>
                    </div>
                    {/* ── Field grid ──────────────────────────────────────── */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    {fields.map(f => {
                      const missing    = missingKeys.has(f.key);
                      const suspicious = !missing && suspiciousKeys.has(f.key);
                      const borderColor = missing ? "var(--danger)" : suspicious ? "var(--warning)" : "var(--border2)";
                      const inputStyle = { background: "var(--bg2)", border: `1px solid ${borderColor}`, color: "var(--w)" };
                      const filled     = !missing;
                      // address_number is optional — allow confirming even when empty
                      const canConfirm = filled || f.key === "address_number";
                      const confirmed  = confirmedFields.has(f.key);
                      return (
                      <div key={f.key} className={f.wide ? "col-span-2" : ""}>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-medium" style={labelStyle}>
                            {f.label}
                            <span className="ml-1" style={{ color: "var(--danger)" }}>*</span>
                            {f.manual && <FilePen size={10} strokeWidth={1.8} className="inline ml-1 opacity-40" />}
                          </label>
                          {f.key === "issuing_authority" && (
                            <button type="button"
                              onClick={() => setPassportHint("issuing_authority")}
                              className="text-[9px] underline underline-offset-2 transition-opacity hover:opacity-70 flex-shrink-0"
                              style={{ color: "var(--info)" }}>
                              {t.pWhatIsThis}
                            </button>
                          )}
                          {f.key === "address_street" && (
                            <button type="button"
                              onClick={() => setPassportHint("address_street")}
                              className="text-[9px] underline underline-offset-2 transition-opacity hover:opacity-70 flex-shrink-0"
                              style={{ color: "var(--info)" }}>
                              {t.pAddrHintBtn}
                            </button>
                          )}
                          {f.key === "address_postal" && (
                            <button type="button"
                              onClick={() => setPassportHint("address_postal")}
                              className="text-[9px] underline underline-offset-2 transition-opacity hover:opacity-70 flex-shrink-0"
                              style={{ color: "var(--info)" }}>
                              {t.pPostalHintBtn}
                            </button>
                          )}
                        </div>
                        <div className="relative">
                          {f.type === "select" ? (
                            <select value={passportModal[f.key]}
                              onChange={e => {
                                setPassportModal(p => p ? { ...p, [f.key]: e.target.value } : p);
                                setConfirmedFields(prev => { const n = new Set(prev); n.delete(f.key); return n; });
                              }}
                              className={inputCls + " pr-7 appearance-none"}
                              style={inputStyle}>
                              {f.opts!.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                          ) : (
                            <input type={f.type ?? "text"} value={passportModal[f.key]}
                              onChange={e => {
                                let val = e.target.value;
                                if (f.numericOnly) val = val.replace(/\D/g, "");
                                if (f.wordsOnly)   val = val.replace(/[^A-Za-zÀ-ÿ\s'-]/g, "");
                                if (f.uppercase)   val = val.toUpperCase();
                                setPassportModal(p => p ? { ...p, [f.key]: val } : p);
                                setConfirmedFields(prev => { const n = new Set(prev); n.delete(f.key); return n; });
                              }}
                              onFocus={() => {
                                if (f.key === "address_street" && !addressHintShown.current) {
                                  addressHintShown.current = true;
                                  setPassportHint("address_street");
                                }

                                if (f.key === "issuing_authority" && !authorityHintShown.current) {
                                  authorityHintShown.current = true;
                                  setPassportHint("issuing_authority");
                                }
                              }}
                              className={inputCls + " pr-7"} style={{ ...inputStyle, ...(f.uppercase ? { textTransform: "uppercase" } : {}) }}
                              inputMode={(f.numericOnly || f.key === "dob" || f.key === "issue_date" || f.key === "passport_expiry") ? "numeric" : undefined} />
                          )}
                          {/* Checkmark icon inside the field on the right */}
                          <button type="button"
                            onClick={e => {
                              e.stopPropagation();
                              if (!canConfirm) return;
                              // For hint-gated fields: show popup on first checkbox tap instead of confirming
                              const hintRef =
                                f.key === "address_street"    ? addressHintShown :

                                f.key === "issuing_authority" ? authorityHintShown : null;
                              if (hintRef && !hintRef.current) {
                                hintRef.current = true;
                                setPassportHint(f.key as keyof PassportData);
                                return; // don't confirm yet — user sees popup first
                              }
                              setConfirmedFields(prev => {
                                const next = new Set(prev);
                                if (next.has(f.key)) next.delete(f.key); else next.add(f.key);
                                return next;
                              });
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 transition-all"
                            style={{ cursor: canConfirm ? "pointer" : "default" }}
                            title={!canConfirm ? t.dTipFillFirst : confirmed ? t.dTipConfirmedUndo : t.dTipClickConfirm}>
                            {!canConfirm ? IconEmpty : confirmed ? IconChecked : IconUnchecked}
                          </button>
                        </div>
                        {suspicious && suspiciousHints[f.key] && (
                          <p className="text-[9px] mt-0.5 inline-flex items-center gap-1" style={{ color: "var(--warning)" }}><AlertTriangle size={9} strokeWidth={1.8} />{suspiciousHints[f.key]}</p>
                        )}
                      </div>
                      );
                    })}
                    </div>
                  </>
                );
              })()}
            </div>
            {/* Action */}
            <div className="px-5 pb-4 pt-3 flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
              {isPassportApproved ? (
                <button
                  onClick={async () => {
                    try {
                      // Build groups from the exact values currently displayed
                      const pm = passportModal!;
                      const raw = (key: keyof PassportData) => pm[key] ?? "";
                      const nat = (v: string) => natToLangShared(v, lang as "fr"|"en"|"de") || v || "—";
                      const sex = raw("sex") === "M" ? (lang==="fr"?"Masculin":lang==="de"?"Männlich":"Male")
                                : raw("sex") === "F" || raw("sex") === "W" ? (lang==="fr"?"Féminin":lang==="de"?"Weiblich":"Female")
                                : (raw("sex") || "—");
                      const fv = (key: keyof PassportData) => raw(key) || "—";
                      const G = lang === "fr"
                        ? { personal:"Personnel", passport:"Passeport", address:"Adresse",
                            ln:"Nom de famille", fn:"Prénom", dob:"Date de naissance", sex:"Sexe",
                            nat:"Nationalité", cob:"Ville de naissance", cntob:"Pays de naissance",
                            pno:"N° passeport", isd:"Date d'émission", exp:"Date d'expiration", iss:"Autorité émettrice",
                            str:"Rue", num:"N°", post:"Code postal", cres:"Ville de résidence", cntres:"Pays de résidence" }
                        : lang === "de"
                        ? { personal:"Persönlich", passport:"Reisepass", address:"Adresse",
                            ln:"Nachname", fn:"Vorname", dob:"Geburtsdatum", sex:"Geschlecht",
                            nat:"Staatsangehörigkeit", cob:"Geburtsort", cntob:"Geburtsland",
                            pno:"Reisepassnummer", isd:"Ausstellungsdatum", exp:"Ablaufdatum", iss:"Ausstellungsbehörde",
                            str:"Straße", num:"Hausnummer", post:"Postleitzahl", cres:"Wohnort", cntres:"Wohnland" }
                        : { personal:"Personal", passport:"Passport", address:"Address",
                            ln:"Last name", fn:"First name", dob:"Date of birth", sex:"Sex",
                            nat:"Nationality", cob:"City of birth", cntob:"Country of birth",
                            pno:"Passport No", isd:"Issue date", exp:"Expiry", iss:"Issuing authority",
                            str:"Street", num:"Number", post:"Postal code", cres:"City of residence", cntres:"Country of residence" };
                      const pdfGroups = [
                        { title: G.personal, fields: [
                          { label: G.ln,    value: fv("last_name") },
                          { label: G.fn,    value: fv("first_name") },
                          { label: G.dob,   value: fv("dob") },
                          { label: G.sex,   value: sex },
                          { label: G.nat,   value: nat(raw("nationality")) },
                          { label: G.cob,   value: fv("city_of_birth") },
                          { label: G.cntob, value: nat(raw("country_of_birth")) },
                        ]},
                        { title: G.passport, fields: [
                          { label: G.pno, value: fv("passport_no") },
                          { label: G.isd, value: fv("issue_date") },
                          { label: G.exp, value: fv("passport_expiry") },
                          { label: G.iss, value: fv("issuing_authority") },
                        ]},
                        { title: G.address, fields: [
                          { label: G.str,    value: fv("address_street") },
                          { label: G.num,    value: fv("address_number") },
                          { label: G.post,   value: fv("address_postal") },
                          { label: G.cres,   value: fv("city_of_residence") },
                          { label: G.cntres, value: nat(raw("country_of_residence")) },
                        ]},
                      ];
                      const docTitle = lang === "fr" ? "Données du passeport" : lang === "de" ? "Reisepassdaten" : "Passport Data";
                      const docSubtitle = lang === "fr" ? "Informations de passeport extraites et confirmées" : lang === "de" ? "Extrahierte und bestätigte Reisepassdaten" : "Extracted and confirmed passport information";
                      const fn = [passportModal?.first_name, passportModal?.last_name].filter(Boolean).join("_").toLowerCase() || "passport_data";
                      const res = await fetch("/api/portal/me/passport-data-pdf", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
                        body: JSON.stringify({ groups: pdfGroups, filename: `${fn}_passport_data.pdf`, docTitle, docSubtitle }),
                      });
                      if (!res.ok) { alert(t.dErrPdfGen); return; }
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = `${fn}_passport_data.pdf`; a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 0);
                    } catch { alert(t.dErrDownload); }
                  }}
                  className="w-full py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                  style={{ background: "var(--gold)", color: "#131312" }}>
                  <Download size={14} strokeWidth={1.8} />
                  {lang === "fr" ? "Télécharger les données" : lang === "de" ? "Daten herunterladen" : "Download data"}
                </button>
              ) : isPassportPending ? (
                <p className="text-[11.5px] py-2 text-center font-medium" style={{ color: "var(--gold)" }}>
                  {lang === "de" ? "Eingereicht — wird geprüft" : lang === "fr" ? "Soumis — en cours de vérification" : "Submitted — under review"}
                </p>
              ) : (
                <>
                  {allConfirmed && (
                    <p className="text-[10px] mb-2.5 py-1.5 rounded-lg font-medium text-center" style={{ color: "var(--success)", background: "var(--success-bg)", border: "1px solid var(--success-border)" }}>
                      {t.pPassportThanks}
                    </p>
                  )}
                  <button
                    disabled={passportSaving || !allConfirmed}
                    onClick={async () => {
                      setPassportSaving(true);
                      try {
                        const res = await fetch("/api/portal/passport", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
                          body: JSON.stringify(passportModal),
                        });
                        if (!res.ok) {
                          const err = await res.json().catch(() => ({}));
                          setPassportSaving(false);
                          alert(err.error ?? t.dErrPassportSave);
                          return;
                        }
                      } catch {
                        setPassportSaving(false);
                        alert(t.dErrNetwork);
                        return;
                      }
                      setPassportSaving(false);
                      setPassportModal(null);
                      addressHintShown.current = false;
                      postalHintShown.current = false;
                      authorityHintShown.current = false;
                      // Button turns yellow immediately after submission
                      setPassportStatus("pending");
                    }}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: "var(--gold)", color: "#131312" }}>
                    {passportSaving ? "…" : allConfirmed
                      ? (lang === "fr" ? "Envoyer" : lang === "de" ? "Absenden" : "Submit")
                      : t.pPassportConfirm}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* Passport field hint — issuing authority */}
      {passportHint === "issuing_authority" && (
        <div className="fixed inset-x-0 bottom-0 z-[820] flex items-center justify-center p-4 bv-modal-outer"
          style={{ top: "calc(58px + var(--bv-subnav-h, 0px))", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setPassportHint(null)}>
          <div className="w-full max-w-md overflow-hidden"
            style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
              animation: "bvFadeRise .28s var(--ease-out)",
            }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                {lang === "fr" ? "Autorité de délivrance" : lang === "de" ? "Ausstellende Behörde" : "Issuing Authority"}
              </p>
              <button onClick={() => setPassportHint(null)}
                className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center text-xs"
                style={{ color: "var(--w3)" }}><XIcon size={13} strokeWidth={1.8} /></button>
            </div>
            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm leading-relaxed" style={{ color: "var(--w2)" }}>
                {lang === "fr"
                  ? `Regardez en bas à droite de votre passeport, sous « Autorité / Authority ».`
                  : lang === "de"
                  ? `Schauen Sie unten rechts im Reisepass unter « Autorité / Authority ».`
                  : `Look at the bottom-right of your passport, under « Autorité / Authority ».`}
              </p>
              {/* Passport example image with red box highlight */}
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                <img
                  src="/passport-authority-guide.jpg.png"
                  alt="Passport authority example"
                  className="w-full object-cover"
                />
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--w2)" }}>
                {lang === "fr" ? "Écrivez le texte complet — ne raccourcissez pas :"
                  : lang === "de" ? "Schreiben Sie den vollständigen Text — nicht kürzen:"
                  : "Write the full text — do not shorten it:"}
              </p>
              <div className="space-y-2">
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-border)" }}>
                  <XCircle size={16} strokeWidth={1.8} className="flex-shrink-0" style={{ color: "var(--danger)" }} />
                  <span className="text-sm font-mono" style={{ color: "var(--danger)" }}>Laayoune</span>
                </div>
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{ background: "var(--success-bg)", border: "1px solid var(--success-border)" }}>
                  <CheckCircle2 size={16} strokeWidth={1.8} className="flex-shrink-0" style={{ color: "var(--success)" }} />
                  <span className="text-sm font-mono" style={{ color: "var(--success)" }}>Province de Laayoune</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Passport field hint — address */}
      {passportHint === "address_street" && (
        <div className="fixed inset-x-0 bottom-0 z-[820] flex items-center justify-center p-4 bv-modal-outer"
          style={{ top: "calc(58px + var(--bv-subnav-h, 0px))", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setPassportHint(null)}>
          <div className="w-full max-w-md overflow-hidden flex flex-col"
            style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
              maxHeight: "88vh", animation: "bvFadeRise .28s var(--ease-out)",
            }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                {lang === "fr" ? "Comment écrire votre adresse" : lang === "de" ? "Wie Sie Ihre Adresse eintragen" : "How to write your address"}
              </p>
              <button onClick={() => setPassportHint(null)}
                className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center text-xs"
                style={{ color: "var(--w3)" }}><XIcon size={13} strokeWidth={1.8} /></button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto px-4 py-4 space-y-3">

              {/* ── STEP 1 — Language ─────────────────────────────── */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: "var(--info)", color: "#fff" }}>1</span>
                  <p className="text-xs font-semibold" style={{ color: "var(--w)" }}>
                    {lang === "fr" ? "Langue du passeport — pas de traduction"
                      : lang === "de" ? "Reisepasssprache — nicht übersetzen"
                      : "Passport language — do not translate"}
                  </p>
                </div>
                <p className="text-[9px] pl-7" style={{ color: "var(--w3)" }}>
                  {lang === "fr" ? "Écrivez dans la langue de votre passeport (souvent le français). Jamais en allemand."
                    : lang === "de" ? "In der Sprache des Reisepasses schreiben (oft Französisch). Niemals auf Deutsch."
                    : "Write in your passport's language (usually French). Never in German."}
                </p>
                {/* ❌ / ✅ side by side */}
                <div className="grid grid-cols-2 gap-2 pl-7">
                  <div className="rounded-lg px-2 py-1.5 space-y-0.5"
                    style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-border)" }}>
                    <p className="text-[8px] font-semibold flex items-center justify-center gap-1" style={{ color: "var(--danger)" }}><XCircle size={9} strokeWidth={2} /> {lang === "fr" ? "Traduit" : lang === "de" ? "Übersetzt" : "Translated"}</p>
                    <p className="text-[9px] font-mono break-all" style={{ color: "var(--danger)" }}>HAY MOHAMMADI HAUPTSTRASSE IMM 7 ETG 3 N 12</p>
                  </div>
                  <div className="rounded-lg px-2 py-1.5 space-y-0.5"
                    style={{ background: "var(--success-bg)", border: "1px solid var(--success-border)" }}>
                    <p className="text-[8px] font-semibold flex items-center justify-center gap-1" style={{ color: "var(--success)" }}><CheckCircle2 size={9} strokeWidth={2} /> {lang === "fr" ? "Correct" : lang === "de" ? "Richtig" : "Correct"}</p>
                    <p className="text-[9px] font-mono break-all" style={{ color: "var(--success)" }}>HAY MOHAMMADI RUE IBN BATTOUTA IMM 7 ETG 3 N 12</p>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)" }} />

              {/* ── STEP 2 — Order ────────────────────────────────── */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: "var(--info)", color: "#fff" }}>2</span>
                  <p className="text-xs font-semibold" style={{ color: "var(--w)" }}>
                    {lang === "fr" ? "Vérifiez l'ordre — réorganisez si besoin"
                      : lang === "de" ? "Reihenfolge prüfen — bei Bedarf umordnen"
                      : "Check the order — rearrange only if needed"}
                  </p>
                </div>
                <p className="text-[9px] pl-7" style={{ color: "var(--w3)" }}>
                  {lang === "fr" ? "L'ordre correct : ① Quartier → ② Rue → ③ Bâtiment → ④ Étage → ⑤ N° maison (case séparée)"
                    : lang === "de" ? "Richtige Reihenfolge: ① Viertel → ② Straße → ③ Gebäude → ④ Etage → ⑤ Hausnr. (eigenes Feld)"
                    : "Correct order: ① District → ② Street → ③ Building → ④ Floor → ⑤ Hausnr. (separate field)"}
                </p>

                {/* ❌ Scrambled */}
                <div className="px-2.5 py-2 rounded-xl space-y-1.5 pl-7"
                  style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-border)" }}>
                  <p className="text-[8px] font-semibold flex items-center gap-1" style={{ color: "var(--danger)" }}>
                    <XCircle size={9} strokeWidth={2} /> {lang === "fr" ? "Sur le passeport — mélangé" : lang === "de" ? "Im Reisepass — gemischt" : "On passport — scrambled"}
                  </p>
                  <div className="flex flex-wrap gap-1.5 items-end">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7" }}>N 12</span>
                      <span className="text-[7px] font-bold" style={{ color: "#a855f7" }}>Hausnr.</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--info-bg)", color: "var(--info)" }}>RUE IBN BATTOUTA</span>
                      <span className="text-[7px] font-bold" style={{ color: "var(--info)" }}>{lang === "fr" ? "Rue" : lang === "de" ? "Straße" : "Street"}</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(249,115,22,0.15)", color: "#f97316" }}>IMM 7</span>
                      <span className="text-[7px] font-bold" style={{ color: "#f97316" }}>{lang === "fr" ? "Bâtiment" : lang === "de" ? "Gebäude" : "Building"}</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>ETG 3</span>
                      <span className="text-[7px] font-bold" style={{ color: "#10b981" }}>{lang === "fr" ? "Étage" : lang === "de" ? "Etage" : "Floor"}</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(234,179,8,0.15)", color: "#ca8a04" }}>HAY MOHAMMADI</span>
                      <span className="text-[7px] font-bold" style={{ color: "#ca8a04" }}>{lang === "fr" ? "Quartier" : lang === "de" ? "Viertel" : "District"}</span>
                    </div>
                  </div>
                </div>

                {/* Arrow — compact inline */}
                <div className="flex items-center justify-center gap-1.5">
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                  <span className="text-[9px] font-semibold px-2" style={{ color: "var(--info)" }}>
                    ↓ {lang === "fr" ? "réorganiser" : lang === "de" ? "umordnen" : "rearrange"}
                  </span>
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                </div>

                {/* ✅ Correct order — two boxes */}
                <div className="px-2.5 py-2 rounded-xl space-y-1.5 pl-7"
                  style={{ background: "var(--success-bg)", border: "1px solid var(--success-border)" }}>
                  <p className="text-[8px] font-semibold flex items-center gap-1" style={{ color: "var(--success)" }}>
                    <CheckCircle2 size={9} strokeWidth={2} /> {lang === "fr" ? "Ce que vous tapez — bon ordre" : lang === "de" ? "Was Sie eingeben — richtige Reihenfolge" : "What you type — correct order"}
                  </p>
                  <div className="flex gap-2">
                    <div className="flex-1 rounded-lg px-2.5 py-2 space-y-1.5" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                      <p className="text-[9px]" style={{ color: "var(--w3)" }}>{lang === "fr" ? "Adresse" : lang === "de" ? "Adresse" : "Address"}</p>
                      <div className="flex flex-wrap gap-1">
                        <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5" style={{ background: "rgba(234,179,8,0.15)", color: "#ca8a04" }}><span style={{fontSize:7,fontWeight:900}}>①</span>HAY MOHAMMADI</span>
                        <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5" style={{ background: "var(--info-bg)", color: "var(--info)" }}><span style={{fontSize:7,fontWeight:900}}>②</span>RUE IBN BATTOUTA</span>
                        <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5" style={{ background: "rgba(249,115,22,0.15)", color: "#f97316" }}><span style={{fontSize:7,fontWeight:900}}>③</span>IMM 7</span>
                        <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}><span style={{fontSize:7,fontWeight:900}}>④</span>ETG 3</span>
                      </div>
                    </div>
                    <div className="rounded-lg px-2.5 py-2 flex-shrink-0 space-y-1.5" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                      <p className="text-[9px]" style={{ color: "var(--w3)" }}>Hausnr.</p>
                      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-md block text-center inline-flex items-center gap-0.5" style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7" }}><span style={{fontSize:7,fontWeight:900}}>⑤</span>12</span>
                    </div>
                  </div>
                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <div className="flex items-center gap-1"><span className="text-[7px] font-bold" style={{ color: "#ca8a04" }}>①</span><span className="text-[8px]" style={{ color: "var(--w3)" }}>{lang === "fr" ? "Quartier" : lang === "de" ? "Viertel" : "District"}</span></div>
                    <div className="flex items-center gap-1"><span className="text-[7px] font-bold" style={{ color: "var(--info)" }}>②</span><span className="text-[8px]" style={{ color: "var(--w3)" }}>{lang === "fr" ? "Rue" : lang === "de" ? "Straße" : "Street"}</span></div>
                    <div className="flex items-center gap-1"><span className="text-[7px] font-bold" style={{ color: "#f97316" }}>③</span><span className="text-[8px]" style={{ color: "var(--w3)" }}>{lang === "fr" ? "Bâtiment" : lang === "de" ? "Gebäude" : "Building"}</span></div>
                    <div className="flex items-center gap-1"><span className="text-[7px] font-bold" style={{ color: "#10b981" }}>④</span><span className="text-[8px]" style={{ color: "var(--w3)" }}>{lang === "fr" ? "Étage (si applicable)" : lang === "de" ? "Etage (optional)" : "Floor (if any)"}</span></div>
                    <div className="flex items-center gap-1"><span className="text-[7px] font-bold" style={{ color: "#a855f7" }}>⑤</span><span className="text-[8px]" style={{ color: "var(--w3)" }}>Hausnr.</span></div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Passport field hint — postal code */}
      {passportHint === "address_postal" && (
        <div className="fixed inset-x-0 bottom-0 z-[820] flex items-center justify-center p-4 bv-modal-outer"
          style={{ top: "calc(58px + var(--bv-subnav-h, 0px))", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setPassportHint(null)}>
          <div className="w-full max-w-md overflow-hidden"
            style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
              animation: "bvFadeRise .28s var(--ease-out)",
            }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div>
                <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                  {lang === "fr" ? "Trouver votre code postal" : lang === "de" ? "Postleitzahl herausfinden" : "Find your postal code"}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--w3)" }}>codepostal.ma</p>
              </div>
              <button onClick={() => setPassportHint(null)}
                className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center text-xs"
                style={{ color: "var(--w3)" }}><XIcon size={13} strokeWidth={1.8} /></button>
            </div>
            {/* Body */}
            <div className="px-5 py-4 space-y-2">

              {/* Steps — website is Step 1 */}
              <div className="space-y-2">
                {/* Step 1 — open website (special: clickable link row) */}
                <a href="https://www.codepostal.ma/search.aspx" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-opacity hover:opacity-80 no-underline"
                  style={{ background: "var(--info)", border: "1px solid var(--info-border)", textDecoration: "none" }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: "rgba(255,255,255,0.25)", color: "#fff" }}>1</span>
                  <p className="text-xs font-semibold flex-1" style={{ color: "#fff" }}>
                    {lang === "fr" ? `Cliquez ici pour chercher votre code postal`
                      : lang === "de" ? `Hier klicken, um Ihre Postleitzahl zu suchen`
                      : `Click here to search your postal code`}
                  </p>
                  <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 14 }}>↗</span>
                </a>

                {/* Steps 2–6 */}
                {[
                  {
                    n: "2",
                    fr: `Cliquez sur "Par Quartier/Hay"`,
                    de: `Klicken Sie auf "Par Quartier/Hay"`,
                    en: `Click on "Par Quartier/Hay"`,
                  },
                  {
                    n: "3",
                    fr: "Choisissez votre ville",
                    de: "Wählen Sie Ihre Stadt",
                    en: "Choose your city",
                  },
                  {
                    n: "4",
                    fr: "Choisissez votre quartier dans la liste",
                    de: "Wählen Sie Ihr Viertel aus der Liste",
                    en: "Choose your neighbourhood (Quartier) from the list",
                  },
                  {
                    n: "5",
                    fr: `Cliquez sur "Rechercher"`,
                    de: `Klicken Sie auf "Rechercher"`,
                    en: `Click "Rechercher"`,
                  },
                  {
                    n: "6",
                    fr: "Votre code postal s'affiche !",
                    de: "Ihre Postleitzahl wird angezeigt!",
                    en: "Your postal code appears!",
                  },
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-xl"
                    style={{ background: i === 4 ? "var(--success-bg)" : "var(--bg2)", border: `1px solid ${i === 4 ? "var(--success-border)" : "var(--border)"}` }}>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                      style={{ background: i === 4 ? "var(--success)" : "var(--info)", color: "#fff" }}>{step.n}</span>
                    <p className="text-xs leading-relaxed" style={{ color: i === 4 ? "var(--success)" : "var(--w2)", fontWeight: i === 4 ? 600 : 400 }}>
                      {lang === "fr" ? step.fr : lang === "de" ? step.de : step.en}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Berufserlaubnis guide modal */}
      {showWorkGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setShowWorkGuide(false)}>
          <div className="relative w-full max-w-md rounded-2xl overflow-hidden"
            style={{ background: "var(--card)", border: "1px solid var(--border-gold)", maxHeight: "90vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 sticky top-0"
              style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
              <p className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{t.pGuideWorkTitle}</p>
              <button onClick={() => setShowWorkGuide(false)}
                className="bv-row-hover text-xs px-3 py-1"
                style={{ color: "var(--w3)" }}>
                {t.pExampleClose}
              </button>
            </div>

            <div className="px-4 py-4 space-y-3">
              {/* Intro */}
              <p className="text-xs" style={{ color: "var(--w2)" }}>{t.pGuideWorkIntro}</p>

              {/* Doc list */}
              <div className="space-y-1.5">
                {[t.pGuideWorkDoc1, t.pGuideWorkDoc2, t.pGuideWorkDoc3, t.pGuideWorkDoc4].map((doc, i) => (
                  <div key={i} className="px-3 py-2 rounded-xl"
                    style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-bold mt-0.5 w-3 flex-shrink-0" style={{ color: "var(--gold)" }}>{i + 1}</span>
                      <p className="text-xs" style={{ color: "var(--w)" }}><B text={doc} /></p>
                    </div>
                    {i === 3 && DEMANDE_EXAMPLE_URL && (
                      <button
                        onClick={() => { setShowWorkGuide(false); setExampleUrl(DEMANDE_EXAMPLE_URL); }}
                        className="bv-row-hover mt-2 ml-7 text-xs px-2.5 py-1 inline-flex items-center gap-1.5"
                        style={{ color: "var(--info)" }}>
                        <FileText size={11} strokeWidth={1.8} /> {t.pGuideWorkDemandeBtn}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Notes */}
              <div className="rounded-xl px-4 py-3 text-xs"
                style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-border)", color: "var(--danger)" }}>
                <B text={t.pGuideWorkLegalNote} />
              </div>
              <div className="rounded-xl px-4 py-3 text-xs"
                style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)", color: "var(--gold)" }}>
                <B text={t.pGuideWorkDemandeNote} />
              </div>

              {/* Action buttons */}
              <a href={MAPS_URL} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "var(--gold)", color: "#131312" }}>
                {t.pGuideWorkMapsBtn}
              </a>

            </div>
          </div>
        </div>
      )}

      {/* Example modal */}
      {exampleUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setExampleUrl(null)}>
          <div className="relative max-w-lg w-full rounded-2xl overflow-hidden"
            style={{ background: "var(--card)", border: "1px solid var(--border-gold)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{t.pExampleBtn}</p>
              <button onClick={() => setExampleUrl(null)}
                className="bv-row-hover text-sm px-3 py-1"
                style={{ color: "var(--w3)" }}>
                {t.pExampleClose}
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={exampleUrl} alt="Document example" className="w-full object-contain max-h-[70vh]" />
          </div>
        </div>
      )}
    </main>

    {/* ── Verification celebration — shown once, above everything ── */}
    {showCelebration && userId && (
      <VerifiedCelebration
        userId={userId}
        lang={lang as "fr" | "en" | "de"}
        onDismiss={() => setShowCelebration(false)}
      />
    )}

    {/* ── Org-match celebration — shown once per (user, orgId) ── */}
    {celebrateOrg && userId && (
      <MatchedCelebration
        userId={userId}
        orgId={celebrateOrg.id}
        orgName={celebrateOrg.name}
        lang={lang as "fr" | "en" | "de"}
        onDismiss={() => setCelebrateOrg(null)}
      />
    )}

    {/* ── Payment celebration — full-screen, shown once after Stripe redirect ── */}
    {paymentCelebration && userId && (
      <PaymentCelebration
        userId={userId}
        plan={paymentCelebration.plan}
        lang={lang}
        onDismiss={() => setPaymentCelebration(null)}
      />
    )}
    </>
  );
}


