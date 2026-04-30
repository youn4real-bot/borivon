"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { LABEL_TO_FILE_KEY } from "@/lib/fileKeys";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { DOC_EXAMPLES } from "@/lib/docExamples";
import { MAPS_URL, DEMANDE_EXAMPLE_URL } from "@/lib/workLicenseGuide";
import { translations } from "@/lib/translations";
import { COUNTRY_MAP, natToLang as natToLangShared } from "@/lib/countries";
import {
  PhaseIcon, type PhaseKind,
  Lock, Mail, Calendar, ExternalLink, AlertTriangle, PartyPopper,
  IdCard, User, Home, Eye, FilePen, Sparkles, Paperclip, CheckCircle2, XCircle,
  Stethoscope, Languages, FileText,
} from "@/components/PortalIcons";
import { X as XIcon, Download, Upload, RefreshCw, Info } from "lucide-react";
import { PdfViewer } from "@/components/PdfViewer";
import { DocxViewer } from "@/components/DocxViewer";
import { ZoomPanRotateViewer } from "@/components/ZoomPanRotateViewer";
import { Spinner, PageLoader, AutosaveIndicator } from "@/components/ui/states";
import { JourneyView } from "@/components/JourneyView";
import { SessionExpiryWatcher } from "@/components/SessionExpiryWatcher";
import { OrgCodeModal } from "@/components/OrgCodeModal";
import { useMobileMenu } from "@/components/MobileMenuContext";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { buildProfileSlug } from "@/lib/profile-slug";

// Onboarding tour is shown at most once per user (gated by a localStorage
// flag). Lazy-load so returning users don't pay for it.
const OnboardingTour = dynamic(
  () => import("@/components/OnboardingTour").then(m => ({ default: m.OnboardingTour })),
  { ssr: false, loading: () => null },
);

// Map every fileKey → all possible translated labels across all languages
// so getDoc() works regardless of which language was active at upload time
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
  // Legacy aliases — keep old labels so docs uploaded before a rename are still found
  result["workcert"].add("Berufserlaubnis");
  result["abitur_transcript"].add("Abitur Transcript");
  return result;
})();

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

type ViewMode = "docs" | "interview" | "recognition" | "embassy" | "visa" | "flight";

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
};

const JOURNEY_STAGES = [
  { key: "interview"   as const, kind: "interview"   as PhaseKind },
  { key: "recognition" as const, kind: "recognition" as PhaseKind },
  { key: "embassy"     as const, kind: "embassy"     as PhaseKind },
  { key: "visa"        as const, kind: "visa"        as PhaseKind },
  { key: "flight"      as const, kind: "flight"      as PhaseKind },
];

