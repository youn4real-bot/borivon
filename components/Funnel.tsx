"use client";
import { useState, useEffect, useRef } from "react";
import { Check, PartyPopper, RotateCcw } from "lucide-react";
import { useLang } from "./LangContext";
import { isValidEmail } from "@/lib/utils";
import {
  FS_EYEBROW, FS_NOTE, FS_BACK, FS_SUMMARY, FS_DESC, FS_INPUT,
  FS_LEVEL_NAME, FS_BTN, FS_CHOICE, FS_TITLE, FS_TITLE_SM, FS_LEVEL_CODE,
  SP_INPUT_MB, SP_CHOICE_GAP, SP_EYEBROW_MB, SP_TITLE_MB, SP_SUMMARY_MB,
  PAD_INPUT, PAD_CHOICE, PAD_BTN, PAD_CARD, PAD_SUMMARY,
  FX_CARD_RADIUS, FX_FIELD_RADIUS, FX_BTN_RADIUS,
  CARD_MAX_WIDTH,
} from "@/lib/tokens";

// Funnel resume + step analytics — see useEffect blocks at bottom of Funnel().
const STORAGE_KEY = "bv-funnel-state-v1";
const ANALYTICS_KEY = "bv-funnel-analytics-v1";

type Step =
  | "s0"
  | "s1pi"   // individual intent: courses vs work in germany vs other
  | "s1p"    // language level picker
  | "s1pf"   // work in germany → field selection (Pflege / Trucking / IT / Other)
  | "s1pw"   // work in germany → Pflege only → portal CTA
  | "s2pw"   // work in germany → non-Pflege → contact form
  | "s2gen"  // individual → other → generic contact form
  | "s1o"
  | "s1of"
  | "s2p"
  | "s2o"
  | "s2fk"   // org → Fachkräfte → hiring form
  | "ok";

interface FunnelState {
  type: "person" | "org" | null;
  level: string | null;
  levelName: string | null;
  svc: "courses" | "translation" | "other" | "fachkraefte" | null;
  fmt: "online" | "onsite" | null;
  workField: "pflege" | "trucking" | "it" | "other" | null;
}

// Labels for the new individual-intent steps — kept local like CookieBanner
const intentLabels = {
  fr: {
    // courses vs work
    ey:          "Votre objectif",
    ti:          "Que recherchez-vous ?",
    courses:     "Cours d'allemand",
    work:        "Travailler en Allemagne",
    // field selection
    fieldEy:     "Votre secteur",
    fieldTi:     "Dans quel domaine travaillerez-vous ?",
    pflege:      "Soins infirmiers",
    trucking:    "Camionnage",
    it:          "IT",
    other:       "Autres",
    // portal CTA (Pflege only)
    workEy:      "Portail candidat",
    workTi:      "Créez votre dossier de candidature",
    workDesc:    "Téléchargez vos documents, suivez l'avancement de votre dossier et restez en contact avec notre équipe — tout depuis votre espace personnel sécurisé.",
    workCta:     "Accéder au portail",
    workSub:     "Déjà un compte ? Connectez-vous directement.",
    // contact form (non-Pflege)
    contactEy:   "Nous vous recontactons",
    contactTi:   "Laissez-nous vos coordonnées",
    contactDesc: "Notre équipe vous contactera sous 48 h pour discuter de votre projet.",
    // other / generic
    otherLabel:  "Autre",
    genEy:       "Nous vous recontactons",
    genTi:       "Comment pouvons-nous vous aider ?",
    genDesc:     "Partagez votre demande et notre équipe vous répondra sous 48 h.",
    // Fachkräfte
    fachkraefte: "Fachkräfte",
    fkEy:        "Recrutement international",
    fkTi:        "Trouvez vos Fachkräfte",
    fkDesc:      "Dites-nous vos besoins et nous vous proposerons les meilleurs candidats sous 48 h.",
    fkName:      "Nom du contact",
    fkPhName:    "Votre nom",
    fkSector:    "Secteur recherché",
    fkPhSector:  "Ex. : Soins infirmiers, IT, Logistique…",
    fkPositions: "Nombre de postes",
    fkPhPositions: "Ex. : 3",
    fkCity:      "Ville / région (optionnel)",
    fkPhCity:    "Ex. : Berlin, Munich…",
    fkNote:      "Précisez vos exigences (optionnel)",
    fkPhNote:    "Qualifications, dates, conditions…",
  },
  en: {
    ey:          "Your goal",
    ti:          "What are you looking for?",
    courses:     "German courses",
    work:        "Work in Germany",
    fieldEy:     "Your sector",
    fieldTi:     "Which field will you work in?",
    pflege:      "Nursing",
    trucking:    "Trucking",
    it:          "IT",
    other:       "Others",
    workEy:      "Candidate portal",
    workTi:      "Build your application file",
    workDesc:    "Upload your documents, track the progress of your application, and stay in touch with our team — all from your secure personal space.",
    workCta:     "Go to the portal",
    workSub:     "Already have an account? Log in directly.",
    contactEy:   "We'll be in touch",
    contactTi:   "Leave us your details",
    contactDesc: "Our team will contact you within 48 h to discuss your project.",
    otherLabel:  "Other",
    genEy:       "We'll be in touch",
    genTi:       "How can we help you?",
    genDesc:     "Share your request and our team will get back to you within 48 h.",
    // Fachkräfte
    fachkraefte: "Fachkräfte",
    fkEy:        "International recruitment",
    fkTi:        "Find your Fachkräfte",
    fkDesc:      "Tell us your needs and we'll match you with the best candidates within 48 h.",
    fkName:      "Contact name",
    fkPhName:    "Your name",
    fkSector:    "Sector needed",
    fkPhSector:  "E.g. Nursing, IT, Logistics…",
    fkPositions: "Number of positions",
    fkPhPositions: "E.g. 3",
    fkCity:      "City / region (optional)",
    fkPhCity:    "E.g. Berlin, Munich…",
    fkNote:      "Specific requirements (optional)",
    fkPhNote:    "Qualifications, start dates, conditions…",
  },
  de: {
    ey:          "Ihr Ziel",
    ti:          "Was suchen Sie?",
    courses:     "Deutschkurse",
    work:        "In Deutschland arbeiten",
    fieldEy:     "Ihr Bereich",
    fieldTi:     "In welchem Bereich werden Sie arbeiten?",
    pflege:      "Pflege",
    trucking:    "Trucking",
    it:          "IT",
    other:       "Sonstiges",
    workEy:      "Bewerberportal",
    workTi:      "Erstellen Sie Ihr Bewerbungsdossier",
    workDesc:    "Laden Sie Ihre Unterlagen hoch, verfolgen Sie den Fortschritt Ihrer Bewerbung und bleiben Sie mit unserem Team in Kontakt — alles in Ihrem sicheren persönlichen Bereich.",
    workCta:     "Zum Portal",
    workSub:     "Bereits ein Konto? Direkt einloggen.",
    contactEy:   "Wir melden uns",
    contactTi:   "Hinterlassen Sie Ihre Kontaktdaten",
    contactDesc: "Unser Team wird Sie innerhalb von 48 Stunden kontaktieren.",
    otherLabel:  "Sonstiges",
    genEy:       "Wir melden uns",
    genTi:       "Wie können wir Ihnen helfen?",
    genDesc:     "Teilen Sie uns Ihr Anliegen mit — wir melden uns innerhalb von 48 Stunden.",
    // Fachkräfte
    fachkraefte: "Fachkräfte",
    fkEy:        "Internationale Vermittlung",
    fkTi:        "Finden Sie Ihre Fachkräfte",
    fkDesc:      "Teilen Sie uns Ihren Bedarf mit — wir melden uns innerhalb von 48 Stunden mit passenden Kandidaten.",
    fkName:      "Ansprechpartner",
    fkPhName:    "Ihr Name",
    fkSector:    "Gesuchter Bereich",
    fkPhSector:  "z. B. Pflege, IT, Logistik…",
    fkPositions: "Anzahl der Stellen",
    fkPhPositions: "z. B. 3",
    fkCity:      "Stadt / Region (optional)",
    fkPhCity:    "z. B. Berlin, München…",
    fkNote:      "Besondere Anforderungen (optional)",
    fkPhNote:    "Qualifikationen, Startdatum, Bedingungen…",
  },
};