function isJourneyUnlocked(stage: Exclude<ViewMode,"docs">, p: Pipeline | null): boolean {
  if (!p) return false;
  switch (stage) {
    case "interview":   return !!(p.interview_link) || p.interview_status !== "pending";
    case "recognition": return p.recognition_unlocked;
    case "embassy":     return p.embassy_unlocked;
    case "visa":        return p.visa_granted || !!(p.visa_date);
    case "flight":      return !!(p.flight_date);
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

const MA_CITIES = new Set([
  "RABAT","SALE","TEMARA","SKHIRAT","BOUZNIKA","MOHAMMEDIA",
  "CASABLANCA","BERRECHID","SETTAT","BENSLIMANE","MEDIOUNA","NOUACEUR",
  "FES","MEKNES","IFRANE","AZROU","KHENIFRA","MIDELT","ERRACHIDIA",
  "MARRAKECH","OUARZAZATE","ZAGORA","TAROUDANT","TIZNIT","ESSAOUIRA","SAFI",
  "AGADIR","INEZGANE","AIT MELLOUL","BIOUGRA","DRARGA","TAROUDANT",
  "TANGER","TETOUAN","LARACHE","KSAR EL KEBIR","AL HOCEIMA","CHEFCHAOUEN","FNIDEQ","MARTIL",
  "OUJDA","NADOR","BERKANE","TAOURIRT","JERADA","GUERCIF","AHFIR",
  "KENITRA","SIDI KACEM","SIDI SLIMANE","SOUK EL ARBAA","MECHRA BELKSIRI",
  "EL JADIDA","AZEMMOUR","SAFI","YOUSSOUFIA","BENGUERIR",
  "KHOURIBGA","BENI MELLAL","FQUIH BEN SALAH","AZILAL","KASBA TADLA",
  "LAAYOUNE","DAKHLA","BOUJDOUR","SMARA","TAN TAN","ASSA","ZAG",
  "TAZA","TAOUNATE","GUERCIF","NADOR","DRIOUCH",
  "KHEMISSET","TIFLET","ROMMANI",
  "TINGHIR","OUARZAZATE","ZAGORA","KELAAT MGOUNA","SKOURA",
  "BENI MELLAL","KHOURIBGA","FQUIH BEN SALAH",
  "GUELMIM","TIZNIT","SIDI IFNI","TARFAYA",
]);

function normCity(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()
    .replace(/\s+/g, " ");
}

export default function DashboardPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const PHASES = [
    {
      title: t.pWizardPhase1,  shortTitle: t.pSideID,
      desc: t.pWizardPhase1Desc,
      kind: "id" as PhaseKind,
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
      items: [
        { key: "diploma",           label: t.pTypeDiploma,          hint: t.pHintDiploma },
        { key: "studyprog",         label: t.pTypeStudyProg,        hint: t.pHintStudyProg },
        { key: "transcript",        label: t.pTypeTranscript,       hint: t.pHintTranscript },
        { key: "abitur",            label: t.pTypeAbitur,           hint: t.pHintAbitur },
        { key: "abitur_transcript", label: t.pTypeAbiturTranscript, hint: t.pHintAbiturTranscript },
        { key: "praktikum",         label: t.pTypePraktikum,        hint: t.pHintPraktikum },
        { key: "workcert",          label: t.pTypeWorkCert,         hint: t.pHintWorkCert },
        { key: "work_experience",   label: t.pTypeWorkExp,          hint: t.pHintWorkExp, optional: true as const },
      ],
    },
    {
      title: t.pWizardPhase3,  shortTitle: t.pSideTrans,
      desc: t.pWizardPhase3Desc,
      kind: "translations" as PhaseKind,
      isTranslations: true,
      items: [
        { key: "diploma_de",           label: t.pTypeDiplomaDE,          hint: t.pHintDiplomaDE },
        { key: "studyprog_de",         label: t.pTypeStudyProgDE,        hint: t.pHintStudyProgDE },
        { key: "transcript_de",        label: t.pTypeTranscriptDE,       hint: t.pHintTranscriptDE },
        { key: "abitur_de",            label: t.pTypeAbiturDE,           hint: t.pHintAbiturDE },
        { key: "abitur_transcript_de", label: t.pTypeAbiturTranscriptDE, hint: t.pHintAbiturTranscriptDE },
        { key: "praktikum_de",         label: t.pTypePraktikumDE,        hint: t.pHintPraktikumDE },
        { key: "workcert_de",          label: t.pTypeWorkcertDE,         hint: t.pHintWorkcertDE },
        { key: "work_experience_de",   label: t.pTypeWorkExpDE,          hint: t.pHintWorkExpDE, optional: true as const },
      ],
    },
  ];

  const ALL_ITEMS = PHASES.flatMap(p => p.items);

  const [userId, setUserId]         = useState("");
  const [authToken, setAuthToken]   = useState("");
  const [firstName, setFirstName]   = useState("");
  const [lastName, setLastName]     = useState("");
  const [userName, setUserName]     = useState("");
  const [docs, setDocs]           = useState<Doc[]>([]);
  const [loading, setLoading]     = useState(true);
  const [mode, setMode]           = useState<"wizard">("wizard");
  const [phase, setPhase]         = useState(0);
  const [isReturn, setIsReturn]   = useState(false);
  // Mobile-only: phase rail slides in/out via the bottom-bar hamburger button.
  // Default closed on mobile, irrelevant on desktop (rail is always visible).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  type MsgType = "success" | "errPdfOnly" | "errAllTypes" | "errSize" | "errUpload" | "errNetwork";
  type SlotMsg = { key: string; ok: boolean; type: MsgType; label?: string };

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

  // Organization invite-code modal — shown until candidate joins an org or
  // explicitly dismisses ("Later"). Dismissal is session-only; resets on next login.
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgChecked, setOrgChecked]     = useState(false);
  // Names of orgs this candidate is linked to (any status) — shown as a small
  // badge below the welcome line so they always know which partner is following them.
  const [linkedOrgs, setLinkedOrgs]     = useState<{ name: string; status: string }[]>([]);

  // Wire the bottom-bar hamburger ↔ home toggle. The Navbar reads this and
  // renders an icon as the first item in the mobile bottom action bar.
  const mobileMenu = useMobileMenu();
  useEffect(() => {
    if (!mobileMenu) return;
    mobileMenu.setConfig({
      isOpen: mobileNavOpen,
      toggle: () => setMobileNavOpen(o => !o),
      label: mobileNavOpen ? "Close phases" : "Open phases",
    });
    return () => mobileMenu.setConfig(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileNavOpen]);

  // Close the mobile drawer whenever the user picks a phase or jumps to a
  // journey stage — feels expected.
  useEffect(() => { setMobileNavOpen(false); }, [phase]);

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
    // Reset confirmation flags — re-opening doesn't auto-confirm. The candidate
    // can review again, edit if needed, and re-confirm to save.
    setConfirmedFields(new Set());
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
  const [docHintOpen, setDocHintOpen] = useState<{ title: string; hint: string } | null>(null);
  const [infoPassportLoading, setInfoPassportLoading] = useState(false);
  // passport_status from candidate_profiles — drives info button color independently of doc status
  const [passportStatus, setPassportStatus] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc]         = useState<Doc | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Set when a notification click carries a doc_id — resolved to a preview
  // once docs have loaded (handles both same-page and fresh-navigation cases).
  const [pendingOpenDocId, setPendingOpenDocId] = useState<string | null>(null);

  // Auto-open passport-data modal whenever the candidate previews a passport
  // that isn't yet fully approved. Mirrors admin-side behaviour: doc preview
  // on the left (laptop) / top (phone), data form on the right / below. Once
  // approved this stops triggering and the data form is accessible only via
  // the "Passport data" header button.
  useEffect(() => {
    if (!previewDoc) return;
    if (!/pass/i.test(previewDoc.file_type)) return;
    if (previewDoc.status === "approved" && passportStatus === "approved") return;
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

  function handlePreview(doc: Doc) {
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
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const user = session?.user;
      if (!user) { router.replace("/portal"); return; }
      // Server-side role lookup — avoid exposing the admin email in the bundle.
      try {
        const res = await fetch("/api/portal/me/role", {
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        });
        const { role } = await res.json().catch(() => ({ role: null }));
        if (role === "admin") { router.replace("/portal/admin"); return; }
      } catch { /* offline — continue as candidate */ }
      setUserId(user.id);
      setAuthToken(session?.access_token ?? "");
      setFirstName(user.user_metadata?.first_name ?? "");
      setLastName(user.user_metadata?.last_name ?? "");
      setUserName(user.user_metadata?.full_name ?? user.email ?? "");
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
      // Load passport_status for info-button color
      supabase
        .from("candidate_profiles")
        .select("passport_status")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => setPassportStatus(data?.passport_status ?? null));
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
          const list = (orgs ?? []) as { name: string; status: string }[];
          setLinkedOrgs(list);
          const approved = list.filter(o => o.status === "approved");
          if (approved.length === 0) setOrgModalOpen(true);
          setOrgChecked(true);
        })
        .catch(() => setOrgChecked(true));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    if (fetched.length > 0) {
      setIsReturn(true);
      // Only required (non-optional) items count toward phase completion
      const firstIncomplete = PHASES.findIndex(p =>
        p.items.filter(i => !i.optional).some(i => {
          const labels = FILE_KEY_ALL_LABELS[i.key];
          return !fetched.find(d => labels?.has(d.file_type));
        })
      );
      setPhase(firstIncomplete === -1 ? 0 : firstIncomplete);
      setMode("wizard");

      // Deep-link from notification: open doc preview directly
      if (!keepPhase) {
        const navDocId = new URLSearchParams(window.location.search).get("nav_doc_id");
        if (navDocId) {
          setPendingOpenDocId(navDocId);
          window.history.replaceState({}, "", window.location.pathname);
        }
      }
    }
  }

  function getDoc(key: string, fromDocs = docs): Doc | undefined {
    const labels = FILE_KEY_ALL_LABELS[key];
    if (!labels) return undefined;
    return fromDocs.find(d => labels.has(d.file_type));
  }

  function getDocAll(key: string, fromDocs = docs): Doc[] {
    const labels = FILE_KEY_ALL_LABELS[key];
    if (!labels) return [];
    return fromDocs.filter(d => labels.has(d.file_type));
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
    if (!item) {
      console.error("[upload] unknown fileKey:", key);
      setUploadingKey(null);
      setSlotMsg({ key, ok: false, type: "errUpload" });
      return;
    }
    const label = item.label;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("fileType", label);
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
          setSlotMsgTimed({ key, ok: false, type: "errUpload" });
        }
      } catch {
        setSlotMsgTimed({ key, ok: false, type: "errUpload" });
      }
      setUploadingKey(null);
    });
    xhr.addEventListener("error", () => {
      xhrRef.current = null;
      setSlotMsgTimed({ key, ok: false, type: "errNetwork" });
      setUploadingKey(null);
    });
    xhr.addEventListener("abort", () => { xhrRef.current = null; setUploadingKey(null); });
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

  // Verified profile = passport approved AND Lebenslauf approved.
  // Once verified, the candidate gets a permanent public URL and a blue
  // checkmark next to their name everywhere across the site.
  const cvDoc       = getDoc("cv_de");
  const isVerified  = passportStatus === "approved" && cvDoc?.status === "approved";
  const profileSlug = isVerified && userId
    ? buildProfileSlug(firstName, lastName, userId)
    : "";
  const currentPhase  = PHASES[phase];
  const phaseUploaded = currentPhase.items.filter(i => getDoc(i.key)).length;
  const requiredItems = currentPhase.items.filter(i => !i.optional);
  const phaseComplete = requiredItems.every(i => !!getDoc(i.key));

  const statusColor = (s: string) =>
    s === "approved" ? { bg: "rgba(52,199,89,0.12)", text: "#34c759", border: "rgba(52,199,89,0.25)" } :
    s === "rejected"  ? { bg: "rgba(224,82,82,0.12)", text: "#e05252", border: "rgba(224,82,82,0.25)" } :
    { bg: "rgba(255,200,0,0.1)", text: "#c9a240", border: "rgba(201,162,64,0.2)" };

  const statusLabel = (s: string) =>
    s === "approved" ? t.pStatusApproved :
    s === "rejected"  ? t.pStatusRejected : t.pStatusPending;

  if (loading) return <PageLoader />;

  // ── WIZARD ─────────────────────────────────────────────────────────────────
  return (
    <>
    <SessionExpiryWatcher />
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
            .then(({ orgs }) => setLinkedOrgs(orgs ?? []))
            .catch(() => {});
        }}
        onSkip={() => setOrgModalOpen(false)}
      />
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
                style={{ background: "rgba(74,144,217,0.15)", color: "#4a90d9" }}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
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
                        <p className="text-[12px] font-semibold mt-0.5" style={{ color: "warn" in f && f.warn ? "#e05252" : "var(--w)" }}>
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
      const verificationPhase = isPassportDoc
        && (previewDoc.status !== "approved" || passportStatus !== "approved");
      return (
      <div className={`fixed inset-x-0 z-[700] flex justify-center p-4 bv-cand-preview-outer ${verificationPhase && passportModal ? "bv-side-preview-cand" : "top-[58px] bottom-0 items-center"}`}
        style={{ background: verificationPhase && passportModal ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.72)",
                 backdropFilter: verificationPhase && passportModal ? "blur(8px)" : undefined }}
        onClick={() => setPreviewDoc(null)}>
        {/* Mobile only: leave clearance for the bottom action bar so the
            PDF popup never slides behind it. */}
        <style>{`
          @media (max-width: 639.98px) {
            .bv-cand-preview-outer { padding-bottom: calc(1rem + 72px) !important; }
            .bv-cand-preview-card  {
              height: calc(100dvh - 58px - 1rem - 72px - 1rem) !important;
              max-height: calc(100dvh - 58px - 1rem - 72px - 1rem) !important;
            }
            .bv-side-preview-cand {
              top: 58px !important;
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
              top: 58px;
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
            height: verificationPhase && passportModal ? "auto" : "88vh",
            maxHeight: verificationPhase && passportModal ? "620px" : "88vh",
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
                aria-label="Passport data"
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
                style={{ color: "var(--w2)" }} aria-label="Download" title="Download">
                <Download size={14} strokeWidth={1.8} />
              </a>
            )}
            <button onClick={() => setPreviewDoc(null)} aria-label="Close"
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
              if (ext === "pdf") return <PdfViewer src={previewBlobUrl} />;
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
    <main className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "calc(61px + 2rem)" }}>
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
              <span className="ml-1.5 inline-block" style={{ transform: "translateY(-1px)" }}>👋</span>
            </h1>
            <p className="text-[13.5px] mt-1.5" style={{ color: "var(--w3)" }}>
              {isReturn ? t.pWelcomeBackSub : t.pDashSpace}
            </p>
            {linkedOrgs.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {linkedOrgs.map(o => (
                  <span key={o.name}
                    className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5"
                    title={o.status === "approved"
                      ? `${lang === "de" ? "Verbunden mit" : lang === "en" ? "Linked with" : "Lié avec"} ${o.name}`
                      : `${lang === "de" ? "Anfrage an" : lang === "en" ? "Request to" : "Demande à"} ${o.name} — ${lang === "de" ? "wartet auf Genehmigung" : lang === "en" ? "pending approval" : "en attente d'approbation"}`}
                    style={{
                      background:   o.status === "approved" ? "var(--gdim)"          : "rgba(224,200,82,0.10)",
                      color:        o.status === "approved" ? "var(--gold)"          : "#e5b94f",
                      border: `1px solid ${o.status === "approved" ? "var(--border-gold)" : "rgba(224,200,82,0.30)"}`,
                      borderRadius: "var(--r-sm)",
                    }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
                    </svg>
                    {o.name}
                    {o.status === "pending" && <span style={{ opacity: 0.7 }}>· {lang === "de" ? "ausstehend" : lang === "en" ? "pending" : "en attente"}</span>}
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

        {/* Two-column: sidebar stepper + main content */}
        <div className="flex gap-4 sm:gap-6 items-start">

          {/* ── Vertical sidebar ──
              Desktop: always visible at left, sticky.
              Mobile: hidden by default; slides in as an overlay drawer when
              the user taps the hamburger in the bottom bar. */}
          <aside className={`shrink-0 w-[60px] sm:w-[80px] hidden sm:block`}
            style={{ position: "sticky", top: "calc(61px + 1.5rem)" }}>
            {PHASES.map((ph, i) => {
              const isActive = i === phase && viewMode === "docs";

              // Gold on active — minimalist borderless treatment
              const circleText   = isActive ? "var(--gold)" : "var(--w3)";
              const lineColor    = "var(--border)";

              // Candidate-side badge: count docs the ADMIN has acted on
              // (approved OR rejected). Pending docs sit waiting for review
              // and aren't actionable for the candidate, so we don't surface
              // them here — the badge means "there's news for you in this
              // phase". Admin sidebar still uses pending count (different
              // audience).
              const decidedCnt = ph.items.reduce((n, it) => {
                const list = getDocAll(it.key);
                if (list.length === 0) return n;
                return n + list.filter(d => d.status === "approved" || d.status === "rejected").length;
              }, 0);
              const rejectedCnt = ph.items.reduce((n, it) => {
                const list = getDocAll(it.key);
                if (list.length === 0) return n;
                return n + list.filter(d => d.status === "rejected").length;
              }, 0);
              const badgeColor = rejectedCnt > 0 ? "#e05252" : "var(--gold)";

              return (
                <div key={i} className="flex flex-col items-center">
                  <button
                    onClick={() => { setPhase(i); setViewMode("docs"); setSlotMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    title={ph.title}
                    className="bv-lift-hover w-full flex flex-col items-center gap-1.5 py-1.5"
                  >
                    <span
                      className="relative flex items-center justify-center w-10 h-10 rounded-full leading-none select-none transition-all duration-300"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: circleText,
                        transform: isActive ? "scale(1.08)" : "scale(1)",
                        transition: "color 0.2s, transform 0.15s",
                      }}
                    >
                      <PhaseIcon kind={ph.kind} size={17} />
                      {decidedCnt > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center px-1"
                          style={{ background: badgeColor, color: "#131312", border: "1.5px solid var(--bg)" }}>
                          {decidedCnt}
                        </span>
                      )}
                    </span>
                    <span
                      className="text-[9px] sm:text-[10px] text-center leading-tight font-medium px-0.5 w-full"
                      style={{ color: circleText }}
                    >
                      {ph.shortTitle}
                    </span>
                  </button>
                  {i < PHASES.length - 1 && (
                    <div className="w-px transition-colors duration-500" style={{ height: 18, background: lineColor }} />
                  )}
                </div>
              );
            })}

            {/* Separator */}
            <div className="flex flex-col items-center py-1">
              <div style={{ width: 1, height: 20, background: "var(--border)" }} />
            </div>

            {/* Journey stage icons */}
            {JOURNEY_STAGES.map((js, ji) => {
              const unlocked = isJourneyUnlocked(js.key, pipeline);
              const isActive = viewMode === js.key;
              const stageLabel = t[`pJourney${js.key.charAt(0).toUpperCase() + js.key.slice(1)}` as keyof typeof t] as string;
              return (
                <div key={js.key} className="flex flex-col items-center">
                  <button
                    onClick={() => {
                      if (unlocked) { setViewMode(js.key); window.scrollTo({ top: 0, behavior: "smooth" }); }
                    }}
                    title={unlocked ? stageLabel : t.pJourneyLocked}
                    className={`w-full flex flex-col items-center gap-1.5 py-1 transition-all duration-200${unlocked ? " bv-row-hover" : ""}`}
                    style={{ cursor: unlocked ? "pointer" : "default", opacity: unlocked ? 1 : 0.32 }}
                  >
                    <span
                      className="relative flex items-center justify-center w-9 h-9 rounded-full leading-none select-none transition-all duration-300"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: isActive ? "var(--gold)" : "var(--w3)",
                        transform: isActive ? "scale(1.08)" : "scale(1)",
                        transition: "color 0.2s, transform 0.15s",
                      }}>
                      <PhaseIcon kind={js.kind} size={15} />
                      {!unlocked && (
                        <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full"
                          style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                          <Lock size={7} strokeWidth={2.2} style={{ color: "var(--w3)" }} />
                        </span>
                      )}
                    </span>
                    <span className="text-[9px] text-center leading-tight font-medium"
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

          {/* ── Mobile slide-in drawer for phase rail ──
              Hidden on desktop. Backdrop dims the page; tap to close.
              The drawer itself slides in from the left and reuses the same
              phase + journey rail content as the desktop aside. */}
          {mobileNavOpen && (
            <div
              className="sm:hidden fixed inset-0 z-[450]"
              style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", animation: "bvFadeRise .18s var(--ease-out)" }}
              onClick={() => setMobileNavOpen(false)}>
              <aside
                className="absolute top-0 bottom-0 left-0 w-[110px] py-6 px-2 flex flex-col items-center"
                style={{
                  background: "var(--card)",
                  borderRight: "1px solid var(--border)",
                  animation: "bvSlideInLeft .22s var(--ease-out)",
                  paddingTop: "calc(61px + 1.5rem)",
                  overflowY: "auto",
                }}
                onClick={e => e.stopPropagation()}>
                {PHASES.map((ph, i) => {
                  const isActive = i === phase && viewMode === "docs";
                  // Same logic as the desktop sidebar: count only docs the
                  // admin has acted on (approved or rejected). Red when any
                  // rejection sits inside the phase, gold otherwise.
                  const decidedCnt = ph.items.reduce((n, it) => {
                    const list = getDocAll(it.key);
                    if (list.length === 0) return n;
                    return n + list.filter(d => d.status === "approved" || d.status === "rejected").length;
                  }, 0);
                  const rejectedCnt = ph.items.reduce((n, it) => {
                    const list = getDocAll(it.key);
                    if (list.length === 0) return n;
                    return n + list.filter(d => d.status === "rejected").length;
                  }, 0);
                  const badgeColor = rejectedCnt > 0 ? "#e05252" : "var(--gold)";
                  return (
                    <div key={i} className="flex flex-col items-center w-full">
                      <button
                        onClick={() => { setPhase(i); setViewMode("docs"); setSlotMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                        title={ph.title}
                        className="bv-lift-hover w-full flex flex-col items-center gap-1.5 py-1.5">
                        <span
                          className="relative flex items-center justify-center w-10 h-10 rounded-full leading-none select-none transition-all duration-300"
                          style={{
                            background: "transparent", border: "none",
                            color: isActive ? "var(--gold)" : "var(--w3)",
                            transform: isActive ? "scale(1.08)" : "scale(1)",
                            transition: "color 0.2s, transform 0.15s",
                          }}>
                          <PhaseIcon kind={ph.kind} size={17} />
                          {decidedCnt > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center px-1"
                              style={{ background: badgeColor, color: "#131312", border: "1.5px solid var(--card)" }}>
                              {decidedCnt}
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-center leading-tight font-medium px-0.5 w-full"
                          style={{ color: isActive ? "var(--gold)" : "var(--w3)" }}>
                          {ph.shortTitle}
                        </span>
                      </button>
                      {i < PHASES.length - 1 && (
                        <div className="w-px" style={{ height: 18, background: "var(--border)" }} />
                      )}
                    </div>
                  );
                })}
                <div className="flex flex-col items-center py-1 w-full">
                  <div style={{ width: 1, height: 20, background: "var(--border)" }} />
                </div>
                {JOURNEY_STAGES.map((js, ji) => {
                  const unlocked = isJourneyUnlocked(js.key, pipeline);
                  const isActive = viewMode === js.key;
                  const stageLabel = t[`pJourney${js.key.charAt(0).toUpperCase() + js.key.slice(1)}` as keyof typeof t] as string;
                  return (
                    <div key={js.key} className="flex flex-col items-center w-full">
                      <button
                        onClick={() => {
                          if (unlocked) { setViewMode(js.key); setMobileNavOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
                        }}
                        title={unlocked ? stageLabel : t.pJourneyLocked}
                        className={`w-full flex flex-col items-center gap-1.5 py-1 transition-all duration-200${unlocked ? " bv-row-hover" : ""}`}
                        style={{ cursor: unlocked ? "pointer" : "default", opacity: unlocked ? 1 : 0.32 }}>
                        <span
                          className="relative flex items-center justify-center w-9 h-9 rounded-full leading-none select-none transition-all duration-300"
                          style={{
                            background: "transparent", border: "none",
                            color: isActive ? "var(--gold)" : "var(--w3)",
                            transform: isActive ? "scale(1.08)" : "scale(1)",
                            transition: "color 0.2s, transform 0.15s",
                          }}>
                          <PhaseIcon kind={js.kind} size={15} />
                          {!unlocked && (
                            <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full"
                              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                              <Lock size={7} strokeWidth={2.2} style={{ color: "var(--w3)" }} />
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-center leading-tight font-medium"
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
            </div>
          )}

          {/* ── Main content ── */}
          <div className="flex-1 min-w-0">

            {/* ── Journey stage views ── */}
            {viewMode !== "docs" && (
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
                  const list = getDocAll(i.key);
                  return n + list.filter(d => d.status === "pending").length;
                }, 0);
                return (
                  <div className="flex items-center gap-3 px-6 pt-6 pb-3">
                    <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                      style={{ background: "var(--gdim)", color: "var(--gold)", borderRadius: "12px" }}>
                      <PhaseIcon kind={currentPhase.kind} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--w3)" }}>
                        {lang === "de" ? "Phase" : lang === "en" ? "Phase" : "Phase"} {phase + 1}
                      </p>
                      <h2 className="text-[18px] font-semibold tracking-[-0.015em] leading-tight" style={{ color: "var(--w)" }}>
                        {currentPhase.title}
                      </h2>
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

              {/* Notice strip — scan quality + phase-specific tips */}
              <div className="flex flex-col gap-1.5 px-6 pt-4 pb-2">
                <p className="text-[11px] flex items-center gap-1.5" style={{ color: "#e05252" }}>
                  <AlertTriangle size={11} strokeWidth={1.8} /> {t.pScanQualityShort}
                </p>
                {phase === 1 && (
                  <p className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--gold)" }}>
                    <Paperclip size={11} strokeWidth={1.8} /> {t.pOriginalsOnlyShort}
                  </p>
                )}
                {currentPhase.isTranslations && (
                  <div className="text-[11px] flex flex-col gap-0.5" style={{ color: "var(--gold)" }}>
                    <span className="flex items-center gap-1.5"><Languages size={11} strokeWidth={1.8} /> {t.pTranslationsShort}</span>
                    <a href="https://rabat.diplo.de/resource/blob/2417070/461b64d35650206a0f64ffb772feee9f/uebersetzer-liste-data.pdf"
                      target="_blank" rel="noreferrer" className="underline ml-5" style={{ color: "var(--gold)" }}>
                      {t.pTransTooltipMoroccoLink}
                    </a>
                    <a href="https://www.justiz-dolmetscher.de/Recherche/de/Suchen"
                      target="_blank" rel="noreferrer" className="underline ml-5" style={{ color: "var(--gold)" }}>
                      {t.pTransTooltipGermanyLink}
                    </a>
                  </div>
                )}
              </div>

              {/* Doc rows — borderless minimalist list */}
              <div className="px-3 pb-2">
          {currentPhase.items.map((item, idx) => {
            const isOther     = OTHER_KEYS.includes(item.key);
            const allOtherDocs = isOther ? getDocAll(item.key) : [];
            const doc        = isOther ? undefined : getDoc(item.key);
            const uploaded   = isOther ? allOtherDocs.length > 0 : !!doc;

            // For "other": derive aggregate status
            const otherHasRejected = allOtherDocs.some(d => d.status === "rejected");
            const otherAllApproved = allOtherDocs.length > 0 && allOtherDocs.every(d => d.status === "approved");
            const sc = isOther
              ? (uploaded ? statusColor(otherHasRejected ? "rejected" : otherAllApproved ? "approved" : "pending") : null)
              : (doc ? statusColor(doc.status ?? "pending") : null);

            const exUrl      = DOC_EXAMPLES[item.key];
            const isUploading = uploadingKey === item.key;
            const isDragOver  = dragOverKey === item.key;
            const msg         = slotMsg?.key === item.key ? slotMsg : null;
            const fileLabel   = isOther ? "PDF / IMG / DOCX" : "PDF";

            // Whole-row click previews the doc when one is uploaded — saves
            // space vs a dedicated Eye icon. Inner buttons (Replace, Download,
            // info, hint) stop propagation so they don't accidentally trigger
            // the preview.
            const rowClickable = !isOther && uploaded && doc?.drive_file_id && !isUploading;
            const rowOnClick = rowClickable ? () => handlePreview(doc!) : undefined;

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

                  <div className="flex items-start gap-3">
                    {/* Status circle — line icons feel more refined than glyphs */}
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={uploaded && sc
                        ? { background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }
                        : { background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                      {(() => {
                        if (isUploading) {
                          return <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />;
                        }
                        let s: "empty" | "pending" | "approved" | "rejected";
                        if (isOther) {
                          s = allOtherDocs.length === 0 ? "empty" : otherHasRejected ? "rejected" : otherAllApproved ? "approved" : "pending";
                        } else if (uploaded) {
                          s = doc!.status === "approved" ? "approved" : doc!.status === "rejected" ? "rejected" : "pending";
                        } else {
                          s = "empty";
                        }
                        if (s === "approved") return <CheckCircle2 size={14} strokeWidth={1.8} />;
                        if (s === "rejected") return <XCircle      size={14} strokeWidth={1.8} />;
                        if (s === "pending")  return <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />;
                        return <span className="w-1.5 h-1.5 rounded-full" style={{ border: "1px solid currentColor" }} />;
                      })()}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13.5px] font-medium tracking-tight" style={{ color: "var(--w)" }}>{item.label}</p>
                        {/* "What is this?" — small blue info circle that opens
                            a popup with the document explanation. The
                            workcert (Berufserlaubnis) row uses the richer
                            step-by-step guide modal instead, which lists the
                            4 documents required by the Moroccan Ministry of
                            Health in Rabat with maps + example links. */}
                        {item.hint && (
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
                            style={{ background: "rgba(74,144,217,0.18)", color: "#4a90d9", border: "none", cursor: "pointer" }}>
                            <Info size={11} strokeWidth={2.2} />
                          </button>
                        )}
                        {/* File type — borderless mono tag, quieter */}
                        <span className="text-[10px] font-mono tracking-wide" style={{ color: "var(--w3)" }}>
                          {fileLabel}
                        </span>
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
                        <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>
                          <span className="font-semibold" style={{ color: sc!.text }}>
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
                            background: "rgba(224,82,82,0.06)",
                            border: "1px solid rgba(224,82,82,0.22)",
                            borderLeft: "3px solid #e05252",
                            borderRadius: "var(--r-md)",
                          }}>
                          <div className="px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] inline-flex items-center gap-1.5 mb-1.5"
                              style={{ color: "#e05252" }}>
                              <AlertTriangle size={11} strokeWidth={1.8} />
                              {lang === "fr" ? "Action requise" : lang === "de" ? "Aktion erforderlich" : "Action needed"}
                            </p>
                            <p className="text-[12.5px] font-semibold tracking-tight mb-2" style={{ color: "var(--w)" }}>
                              {lang === "fr" ? "Document à renvoyer" : lang === "de" ? "Dokument muss neu hochgeladen werden" : "Re-upload required"}
                            </p>
                            {doc!.feedback && (
                              <p className="text-[12px] leading-relaxed mb-3 pl-2.5"
                                style={{ color: "var(--w2)", borderLeft: "2px solid rgba(224,82,82,0.32)" }}>
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
                        <p className="mt-1.5 text-xs" style={{ color: msg.ok ? "#34c759" : "#e05252" }}>
                          {msg.type === "success" ? t.pUploadSuccess.replace("{label}", ALL_ITEMS.find(i => i.key === msg.key)?.label ?? "") :
                           msg.type === "errPdfOnly" ? t.pErrPdfOnly :
                           msg.type === "errAllTypes" ? t.pErrAllTypes :
                           msg.type === "errSize" ? t.pErrSize.replace("{size}", String(MAX_MB)) :
                           msg.type === "errNetwork" ? t.pErrNetwork : t.pErrUpload}
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
                          <button
                            onClick={(e) => { e.stopPropagation(); window.open("/portal/cv-builder", "_blank"); }}
                            className="text-xs font-semibold transition-all hover:opacity-90 hover:-translate-y-0.5 px-3 py-1.5 inline-flex items-center gap-1.5"
                            style={{ background: "var(--gold)", color: "#1a1a1a", borderRadius: "var(--r-sm)", boxShadow: "0 4px 12px rgba(212,175,55,0.25)" }}>
                            <Sparkles size={12} strokeWidth={2} /> {t.pCVBuilderBtn}
                          </button>
                        )}

                        {/* Empty state → big gold "Upload" pill (primary action).
                            Skipped for CV slots (route to the builder) and for
                            the "other" multi-doc slot (handled below). */}
                        {!uploaded && !isOther && item.key !== "cv" && item.key !== "cv_de" && (
                          <button onClick={(e) => { e.stopPropagation(); openPicker(item.key); }}
                            className="text-xs font-semibold transition-opacity hover:opacity-80 px-3 py-1.5"
                            style={{ background: "var(--gold)", color: "#1a1a1a", borderRadius: "var(--r-sm)" }}>
                            {t.pUploadBtn}
                          </button>
                        )}

                        {/* "other" key — single Upload pill, allows multi-doc up
                            to a max of 5 separate files. Once the candidate hits
                            5 the button disappears so they can't add more. */}
                        {isOther && allOtherDocs.length < 5 && (
                          <button onClick={(e) => { e.stopPropagation(); openPicker(item.key); }}
                            className="text-xs font-semibold transition-opacity hover:opacity-80 px-3 py-1.5"
                            style={{ background: "var(--gold)", color: "#1a1a1a", borderRadius: "var(--r-sm)" }}>
                            {t.pUploadBtn}
                          </button>
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
                              fetch(`/api/portal/file?id=${doc!.drive_file_id}`, {
                                headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
                              })
                                .then(r => r.blob())
                                .then(blob => {
                                  // Revoke after the click handler returns so we don't
                                  // leak one object URL per download.
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url; a.download = doc!.file_name; a.click();
                                  setTimeout(() => URL.revokeObjectURL(url), 0);
                                })
                                .catch(err => console.error("Download error:", err));
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
                  <div className="px-2 pb-3 pt-1 space-y-2" style={{ paddingLeft: "3rem" }}>
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
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await fetch(`/api/portal/documents/${d.id}`, {
                                        method: "DELETE",
                                        headers: { Authorization: `Bearer ${authToken}` },
                                      });
                                      if (userId) await loadDocs(userId, true);
                                      openPicker(item.key);
                                    } catch (err) {
                                      console.error("Replace error:", err);
                                    }
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
                                    fetch(`/api/portal/file?id=${d.drive_file_id}`, {
                                      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
                                    })
                                      .then(r => r.blob())
                                      .then(blob => {
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a");
                                        a.href = url; a.download = d.file_name; a.click();
                                        setTimeout(() => URL.revokeObjectURL(url), 0);
                                      })
                                      .catch(err => console.error("Download error:", err));
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
                            <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: "#e05252" }}>
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
                style={{ background: "#34c759", color: "#fff" }}>
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
                background: phaseComplete ? "#34c759" : "var(--gold)",
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
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
                    style={{ color: "#4a90d9" }}>
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
        const splitWithPreview = !!previewDoc
          && /pass/i.test(previewDoc.file_type)
          && (previewDoc.status !== "approved" || passportStatus !== "approved");
        return (
        <div className={`fixed inset-x-0 z-[750] flex justify-center p-4 bv-passport-modal-outer ${splitWithPreview ? "bv-side-data-cand" : "top-[58px] bottom-0 items-center"}`}
          style={{ background: splitWithPreview ? "transparent" : "rgba(0,0,0,0.45)",
                   backdropFilter: splitWithPreview ? undefined : "blur(8px)",
                   pointerEvents: splitWithPreview ? "none" : "auto" }}
          onClick={isPassportApproved && !splitWithPreview ? (e) => { if (e.target === e.currentTarget) setPassportModal(null); } : undefined}>
          {/* Phone: leave clearance for the bottom action bar so the modal
              never slides behind it. Laptop: top-[58px] above already
              creates the small gap below the navbar. */}
          <style>{`
            @media (max-width: 639.98px) {
              .bv-passport-modal-outer { padding-bottom: calc(1rem + 72px) !important; }
              .bv-passport-modal-card  {
                max-height: calc(100dvh - 58px - 1rem - 72px - 1rem) !important;
              }
              .bv-side-data-cand {
                top: calc(58px + 50dvh - 0.25rem) !important;
                bottom: 0 !important;
                padding-top: 0.25rem !important;
                align-items: center !important;
              }
              .bv-side-data-cand .bv-passport-modal-card {
                max-height: 100% !important;
              }
            }
            @media (min-width: 640px) {
              .bv-side-data-cand {
                top: 58px;
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
              maxHeight: "88vh", animation: "bvFadeRise .28s var(--ease-out)",
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
                      style={{ background: "rgba(52,199,89,0.12)", color: "#34c759", border: "1px solid rgba(52,199,89,0.25)" }}>
                      <CheckCircle2 size={11} strokeWidth={1.8} /> Approved
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
                    suspiciousHints[f.key] = "Must be exactly 5 digits";
                  }
                  if (f.wordsOnly) {
                    if (/\d/.test(v)) {
                      suspiciousKeys.add(f.key); suspiciousHints[f.key] = "Should contain only letters";
                    } else if (f.key === "city_of_residence" && !MA_CITIES.has(normCity(v))) {
                      suspiciousKeys.add(f.key); suspiciousHints[f.key] = "Not a recognized Moroccan city — please verify";
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
                    <rect x="1" y="1" width="14" height="14" rx="3" stroke="#f59e0b" strokeWidth="1.5"/>
                    <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.35"/>
                  </svg>
                );
                const IconChecked = (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect width="16" height="16" rx="3.5" fill="#22c55e"/>
                    <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                );

                // ── Read-only view (passport fully approved) ─────────────────────
                if (isPassportApproved) {
                  return (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {fields.map(f => {
                        const val = passportModal[f.key];
                        const display = (!val || val === "—" || val.trim() === "") ? "—" : val;
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
                      <p className="text-[10px]" style={{ color: "#e08a00" }}>
                        {t.pPassportReviewNote}
                      </p>
                      <div className="flex items-center gap-1.5">
                        {/* Visual: reuse exact same icons as the form checkboxes */}
                        {IconUnchecked}
                        <span style={{ color: "#aaa", fontSize: 9 }}>→</span>
                        {IconChecked}
                        <p className="text-[10px]" style={{ color: "#e08a00" }}>
                          {t.pPassportReviewNote2}
                        </p>
                      </div>
                    </div>
                    {/* ── Field grid ──────────────────────────────────────── */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    {fields.map(f => {
                      const missing    = missingKeys.has(f.key);
                      const suspicious = !missing && suspiciousKeys.has(f.key);
                      const borderColor = missing ? "#e05252" : suspicious ? "#f59e0b" : "var(--border2)";
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
                            <span className="ml-1" style={{ color: "#e05252" }}>*</span>
                            {f.manual && <FilePen size={10} strokeWidth={1.8} className="inline ml-1 opacity-40" />}
                          </label>
                          {f.key === "issuing_authority" && (
                            <button type="button"
                              onClick={() => setPassportHint("issuing_authority")}
                              className="text-[9px] underline underline-offset-2 transition-opacity hover:opacity-70 flex-shrink-0"
                              style={{ color: "#4a90d9" }}>
                              {t.pWhatIsThis}
                            </button>
                          )}
                          {f.key === "address_street" && (
                            <button type="button"
                              onClick={() => setPassportHint("address_street")}
                              className="text-[9px] underline underline-offset-2 transition-opacity hover:opacity-70 flex-shrink-0"
                              style={{ color: "#4a90d9" }}>
                              {t.pAddrHintBtn}
                            </button>
                          )}
                          {f.key === "address_postal" && (
                            <button type="button"
                              onClick={() => setPassportHint("address_postal")}
                              className="text-[9px] underline underline-offset-2 transition-opacity hover:opacity-70 flex-shrink-0"
                              style={{ color: "#4a90d9" }}>
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
                            title={!canConfirm ? "Fill in this field first" : confirmed ? "Confirmed — click to undo" : "Click to confirm"}>
                            {!canConfirm ? IconEmpty : confirmed ? IconChecked : IconUnchecked}
                          </button>
                        </div>
                        {suspicious && suspiciousHints[f.key] && (
                          <p className="text-[9px] mt-0.5 inline-flex items-center gap-1" style={{ color: "#f59e0b" }}><AlertTriangle size={9} strokeWidth={1.8} />{suspiciousHints[f.key]}</p>
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
                      const res = await fetch("/api/portal/me/passport-data-pdf", {
                        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
                      });
                      if (!res.ok) { alert("Could not generate PDF — please try again."); return; }
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      const fn = [passportModal?.first_name, passportModal?.last_name].filter(Boolean).join("_").toLowerCase() || "passport_data";
                      a.href = url; a.download = `${fn}_passport_data.pdf`; a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 0);
                    } catch { alert("Download failed — please try again."); }
                  }}
                  className="w-full py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                  style={{ background: "var(--gold)", color: "#1a1a1a" }}>
                  <Download size={14} strokeWidth={1.8} />
                  {lang === "fr" ? "Télécharger les données" : lang === "de" ? "Daten herunterladen" : "Download data"}
                </button>
              ) : (
                <>
                  {allConfirmed && (
                    <p className="text-[10px] mb-2.5 py-1.5 rounded-lg font-medium text-center" style={{ color: "#22c55e", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
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
                          alert(err.error ?? "Failed to save passport data. Please try again.");
                          return;
                        }
                      } catch {
                        setPassportSaving(false);
                        alert("Network error — please check your connection and try again.");
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
                    style={{ background: "var(--gold)", color: "#1a1a1a" }}>
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
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[820] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
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
                  style={{ background: "rgba(224,82,82,0.08)", border: "1px solid rgba(224,82,82,0.2)" }}>
                  <XCircle size={16} strokeWidth={1.8} className="flex-shrink-0" style={{ color: "#e05252" }} />
                  <span className="text-sm font-mono" style={{ color: "#e05252" }}>Laayoune</span>
                </div>
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <CheckCircle2 size={16} strokeWidth={1.8} className="flex-shrink-0" style={{ color: "#22c55e" }} />
                  <span className="text-sm font-mono" style={{ color: "#22c55e" }}>Province de Laayoune</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Passport field hint — address */}
      {passportHint === "address_street" && (
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[820] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
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
                    style={{ background: "#4a90d9", color: "#fff" }}>1</span>
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
                    style={{ background: "rgba(224,82,82,0.07)", border: "1px solid rgba(224,82,82,0.2)" }}>
                    <p className="text-[8px] font-semibold flex items-center justify-center gap-1" style={{ color: "#e05252" }}><XCircle size={9} strokeWidth={2} /> {lang === "fr" ? "Traduit" : lang === "de" ? "Übersetzt" : "Translated"}</p>
                    <p className="text-[9px] font-mono break-all" style={{ color: "#e05252" }}>HAY MOHAMMADI HAUPTSTRASSE IMM 7 ETG 3 N 12</p>
                  </div>
                  <div className="rounded-lg px-2 py-1.5 space-y-0.5"
                    style={{ background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <p className="text-[8px] font-semibold flex items-center justify-center gap-1" style={{ color: "#22c55e" }}><CheckCircle2 size={9} strokeWidth={2} /> {lang === "fr" ? "Correct" : lang === "de" ? "Richtig" : "Correct"}</p>
                    <p className="text-[9px] font-mono break-all" style={{ color: "#22c55e" }}>HAY MOHAMMADI RUE IBN BATTOUTA IMM 7 ETG 3 N 12</p>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)" }} />

              {/* ── STEP 2 — Order ────────────────────────────────── */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: "#4a90d9", color: "#fff" }}>2</span>
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
                  style={{ background: "rgba(224,82,82,0.07)", border: "1px solid rgba(224,82,82,0.2)" }}>
                  <p className="text-[8px] font-semibold flex items-center gap-1" style={{ color: "#e05252" }}>
                    <XCircle size={9} strokeWidth={2} /> {lang === "fr" ? "Sur le passeport — mélangé" : lang === "de" ? "Im Reisepass — gemischt" : "On passport — scrambled"}
                  </p>
                  <div className="flex flex-wrap gap-1.5 items-end">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7" }}>N 12</span>
                      <span className="text-[7px] font-bold" style={{ color: "#a855f7" }}>Hausnr.</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(74,144,217,0.15)", color: "#4a90d9" }}>RUE IBN BATTOUTA</span>
                      <span className="text-[7px] font-bold" style={{ color: "#4a90d9" }}>{lang === "fr" ? "Rue" : lang === "de" ? "Straße" : "Street"}</span>
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
                  <span className="text-[9px] font-semibold px-2" style={{ color: "#4a90d9" }}>
                    ↓ {lang === "fr" ? "réorganiser" : lang === "de" ? "umordnen" : "rearrange"}
                  </span>
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                </div>

                {/* ✅ Correct order — two boxes */}
                <div className="px-2.5 py-2 rounded-xl space-y-1.5 pl-7"
                  style={{ background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <p className="text-[8px] font-semibold flex items-center gap-1" style={{ color: "#22c55e" }}>
                    <CheckCircle2 size={9} strokeWidth={2} /> {lang === "fr" ? "Ce que vous tapez — bon ordre" : lang === "de" ? "Was Sie eingeben — richtige Reihenfolge" : "What you type — correct order"}
                  </p>
                  <div className="flex gap-2">
                    <div className="flex-1 rounded-lg px-2.5 py-2 space-y-1.5" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                      <p className="text-[9px]" style={{ color: "var(--w3)" }}>{lang === "fr" ? "Adresse" : lang === "de" ? "Adresse" : "Address"}</p>
                      <div className="flex flex-wrap gap-1">
                        <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5" style={{ background: "rgba(234,179,8,0.15)", color: "#ca8a04" }}><span style={{fontSize:7,fontWeight:900}}>①</span>HAY MOHAMMADI</span>
                        <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5" style={{ background: "rgba(74,144,217,0.15)", color: "#4a90d9" }}><span style={{fontSize:7,fontWeight:900}}>②</span>RUE IBN BATTOUTA</span>
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
                    <div className="flex items-center gap-1"><span className="text-[7px] font-bold" style={{ color: "#4a90d9" }}>②</span><span className="text-[8px]" style={{ color: "var(--w3)" }}>{lang === "fr" ? "Rue" : lang === "de" ? "Straße" : "Street"}</span></div>
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
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[820] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
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
                  style={{ background: "#4a90d9", border: "1px solid #3a7bc8", textDecoration: "none" }}>
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
                    style={{ background: i === 4 ? "rgba(34,197,94,0.07)" : "var(--bg2)", border: `1px solid ${i === 4 ? "rgba(34,197,94,0.2)" : "var(--border)"}` }}>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                      style={{ background: i === 4 ? "#22c55e" : "#4a90d9", color: "#fff" }}>{step.n}</span>
                    <p className="text-xs leading-relaxed" style={{ color: i === 4 ? "#22c55e" : "var(--w2)", fontWeight: i === 4 ? 600 : 400 }}>
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
              <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{t.pGuideWorkTitle}</p>
              <button onClick={() => setShowWorkGuide(false)}
                className="bv-row-hover text-sm px-3 py-1"
                style={{ color: "var(--w3)" }}>
                {t.pExampleClose}
              </button>
            </div>

            <div className="px-5 py-5 space-y-5">
              {/* Intro */}
              <p className="text-sm" style={{ color: "var(--w2)" }}>{t.pGuideWorkIntro}</p>

              {/* Doc list */}
              <div className="space-y-2">
                {[t.pGuideWorkDoc1, t.pGuideWorkDoc2, t.pGuideWorkDoc3, t.pGuideWorkDoc4].map((doc, i) => (
                  <div key={i} className="px-4 py-3 rounded-xl"
                    style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                    <div className="flex items-start gap-3">
                      <span className="text-xs font-bold mt-0.5 w-4 flex-shrink-0" style={{ color: "var(--gold)" }}>{i + 1}</span>
                      <p className="text-sm" style={{ color: "var(--w)" }}><B text={doc} /></p>
                    </div>
                    {i === 3 && DEMANDE_EXAMPLE_URL && (
                      <button
                        onClick={() => { setShowWorkGuide(false); setExampleUrl(DEMANDE_EXAMPLE_URL); }}
                        className="bv-row-hover mt-2 ml-7 text-xs px-2.5 py-1 inline-flex items-center gap-1.5"
                        style={{ color: "#4a90d9" }}>
                        <FileText size={11} strokeWidth={1.8} /> {t.pGuideWorkDemandeBtn}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Notes */}
              <div className="rounded-xl px-4 py-3 text-xs"
                style={{ background: "rgba(224,82,82,0.07)", border: "1px solid rgba(224,82,82,0.2)", color: "#e05252" }}>
                <B text={t.pGuideWorkLegalNote} />
              </div>
              <div className="rounded-xl px-4 py-3 text-xs"
                style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)", color: "var(--gold)" }}>
                <B text={t.pGuideWorkDemandeNote} />
              </div>

              {/* Action buttons */}
              <a href={MAPS_URL} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "var(--gold)", color: "#1a1a1a" }}>
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
    </>
  );
}