const LEVELS = [
  { code: "A1", nameKey: "lA1" },
  { code: "A2", nameKey: "lA2" },
  { code: "B1", nameKey: "lB1" },
  { code: "B2", nameKey: "lB2" },
] as const;

/* ── Fluid scale helpers ──────────────────────────────────────── */
// All sizes fluid from ~320px (min) → ~520px+ (max) via clamp

function FunnelInput({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div style={{ marginBottom: SP_INPUT_MB }}>
      <input
        aria-label={label}
        className={["w-full font-[family-name:var(--font-dm-sans)] outline-none transition-colors duration-200", className ?? ""].join(" ")}
        style={{
          fontSize: FS_INPUT,
          padding: PAD_INPUT,
          borderRadius: FX_FIELD_RADIUS,
          background: "var(--bg2)",
          border: "1px solid var(--border2)",
          color: "var(--w)",
        }}
        {...props}
      />
    </div>
  );
}

function FunnelTextarea({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <div style={{ marginBottom: SP_INPUT_MB }}>
      <textarea
        aria-label={label}
        className="w-full font-[family-name:var(--font-dm-sans)] outline-none transition-colors duration-200 resize-y leading-[1.6]"
        style={{
          fontSize: FS_INPUT,
          padding: PAD_INPUT,
          borderRadius: FX_FIELD_RADIUS,
          minHeight: "clamp(52px,13vw,60px)",
          background: "var(--bg2)",
          border: "1px solid var(--border2)",
          color: "var(--w)",
        }}
        {...props}
      />
    </div>
  );
}

function ChoiceRow({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useLang();
  return (
    <button
      onClick={onClick}
      className="choice-lift w-full flex items-center justify-between gap-3 ltr:hover:translate-x-[3px] rtl:hover:-translate-x-[3px] transition-all duration-200 cursor-pointer group text-left"
      style={{
        padding: PAD_CHOICE,
        borderRadius: FX_FIELD_RADIUS,
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        transition: "background 0.2s, border-color 0.2s, transform 0.2s, box-shadow 0.2s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-gold)";
        (e.currentTarget as HTMLElement).style.background = "var(--gdim)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
        (e.currentTarget as HTMLElement).style.background = "var(--bg2)";
      }}
    >
      <span className="fch-lbl font-semibold" style={{ fontSize: FS_CHOICE, color: "var(--w)" }}>
        {label}
      </span>
      <span
        className="transition-colors duration-200 flex-shrink-0 group-hover:translate-x-[2px]"
        style={{ fontSize: "clamp(0.76rem,1.8vw,0.82rem)", color: "var(--w3)" }}
      >
        {t.arr}
      </span>
    </button>
  );
}

function SummaryBadge({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-[0.55rem]"
      style={{
        padding: PAD_SUMMARY,
        marginBottom: SP_SUMMARY_MB,
        borderRadius: FX_FIELD_RADIUS,
        background: "var(--gdim)",
        border: "1px solid var(--border-gold)",
      }}
    >
      <Check size={11} style={{ color: "var(--gold)" }} className="flex-shrink-0" />
      <span className="fsum-txt leading-[1.5]" style={{ fontSize: FS_SUMMARY, color: "var(--w2)" }}>
        {children}
      </span>
    </div>
  );
}

export function Funnel() {
  const { t, lang } = useLang();
  const il = intentLabels[lang] ?? intentLabels.en;
  const [step, setStep] = useState<Step>("s0");
  const [history, setHistory] = useState<Step[]>([]);
  const [state, setState] = useState<FunnelState>({ type: null, level: null, levelName: null, svc: null, fmt: null, workField: null });

  const [personEmail, setPersonEmail] = useState("");
  const [personPhone, setPersonPhone] = useState("");
  const [personMsg, setPersonMsg] = useState("");
  const [orgEmail, setOrgEmail] = useState("");
  const [orgCompany, setOrgCompany] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [workPhone, setWorkPhone] = useState("");
  const [workMsg, setWorkMsg] = useState("");
  // Fachkräfte form
  const [fkName, setFkName]           = useState("");
  const [fkEmail, setFkEmail]         = useState("");
  const [fkPhone, setFkPhone]         = useState("");
  const [fkSector, setFkSector]       = useState("");
  const [fkPositions, setFkPositions] = useState("");
  const [fkCity, setFkCity]           = useState("");
  const [fkNote, setFkNote]           = useState("");
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  // Resume banner — only shown if we restored a saved state on mount
  const [resumeBannerOpen, setResumeBannerOpen] = useState(false);
  const skipPersistOnce = useRef(false);

  // ── Resume — load saved state on mount, offer "Continue" banner ─────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        step: Step; history: Step[]; state: FunnelState;
        personEmail?: string; personPhone?: string; personMsg?: string;
        orgEmail?: string; orgCompany?: string;
        workEmail?: string; workPhone?: string; workMsg?: string;
        ts: number;
      };
      // Don't resume "ok" (already submitted) or stale state >7 days old
      if (saved.step === "ok") return;
      if (Date.now() - saved.ts > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      // If they didn't get past s0, don't bother resuming
      if (saved.step === "s0" && (!saved.history || saved.history.length === 0)) return;

      skipPersistOnce.current = true;
      setStep(saved.step);
      setHistory(saved.history ?? []);
      setState(saved.state ?? { type: null, level: null, levelName: null, svc: null, fmt: null, workField: null });
      if (saved.personEmail)   setPersonEmail(saved.personEmail);
      if (saved.personPhone)   setPersonPhone(saved.personPhone);
      if (saved.personMsg)     setPersonMsg(saved.personMsg);
      if (saved.orgEmail)      setOrgEmail(saved.orgEmail);
      if (saved.orgCompany)    setOrgCompany(saved.orgCompany);
      if (saved.workEmail)     setWorkEmail(saved.workEmail);
      if (saved.workPhone)     setWorkPhone(saved.workPhone);
      if (saved.workMsg)       setWorkMsg(saved.workMsg);
      setResumeBannerOpen(true);
    } catch { /* ignore corrupt saved state */ }
  }, []);

  // ── Persist state on every change ───────────────────────────────────────
  useEffect(() => {
    if (skipPersistOnce.current) { skipPersistOnce.current = false; return; }
    try {
      // Don't persist on s0 with no history (would just be the initial state)
      if (step === "s0" && history.length === 0) return;
      // Don't persist after submission
      if (step === "ok") { localStorage.removeItem(STORAGE_KEY); return; }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        step, history, state, personEmail, personPhone, personMsg, orgEmail, orgCompany,
        workEmail, workPhone, workMsg,
        fkName, fkEmail, fkPhone, fkSector, fkPositions, fkCity, fkNote,
        ts: Date.now(),
      }));
    } catch { /* quota — ignore */ }
  }, [step, history, state, personEmail, personPhone, personMsg, orgEmail, orgCompany, workEmail, workPhone, workMsg, fkName, fkEmail, fkPhone, fkSector, fkPositions, fkCity, fkNote]);

  // ── Lightweight per-step analytics (localStorage — exportable later) ────
  const analyticsLogged = useRef<Set<Step>>(new Set());
  useEffect(() => {
    if (analyticsLogged.current.has(step)) return;
    analyticsLogged.current.add(step);
    try {
      const raw = localStorage.getItem(ANALYTICS_KEY);
      let log: { step: Step; ts: number }[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) log = parsed;
        } catch {
          // Corrupt data — drop it and start fresh so we self-heal instead
          // of failing forever on the same bad blob.
          log = [];
        }
      }
      log.push({ step, ts: Date.now() });
      // Cap at last 500 events to avoid quota issues
      if (log.length > 500) log.splice(0, log.length - 500);
      localStorage.setItem(ANALYTICS_KEY, JSON.stringify(log));
    } catch { /* quota or unavailable — ignore */ }
  }, [step]);

  const restartFunnel = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setHistory([]); setStep("s0");
    setState({ type: null, level: null, levelName: null, svc: null, fmt: null, workField: null });
    setPersonEmail(""); setPersonPhone(""); setPersonMsg("");
    setOrgEmail(""); setOrgCompany("");
    setWorkEmail(""); setWorkPhone(""); setWorkMsg("");
    setErrors({});
    setResumeBannerOpen(false);
  };

  const goTo = (s: Step) => { setHistory((h) => [...h, step]); setStep(s); };
  const goBack = () => { setHistory((h) => { const prev = [...h]; const last = prev.pop()!; setStep(last); return prev; }); };

  // Track in-flight submission so a slow network doesn't allow double-fire.
  const [submitting, setSubmitting] = useState(false);

  const submitPerson = async () => {
    const errs: Record<string, boolean> = {};
    if (!isValidEmail(personEmail)) errs.email = true;
    if (!personPhone.trim()) errs.phone = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }
    if (submitting) return;
    setSubmitting(true);
    try {
      // Persist the lead. Even on failure we still flip to "ok" so the
      // visitor doesn't see a confusing red error after filling the form —
      // but we DO log non-2xx so the operator notices outages instead of
      // silently losing leads. (`fetch` only rejects on network errors,
      // not HTTP status codes, so `.catch` alone wasn't enough.)
      const payload = {
        kind: "person",
        email: personEmail,
        level: state.levelName ?? state.level ?? null,
        phone: personPhone,
        message: personMsg,
      };
      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          console.error("[lead person] non-2xx", res.status, await res.text().catch(() => ""));
          // Stash for later retry so the lead isn't lost on a backend blip.
          try { localStorage.setItem(`bv-lead-retry-${Date.now()}`, JSON.stringify(payload)); } catch { /* ignore */ }
        }
      } catch (err) {
        console.error("[lead person] network", err);
        try { localStorage.setItem(`bv-lead-retry-${Date.now()}`, JSON.stringify(payload)); } catch { /* ignore */ }
      }
    } finally {
      setSubmitting(false);
      setHistory([]); setStep("ok");
    }
  };

  const submitOrg = async () => {
    if (!isValidEmail(orgEmail)) { setErrors({ orgEmail: true }); return; }
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        kind: "org",
        email: orgEmail,
        company: orgCompany,
        service: state.svc,
        format: state.fmt,
      };
      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          console.error("[lead org] non-2xx", res.status, await res.text().catch(() => ""));
          try { localStorage.setItem(`bv-lead-retry-${Date.now()}`, JSON.stringify(payload)); } catch { /* ignore */ }
        }
      } catch (err) {
        console.error("[lead org] network", err);
        try { localStorage.setItem(`bv-lead-retry-${Date.now()}`, JSON.stringify(payload)); } catch { /* ignore */ }
      }
    } finally {
      setSubmitting(false);
      setHistory([]); setStep("ok");
    }
  };

  const submitWork = async () => {
    const errs: Record<string, boolean> = {};
    if (!isValidEmail(workEmail)) errs.workEmail = true;
    if (!workPhone.trim()) errs.workPhone = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        kind: "work",
        field: state.workField,
        email: workEmail,
        phone: workPhone,
        message: workMsg,
      };
      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          console.error("[lead work] non-2xx", res.status, await res.text().catch(() => ""));
          try { localStorage.setItem(`bv-lead-retry-${Date.now()}`, JSON.stringify(payload)); } catch { /* ignore */ }
        }
      } catch (err) {
        console.error("[lead work] network", err);
        try { localStorage.setItem(`bv-lead-retry-${Date.now()}`, JSON.stringify(payload)); } catch { /* ignore */ }
      }
    } finally {
      setSubmitting(false);
      setHistory([]); setStep("ok");
    }
  };

  const submitGen = async () => {
    const errs: Record<string, boolean> = {};
    if (!isValidEmail(workEmail)) errs.workEmail = true;
    if (!workPhone.trim()) errs.workPhone = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = { kind: "general", email: workEmail, phone: workPhone, message: workMsg };
      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          console.error("[lead general] non-2xx", res.status, await res.text().catch(() => ""));
          try { localStorage.setItem(`bv-lead-retry-${Date.now()}`, JSON.stringify(payload)); } catch { /* ignore */ }
        }
      } catch (err) {
        console.error("[lead general] network", err);
        try { localStorage.setItem(`bv-lead-retry-${Date.now()}`, JSON.stringify(payload)); } catch { /* ignore */ }
      }
    } finally {
      setSubmitting(false);
      setHistory([]); setStep("ok");
    }
  };

  const submitFachkraefte = async () => {
    const errs: Record<string, boolean> = {};
    if (!isValidEmail(fkEmail)) errs.fkEmail = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        kind: "fachkraefte",
        name: fkName, email: fkEmail, phone: fkPhone,
        sector: fkSector, positions: fkPositions, city: fkCity, message: fkNote,
      };
      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          console.error("[lead fachkraefte] non-2xx", res.status, await res.text().catch(() => ""));
          try { localStorage.setItem(`bv-lead-retry-${Date.now()}`, JSON.stringify(payload)); } catch { /* ignore */ }
        }
      } catch (err) {
        console.error("[lead fachkraefte] network", err);
        try { localStorage.setItem(`bv-lead-retry-${Date.now()}`, JSON.stringify(payload)); } catch { /* ignore */ }
      }
    } finally {
      setSubmitting(false);
      setHistory([]); setStep("ok");
    }
  };

  const orgSummaryParts = [
    t.sumBase,
    state.svc === "courses" ? t.sumSvcCourses : state.svc === "translation" ? t.sumSvcTranslation : state.svc === "other" ? t.sumSvcOther : null,
    state.fmt === "online" ? t.sumFmtOnline : state.fmt === "onsite" ? t.sumFmtOnsite : null,
  ].filter(Boolean).join(" · ");

  const stepClass = "animate-[slideUp_.28s_cubic-bezier(.4,0,.2,1)_both]";

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        maxWidth: CARD_MAX_WIDTH,
        borderRadius: FX_CARD_RADIUS,
        padding: PAD_CARD,
        background: "var(--card)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-card)",
        transition: "background 0.4s, border-color 0.4s, box-shadow 0.4s",
      }}
    >
      {/* Resume banner — shown only if we restored a saved partial state */}
      {resumeBannerOpen && step !== "ok" && (
        <div className="mb-4 flex items-center gap-2.5 px-3 py-2"
          style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-sm)" }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--gold)" }} />
          <p className="text-[11.5px] flex-1" style={{ color: "var(--w2)" }}>
            {lang === "fr" ? "Reprise là où vous étiez" : lang === "de" ? "Weiter, wo Sie aufgehört haben" : "Picking up where you left off"}
          </p>
          <button onClick={restartFunnel}
            className="bv-row-hover inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1"
            style={{ color: "var(--w3)" }}>
            <RotateCcw size={10} strokeWidth={1.8} />
            {lang === "fr" ? "Recommencer" : lang === "de" ? "Neu starten" : "Restart"}
          </button>
        </div>
      )}
      {/* Gold top accent line */}
      <div
        className="absolute top-[-1px] left-0 right-0 h-[2px] opacity-60"
        style={{ background: "linear-gradient(to right, transparent, var(--gold), transparent)" }}
      />

      {/* Back button */}
      {history.length > 0 && step !== "ok" && (
        <button
          onClick={goBack}
          className="bv-row-hover flex items-center gap-[0.4rem] font-medium cursor-pointer px-2 py-1"
          style={{
            fontSize: FS_BACK,
            marginBottom: "clamp(0.75rem,2.5vw,1rem)",
            color: "var(--w3)",
          }}
        >
          <span>{t.bArr}</span>
          {t.backLabel}
        </button>
      )}

      {/* ── S0: person or org ── */}
      {step === "s0" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: SP_EYEBROW_MB }}>{t.s0ey}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: SP_TITLE_MB }}>
            {t.s0ti}
          </h2>
          <div className="flex flex-col" style={{ gap: SP_CHOICE_GAP }}>
            <ChoiceRow label={t.cInd} onClick={() => { setState((s) => ({ ...s, type: "person" })); goTo("s1pi"); }} />
            <ChoiceRow label={t.cOrg} onClick={() => { setState((s) => ({ ...s, type: "org" })); goTo("s1o"); }} />
          </div>
        </div>
      )}

      {/* ── S1pi: individual intent — courses or work in Germany ── */}
      {step === "s1pi" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: SP_EYEBROW_MB }}>{il.ey}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: SP_TITLE_MB }}>
            {il.ti}
          </h2>
          <div className="flex flex-col" style={{ gap: SP_CHOICE_GAP }}>
            <ChoiceRow label={il.courses}    onClick={() => goTo("s1p")} />
            <ChoiceRow label={il.work}       onClick={() => goTo("s1pf")} />
            <ChoiceRow label={il.otherLabel} onClick={() => goTo("s2gen")} />
          </div>
        </div>
      )}

      {/* ── S1pf: work in Germany → field selection ── */}
      {step === "s1pf" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: SP_EYEBROW_MB }}>{il.fieldEy}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: SP_TITLE_MB }}>
            {il.fieldTi}
          </h2>
          <div className="flex flex-col" style={{ gap: SP_CHOICE_GAP }}>
            <ChoiceRow label={il.pflege}   onClick={() => { setState((s) => ({ ...s, workField: "pflege" }));   goTo("s2pw"); }} />
            <ChoiceRow label={il.trucking} onClick={() => { setState((s) => ({ ...s, workField: "trucking" })); goTo("s2pw"); }} />
            <ChoiceRow label={il.it}       onClick={() => { setState((s) => ({ ...s, workField: "it" }));       goTo("s2pw"); }} />
            <ChoiceRow label={il.other}    onClick={() => { setState((s) => ({ ...s, workField: "other" }));    goTo("s2pw"); }} />
          </div>
        </div>
      )}

      {/* ── S2pw: non-Pflege work → contact form ── */}
      {step === "s2pw" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: "clamp(0.4rem,1.2vw,0.55rem)" }}>{il.contactEy}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: "clamp(0.4rem,1.2vw,0.6rem)" }}>
            {il.contactTi}
          </h2>
          <p className="leading-[1.7]" style={{ fontSize: FS_DESC, color: "var(--w2)", marginBottom: SP_TITLE_MB }}>
            {il.contactDesc}
          </p>
          <SummaryBadge>
            {il.work} &nbsp;·&nbsp; <strong style={{ color: "var(--gold)", fontWeight: 600 }}>{il[state.workField ?? "other"]}</strong>
          </SummaryBadge>
          <FunnelInput
            label={t.lblEmail} type="email" required
            value={workEmail}
            onChange={(e) => { setWorkEmail(e.target.value); setErrors((er) => ({ ...er, workEmail: false })); }}
            placeholder={t.phEmail}
            className={errors.workEmail ? "!border-red-500/70 !bg-red-500/[0.04]" : ""}
          />
          <FunnelInput
            label={t.lblPhone} type="tel" required
            value={workPhone}
            onChange={(e) => { setWorkPhone(e.target.value); setErrors((er) => ({ ...er, workPhone: false })); }}
            placeholder={t.phPhone}
            className={errors.workPhone ? "!border-red-500/70 !bg-red-500/[0.04]" : ""}
          />
          <FunnelTextarea
            label={`${t.lblMsg} ${t.lblOpt}`}
            value={workMsg}
            onChange={(e) => setWorkMsg(e.target.value)}
            placeholder={t.phMsg}
          />
          <button
            onClick={submitWork}
            disabled={submitting}
            className="fsbtn w-full font-bold cursor-pointer active:scale-[0.98] border-none"
            style={{
              fontSize: FS_BTN,
              padding: PAD_BTN,
              marginTop: "clamp(0.08rem,0.4vw,0.12rem)",
              background: "var(--gold-gradient)",
              color: "#09090a",
              borderRadius: FX_BTN_RADIUS,
              boxShadow: "var(--shadow-gold-md)",
              transition: "box-shadow 0.2s, transform 0.1s",
              opacity: submitting ? 0.7 : 1,
            }}
            onMouseEnter={(e) => { if (!submitting) (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-hover)"; }}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-md)")}
          >
            {t.sbtnP}
          </button>
          <p
            className="fpnote text-center mt-[0.4rem] leading-[1.5]"
            style={{ fontSize: FS_NOTE, color: "var(--w3)" }}
          >
            {t.pnote}
          </p>
        </div>
      )}

      {/* ── S1pw: work in Germany → portal CTA ── */}
      {step === "s1pw" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: SP_EYEBROW_MB }}>{il.workEy}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE_SM, color: "var(--w)", marginBottom: "clamp(0.9rem,2.5vw,1.2rem)" }}>
            {il.workTi}
          </h2>
          <button
            onClick={() => window.dispatchEvent(new Event("bv:open-auth"))}
            className="fsbtn w-full font-bold cursor-pointer active:scale-[0.98] border-none"
            style={{
              fontSize: FS_BTN,
              padding: PAD_BTN,
              background: "var(--gold-gradient)",
              color: "#09090a",
              borderRadius: FX_BTN_RADIUS,
              boxShadow: "var(--shadow-gold-md)",
              transition: "box-shadow 0.2s, transform 0.1s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-hover)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-md)")}
          >
            {il.workCta}
          </button>
        </div>
      )}

      {/* ── S1p: level ── */}
      {step === "s1p" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: "clamp(0.4rem,1.2vw,0.55rem)" }}>{t.s1ey}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: SP_TITLE_MB }}>
            {t.s1ti}
          </h2>
          <div className="grid grid-cols-2" style={{ gap: SP_CHOICE_GAP }}>
            {LEVELS.map((lv) => (
              <button
                key={lv.code}
                onClick={() => { setState((s) => ({ ...s, level: lv.code, levelName: t[lv.nameKey] })); goTo("s2p"); }}
                className="rounded-[10px] text-center cursor-pointer group"
                style={{
                  padding: "clamp(0.75rem,2vw,0.9rem) clamp(0.6rem,1.6vw,0.72rem) clamp(0.65rem,1.6vw,0.76rem)",
                  background: "var(--bg2)",
                  border: "1px solid var(--border)",
                  transition: "background 0.2s, border-color 0.2s, transform 0.2s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--gold)";
                  (e.currentTarget as HTMLElement).style.background = "var(--gdim)";
                  (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                  (e.currentTarget as HTMLElement).style.background = "var(--bg2)";
                  (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                }}
              >
                <div
                  className="font-semibold leading-none tracking-tight"
                  style={{ fontSize: FS_LEVEL_CODE, color: "var(--gold)", marginBottom: "0.2rem" }}
                >
                  {lv.code}
                </div>
                <div
                  className="flc-name font-semibold tracking-[0.07em] uppercase"
                  style={{ fontSize: FS_LEVEL_NAME, color: "var(--w3)" }}
                >
                  {t[lv.nameKey]}
                </div>
              </button>
            ))}
            <button
              onClick={() => { setState((s) => ({ ...s, level: "?", levelName: t.lNs })); goTo("s2p"); }}
              className="col-span-2 rounded-[10px] flex items-center justify-center cursor-pointer group"
              style={{
                gap: "0.4rem",
                padding: "clamp(0.6rem,1.6vw,0.68rem) clamp(0.7rem,2vw,0.78rem)",
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                transition: "background 0.2s, border-color 0.2s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--gold)";
                (e.currentTarget as HTMLElement).style.background = "var(--gdim)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLElement).style.background = "var(--bg2)";
              }}
            >
              <span
                className="font-semibold"
                style={{ fontSize: "clamp(0.95rem,2.4vw,1.1rem)", color: "var(--gold)" }}
              >
                ?
              </span>
              <span style={{ fontSize: "clamp(0.78rem,1.8vw,0.82rem)", color: "var(--w2)" }}>{t.lNs}</span>
            </button>
          </div>
        </div>
      )}

      {/* ── S1o: org service ── */}
      {step === "s1o" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: "clamp(0.4rem,1.2vw,0.55rem)" }}>{t.s1oEy}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: SP_TITLE_MB }}>
            {t.s1oTi}
          </h2>
          <div className="flex flex-col" style={{ gap: SP_CHOICE_GAP }}>
            <ChoiceRow label={t.coS1} onClick={() => { setState((s) => ({ ...s, svc: "courses" })); goTo("s1of"); }} />
            <ChoiceRow label={t.coS2} onClick={() => { setState((s) => ({ ...s, svc: "translation" })); goTo("s2o"); }} />
            <ChoiceRow label={il.fachkraefte} onClick={() => { setState((s) => ({ ...s, svc: "fachkraefte" })); goTo("s2fk"); }} />
            <ChoiceRow label={t.coS3} onClick={() => { setState((s) => ({ ...s, svc: "other" })); goTo("s2o"); }} />
          </div>
        </div>
      )}

      {/* ── S1of: org format ── */}
      {step === "s1of" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: "clamp(0.4rem,1.2vw,0.55rem)" }}>{t.s1ofEy}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: SP_TITLE_MB }}>
            {t.s1ofTi}
          </h2>
          <div className="flex flex-col" style={{ gap: SP_CHOICE_GAP }}>
            <ChoiceRow label={t.coF1} onClick={() => { setState((s) => ({ ...s, fmt: "online" })); goTo("s2o"); }} />
            <ChoiceRow label={t.coF2} onClick={() => { setState((s) => ({ ...s, fmt: "onsite" })); goTo("s2o"); }} />
          </div>
        </div>
      )}

      {/* ── S2p: person form ── */}
      {step === "s2p" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: "clamp(0.4rem,1.2vw,0.55rem)" }}>{t.s2pEy}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: SP_TITLE_MB }}>
            {t.s2pTi}
          </h2>
          <SummaryBadge>
            {t.cInd} &nbsp;·&nbsp; <strong style={{ color: "var(--gold)", fontWeight: 600 }}>{t.sumLevelLabel} {state.level} — {state.levelName}</strong>
          </SummaryBadge>
          <FunnelInput
            label={t.lblEmail} type="email" required
            value={personEmail}
            onChange={(e) => { setPersonEmail(e.target.value); setErrors((er) => ({ ...er, email: false })); }}
            placeholder={t.phEmail}
            className={errors.email ? "!border-red-500/70 !bg-red-500/[0.04]" : ""}
          />
          <FunnelInput
            label={t.lblPhone} type="tel" required
            value={personPhone}
            onChange={(e) => { setPersonPhone(e.target.value); setErrors((er) => ({ ...er, phone: false })); }}
            placeholder={t.phPhone}
            className={errors.phone ? "!border-red-500/70 !bg-red-500/[0.04]" : ""}
          />
          <FunnelTextarea
            label={`${t.lblMsg} ${t.lblOpt}`}
            value={personMsg}
            onChange={(e) => setPersonMsg(e.target.value)}
            placeholder={t.phMsg}
          />
          <button
            onClick={submitPerson}
            className="fsbtn w-full rounded-[10px] font-bold cursor-pointer active:scale-[0.98] border-none"
            style={{
              fontSize: FS_BTN,
              padding: PAD_BTN,
              marginTop: "clamp(0.08rem,0.4vw,0.12rem)",
              background: "var(--gold-gradient)",
              color: "#09090a",
              transition: "box-shadow 0.2s, transform 0.1s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-hover)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "none")}
          >
            {t.sbtnP}
          </button>
          <p
            className="fpnote text-center mt-[0.4rem] leading-[1.5]"
            style={{ fontSize: FS_NOTE, color: "var(--w3)" }}
          >
            {t.pnote}
          </p>
        </div>
      )}

      {/* ── S2o: org form ── */}
      {step === "s2o" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: "clamp(0.4rem,1.2vw,0.55rem)" }}>{t.s2oEy}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: SP_TITLE_MB }}>
            {t.s2oTi}
          </h2>
          <SummaryBadge>
            <span style={{ color: "var(--gold)", fontWeight: 600 }}>{orgSummaryParts}</span>
          </SummaryBadge>
          <FunnelInput
            label={`${t.lblCompany} ${t.lblOpt}`} type="text"
            value={orgCompany}
            onChange={(e) => setOrgCompany(e.target.value)}
            placeholder={t.phCompany}
          />
          <FunnelInput
            label={t.lblWorkEmail} type="email" required
            value={orgEmail}
            onChange={(e) => { setOrgEmail(e.target.value); setErrors((er) => ({ ...er, orgEmail: false })); }}
            placeholder={t.phWorkEmail}
            className={errors.orgEmail ? "!border-red-500/70 !bg-red-500/[0.04]" : ""}
          />
          <button
            onClick={submitOrg}
            className="fsbtn w-full rounded-[10px] font-bold cursor-pointer active:scale-[0.98] border-none"
            style={{
              fontSize: FS_BTN,
              padding: PAD_BTN,
              marginTop: "clamp(0.08rem,0.4vw,0.12rem)",
              background: "var(--gold-gradient)",
              color: "#09090a",
              transition: "box-shadow 0.2s, transform 0.1s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-hover)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "none")}
          >
            {t.sbtnO}
          </button>
          <p
            className="fpnote text-center mt-[0.4rem] leading-[1.5]"
            style={{ fontSize: FS_NOTE, color: "var(--w3)" }}
          >
            {t.pnote}
          </p>
        </div>
      )}

      {/* ── S2gen: individual → other → generic contact form ── */}
      {step === "s2gen" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: "clamp(0.4rem,1.2vw,0.55rem)" }}>{il.genEy}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: "clamp(0.4rem,1.2vw,0.6rem)" }}>
            {il.genTi}
          </h2>
          <p className="leading-[1.7]" style={{ fontSize: FS_DESC, color: "var(--w2)", marginBottom: SP_TITLE_MB }}>
            {il.genDesc}
          </p>
          <FunnelInput
            label={t.lblEmail} type="email" required
            value={workEmail}
            onChange={(e) => { setWorkEmail(e.target.value); setErrors((er) => ({ ...er, workEmail: false })); }}
            placeholder={t.phEmail}
            className={errors.workEmail ? "!border-red-500/70 !bg-red-500/[0.04]" : ""}
          />
          <FunnelInput
            label={t.lblPhone} type="tel" required
            value={workPhone}
            onChange={(e) => { setWorkPhone(e.target.value); setErrors((er) => ({ ...er, workPhone: false })); }}
            placeholder={t.phPhone}
            className={errors.workPhone ? "!border-red-500/70 !bg-red-500/[0.04]" : ""}
          />
          <FunnelTextarea
            label={`${t.lblMsg} ${t.lblOpt}`}
            value={workMsg}
            onChange={(e) => setWorkMsg(e.target.value)}
            placeholder={t.phMsg}
          />
          <button
            onClick={submitGen}
            disabled={submitting}
            className="fsbtn w-full font-bold cursor-pointer active:scale-[0.98] border-none"
            style={{
              fontSize: FS_BTN,
              padding: PAD_BTN,
              marginTop: "clamp(0.08rem,0.4vw,0.12rem)",
              background: "var(--gold-gradient)",
              color: "#09090a",
              borderRadius: FX_BTN_RADIUS,
              boxShadow: "var(--shadow-gold-md)",
              transition: "box-shadow 0.2s, transform 0.1s",
              opacity: submitting ? 0.7 : 1,
            }}
            onMouseEnter={(e) => { if (!submitting) (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-hover)"; }}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-md)")}
          >
            {t.sbtnP}
          </button>
          <p
            className="fpnote text-center mt-[0.4rem] leading-[1.5]"
            style={{ fontSize: FS_NOTE, color: "var(--w3)" }}
          >
            {t.pnote}
          </p>
        </div>
      )}

      {/* ── S2fk: org → Fachkräfte hiring form ── */}
      {step === "s2fk" && (
        <div className={stepClass}>
          <p className="fey font-semibold tracking-[0.22em] uppercase" style={{ fontSize: FS_EYEBROW, color: "var(--gold)", marginBottom: "clamp(0.4rem,1.2vw,0.55rem)" }}>{il.fkEy}</p>
          <h2 className="fti font-medium leading-[1.15] tracking-[-0.02em]" style={{ fontSize: FS_TITLE, color: "var(--w)", marginBottom: "clamp(0.4rem,1.2vw,0.6rem)" }}>
            {il.fkTi}
          </h2>
          <p className="leading-[1.7]" style={{ fontSize: FS_DESC, color: "var(--w2)", marginBottom: SP_TITLE_MB }}>
            {il.fkDesc}
          </p>
          {/* Contact name */}
          <FunnelInput
            label={il.fkName} type="text"
            value={fkName}
            onChange={(e) => setFkName(e.target.value)}
            placeholder={il.fkPhName}
          />
          {/* Email — required */}
          <FunnelInput
            label={t.lblEmail} type="email" required
            value={fkEmail}
            onChange={(e) => { setFkEmail(e.target.value); setErrors((er) => ({ ...er, fkEmail: false })); }}
            placeholder={t.phEmail}
            className={errors.fkEmail ? "!border-red-500/70 !bg-red-500/[0.04]" : ""}
          />
          {/* Phone */}
          <FunnelInput
            label={t.lblPhone} type="tel"
            value={fkPhone}
            onChange={(e) => setFkPhone(e.target.value)}
            placeholder={t.phPhone}
          />
          {/* Sector */}
          <FunnelInput
            label={il.fkSector} type="text"
            value={fkSector}
            onChange={(e) => setFkSector(e.target.value)}
            placeholder={il.fkPhSector}
          />
          {/* Positions + City — side by side */}
          <div className="flex gap-2" style={{ marginBottom: SP_INPUT_MB }}>
            <div className="flex-1">
              <input
                aria-label={il.fkPositions}
                type="number" min="1"
                value={fkPositions}
                onChange={(e) => setFkPositions(e.target.value)}
                placeholder={il.fkPhPositions}
                className="w-full font-[family-name:var(--font-dm-sans)] outline-none transition-colors duration-200"
                style={{ fontSize: FS_INPUT, padding: PAD_INPUT, borderRadius: FX_FIELD_RADIUS, background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }}
              />
            </div>
            <div className="flex-1">
              <input
                aria-label={il.fkCity}
                type="text"
                value={fkCity}
                onChange={(e) => setFkCity(e.target.value)}
                placeholder={il.fkPhCity}
                className="w-full font-[family-name:var(--font-dm-sans)] outline-none transition-colors duration-200"
                style={{ fontSize: FS_INPUT, padding: PAD_INPUT, borderRadius: FX_FIELD_RADIUS, background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }}
              />
            </div>
          </div>
          {/* Notes */}
          <FunnelTextarea
            label={il.fkNote}
            value={fkNote}
            onChange={(e) => setFkNote(e.target.value)}
            placeholder={il.fkPhNote}
          />
          <button
            onClick={submitFachkraefte}
            disabled={submitting}
            className="fsbtn w-full font-bold cursor-pointer active:scale-[0.98] border-none"
            style={{
              fontSize: FS_BTN,
              padding: PAD_BTN,
              marginTop: "clamp(0.08rem,0.4vw,0.12rem)",
              background: "var(--gold-gradient)",
              color: "#09090a",
              borderRadius: FX_BTN_RADIUS,
              boxShadow: "var(--shadow-gold-md)",
              transition: "box-shadow 0.2s, transform 0.1s",
              opacity: submitting ? 0.7 : 1,
            }}
            onMouseEnter={(e) => { if (!submitting) (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-hover)"; }}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-md)")}
          >
            {t.sbtnO}
          </button>
          <p className="fpnote text-center mt-[0.4rem] leading-[1.5]" style={{ fontSize: FS_NOTE, color: "var(--w3)" }}>
            {t.pnote}
          </p>
        </div>
      )}

      {/* ── SUCCESS ── */}
      {step === "ok" && (
        <div className={`${stepClass} text-center py-2`}>
          <div
            className="rounded-full flex items-center justify-center mx-auto"
            style={{
              width: "clamp(38px,10vw,48px)",
              height: "clamp(38px,10vw,48px)",
              marginBottom: "clamp(0.65rem,2.5vw,0.9rem)",
              background: "var(--gdim)",
              border: "1px solid var(--border-gold)",
              color: "var(--gold)",
            }}
          >
            <PartyPopper size={22} strokeWidth={1.6} />
          </div>
          <p
            className="fey font-semibold tracking-[0.25em] uppercase"
            style={{ fontSize: "clamp(0.54rem,1.3vw,0.62rem)", color: "var(--gold)", marginBottom: "clamp(0.5rem,2vw,0.75rem)" }}
          >
            {t.okEy}
          </p>
          <h2
            className="fti font-medium leading-[1.12] tracking-[-0.02em]"
            style={{ fontSize: "clamp(1.25rem,3.5vw,1.85rem)", color: "var(--w)", marginBottom: "clamp(0.4rem,1.5vw,0.55rem)" }}
          >
            {t.okTi}
          </h2>
          <p className="leading-[1.8] max-w-[300px] mx-auto" style={{ fontSize: "clamp(0.78rem,2vw,0.86rem)", color: "var(--w2)" }}>
            {t.okSub}
          </p>
        </div>
      )}
    </div>
  );
}
