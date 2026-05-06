/**
 * Candidate journey-stage view — shared between the candidate dashboard and
 * the admin pipeline editor (admin-side preview pane).
 *
 * Same render path everywhere = admin sees exactly what the candidate sees
 * for the current pipeline state. No more "what does this look like for them?"
 * guessing.
 *
 * Used by:
 *   - app/portal/dashboard/page.tsx — candidate's own journey view
 *   - app/portal/admin/page.tsx     — admin pipeline editor preview pane
 */

import * as React from "react";
import {
  PhaseIcon,
  Lock, Mail, Calendar, ExternalLink, PartyPopper,
} from "@/components/PortalIcons";
import type { Translation } from "@/lib/translations";

export type JourneyMode = "interview" | "recognition" | "embassy" | "visa" | "flight" | "visum" | "reise" | "integration" | "start";

/**
 * Pipeline shape — must stay in sync with both:
 *   - candidate dashboard's local `Pipeline` type
 *   - admin's `AdminPipeline` type (slightly larger; we only use the journey fields here)
 */
export type JourneyPipeline = {
  interview_link?: string | null;
  interview_date?: string | null;
  interview_status?: string | null;
  recognition_unlocked?: boolean;
  embassy_unlocked?: boolean;
  visa_granted?: boolean;
  visa_date?: string | null;
  flight_date?: string | null;
  flight_info?: string | null;
  docs_approved?: boolean;
  integration_unlocked?: boolean | null;
  start_unlocked?: boolean | null;
};

// ── Derive the current blocker for a locked stage ──────────────────────────
type Blocker = "docs" | "interview" | "recognition" | "embassy" | "visa";
function getBlocker(mode: JourneyMode, p: JourneyPipeline | null): Blocker | null {
  if (!p) return "docs";
  if (mode === "interview")   return p.docs_approved ? null : "docs";
  if (mode === "recognition") return p.interview_status === "passed" ? null : "interview";
  if (mode === "embassy")     return p.recognition_unlocked ? null : "recognition";
  if (mode === "visa")        return p.embassy_unlocked ? null : "embassy";
  if (mode === "flight")      return p.visa_granted ? null : "visa";
  if (mode === "visum")       return p.recognition_unlocked ? null : "recognition";
  if (mode === "reise")       return p.visa_granted ? null : "visa";
  if (mode === "integration") return null;
  if (mode === "start")       return null;
  return null;
}
function blockerLabel(b: Blocker, lang: "fr"|"en"|"de"): string {
  const m = {
    docs:        { fr: "Documents",  en: "Documents",  de: "Dokumente" },
    interview:   { fr: "Entretien",  en: "Interview",  de: "Gespräch" },
    recognition: { fr: "Traitement", en: "Processing", de: "Bearbeitung" },
    embassy:     { fr: "Ambassade",  en: "Embassy",    de: "Botschaft" },
    visa:        { fr: "Visa",       en: "Visa",       de: "Visum" },
  };
  return m[b][lang] ?? m[b].en;
}
function blockerHint(b: Blocker, lang: "fr"|"en"|"de"): string {
  const m = {
    docs: {
      fr: "Téléversez tous vos documents et attendez leur validation.",
      en: "Upload all your documents and wait for them to be reviewed.",
      de: "Laden Sie alle Dokumente hoch und warten Sie auf die Prüfung.",
    },
    interview: {
      fr: "Votre conseiller programme votre entretien.",
      en: "Your case manager is scheduling your interview.",
      de: "Ihr Berater plant Ihr Gespräch.",
    },
    recognition: {
      fr: "Votre dossier de reconnaissance est en cours de traitement.",
      en: "Your recognition file is being processed.",
      de: "Ihre Anerkennungsakte wird bearbeitet.",
    },
    embassy: {
      fr: "Votre rendez-vous à l'ambassade est en préparation.",
      en: "Your embassy appointment is being arranged.",
      de: "Ihr Botschaftstermin wird vorbereitet.",
    },
    visa: {
      fr: "Votre visa est en cours d'examen.",
      en: "Your visa is being processed.",
      de: "Ihr Visum wird bearbeitet.",
    },
  };
  return m[b][lang] ?? m[b].en;
}

// Premium-feel surface — same language as CV builder's SectionCard:
// 20px rounded, var(--card) background, soft 1px shadow (no hard border).
// All journey stages share this so locked / scheduled / passed / failed
// states all read as one consistent surface family.
const cardSt: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: "20px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

// Reusable hero icon — quiet circle, gold tint, line icon inside.
function HeroIcon({
  Icon, tone = "neutral",
}: {
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
  tone?: "neutral" | "success" | "danger";
}) {
  const tones = {
    neutral: { bg: "var(--gdim)",            color: "var(--gold)", border: "var(--border-gold)" },
    success: { bg: "var(--success-bg)",   color: "var(--success)",     border: "var(--success-border)" },
    danger:  { bg: "var(--danger-bg)",   color: "var(--danger)",     border: "var(--danger-border)" },
  }[tone];
  return (
    <span className="mx-auto mb-4 flex items-center justify-center w-12 h-12 rounded-full"
      style={{ background: tones.bg, border: `1px solid ${tones.border}` }}>
      <Icon size={22} strokeWidth={1.6} color={tones.color} />
    </span>
  );
}

// ── Recognition / Embassy doc reference lists ───────────────────────────────
const recogDocs = {
  bfv: [
    "Beschleunigtes Fachkräfteverfahren (BFV) — employment commitment letter from employer",
    "Valid passport (≥ 6 months validity)",
    "Language certificate B2 (Goethe / TestDaF / telc)",
    "Nursing diploma + certified German translation",
  ],
  standard: [
    "Anerkennungsantrag (recognition application form)",
    "Nursing diploma — certified copy + apostille",
    "Study programme — certified copy + certified translation",
    "Transcripts — certified copy + certified translation",
    "Proof of professional experience (if applicable)",
    "Criminal record certificate (equivalent of Führungszeugnis)",
    "Passport copy",
    "Biometric passport photos (2–3)",
  ],
  uksh: [
    "UKSH employment contract (signed)",
    "Vaccination records (Impfpass) — Hepatitis B, MMR, Varicella, COVID-19",
    "UKSH-specific forms (provided by UKSH HR)",
    "Health certificate",
  ],
};

const embassyDocs = [
  "Filled German national visa application form (Antrag auf Erteilung eines nationalen Visums)",
  "Biometric passport photos (2–3, 35×45 mm)",
  "Valid passport (original + copy)",
  "BFV / recognition decision letter",
  "Employment contract / commitment letter",
  "Language certificate B2",
  "Proof of nursing qualification (translated)",
  "Health insurance certificate for Germany",
  "TLS / embassy appointment confirmation",
];

// ── Single-stage renderer (shared kernel) ───────────────────────────────────
function StageContent({ mode, p, t, lang = "en" }: { mode: JourneyMode; p: JourneyPipeline | null; t: Translation; lang?: "fr"|"en"|"de" }) {
  const lockCard = (msg: string) => {
    const blocker = getBlocker(mode, p);
    return (
      <div className="rounded-2xl px-5 py-9 text-center" style={cardSt}>
        <HeroIcon Icon={Lock} tone="neutral" />
        <p className="text-sm font-semibold mb-1" style={{ color: "var(--w)" }}>{t.pJourneyLocked}</p>
        <p className="text-xs leading-relaxed max-w-xs mx-auto" style={{ color: "var(--w3)" }}>{msg}</p>
        {blocker && (
          <div className="mt-5 mx-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--gold)", animation: "pls 2s ease-in-out infinite" }} />
            <p className="text-[11px] font-medium" style={{ color: "var(--w2)" }}>
              <span style={{ color: "var(--w3)" }}>{lang === "fr" ? "En attente de" : lang === "de" ? "Wartet auf" : "Waiting on"}: </span>
              <span style={{ color: "var(--gold)" }}>{blockerLabel(blocker, lang)}</span>
            </p>
          </div>
        )}
        {blocker && (
          <p className="mt-3 text-[11px] leading-relaxed max-w-[260px] mx-auto" style={{ color: "var(--w3)" }}>
            {blockerHint(blocker, lang)}
          </p>
        )}
      </div>
    );
  };

  // ── Interview ───────────────────────────────────────────────────────────
  if (mode === "interview") {
    if (!p || (!p.interview_link && (p.interview_status ?? "pending") === "pending")) {
      return (
        <div className="rounded-2xl px-5 py-10 text-center" style={cardSt}>
          <HeroIcon Icon={({ size, strokeWidth, color }) => <PhaseIcon kind="interview" size={size} strokeWidth={strokeWidth} style={{ color }} />} tone="neutral" />
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--w)" }}>{t.pInterviewPendingTitle}</p>
          <p className="text-xs leading-relaxed max-w-xs mx-auto" style={{ color: "var(--w3)" }}>{t.pInterviewPendingSub}</p>
        </div>
      );
    }
    if (p.interview_status === "passed") {
      return (
        <div className="rounded-2xl px-5 py-8 text-center" style={{ ...cardSt, border: "1px solid var(--success-border)" }}>
          <HeroIcon Icon={PartyPopper} tone="success" />
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--success)" }}>{t.pInterviewPassedTitle}</p>
          <p className="text-xs leading-relaxed max-w-xs mx-auto" style={{ color: "var(--w2)" }}>{t.pInterviewPassedSub}</p>
        </div>
      );
    }
    if (p.interview_status === "failed") {
      return (
        <div className="rounded-2xl px-5 py-8 text-center" style={{ ...cardSt, border: "1px solid var(--danger-border)" }}>
          <HeroIcon Icon={Mail} tone="danger" />
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--danger)" }}>{t.pInterviewFailedTitle}</p>
          <p className="text-xs leading-relaxed max-w-xs mx-auto" style={{ color: "var(--w2)" }}>{t.pInterviewFailedSub}</p>
        </div>
      );
    }
    // Scheduled: link set, status still pending
    return (
      <div className="rounded-2xl p-5" style={cardSt}>
        <p className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--w)" }}>
          <PhaseIcon kind="interview" size={16} style={{ color: "var(--gold)" }} />
          {t.pInterviewScheduledTitle}
        </p>
        {p.interview_date && (
          <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: "var(--w2)" }}>
            <Calendar size={13} strokeWidth={1.7} />
            <span>{new Date(p.interview_date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
        )}
        {p.interview_link && (
          <a href={p.interview_link} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: "var(--gold)", color: "#131312" }}>
            <ExternalLink size={14} strokeWidth={2} /> {t.pInterviewJoinBtn}
          </a>
        )}
      </div>
    );
  }

  // ── Recognition ─────────────────────────────────────────────────────────
  if (mode === "recognition") {
    if (!p?.recognition_unlocked) return lockCard(t.pRecognitionLockedMsg);
    return (
      <div className="space-y-4">
        <div className="rounded-2xl p-5" style={cardSt}>
          <p className="text-base font-semibold mb-1 flex items-center gap-2" style={{ color: "var(--w)" }}>
            <PhaseIcon kind="recognition" size={17} style={{ color: "var(--gold)" }} />
            {t.pRecognitionTitle}
          </p>
          <p className="text-xs mb-5 leading-relaxed" style={{ color: "var(--w3)" }}>{t.pRecognitionSub}</p>
          {[
            { label: "Beschleunigtes Fachkräfteverfahren (BFV)", items: recogDocs.bfv, color: "var(--info)" },
            { label: "Standard Recognition", items: recogDocs.standard, color: "var(--gold)" },
            { label: "UKSH — Specific Documents", items: recogDocs.uksh, color: "#a78bfa" },
          ].map(group => (
            <div key={group.label} className="mb-5">
              <p className="text-xs font-semibold mb-2" style={{ color: group.color }}>● {group.label}</p>
              <div className="space-y-1.5">
                {group.items.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs" style={{ color: "var(--w2)" }}>
                    <span className="mt-0.5 flex-shrink-0" style={{ color: "var(--w3)" }}>□</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Embassy ─────────────────────────────────────────────────────────────
  if (mode === "embassy") {
    if (!p?.embassy_unlocked) return lockCard(t.pEmbassyLockedMsg);
    return (
      <div className="rounded-2xl p-5" style={cardSt}>
        <p className="text-base font-semibold mb-1 flex items-center gap-2" style={{ color: "var(--w)" }}>
          <PhaseIcon kind="embassy" size={17} style={{ color: "var(--gold)" }} />
          {t.pEmbassyTitle}
        </p>
        <p className="text-xs mb-5 leading-relaxed" style={{ color: "var(--w3)" }}>{t.pEmbassySub}</p>
        <div className="space-y-1.5">
          {embassyDocs.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-xs" style={{ color: "var(--w2)" }}>
              <span className="mt-0.5 flex-shrink-0" style={{ color: "var(--w3)" }}>□</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Visa ────────────────────────────────────────────────────────────────
  if (mode === "visa") {
    if (!p?.visa_granted && !p?.visa_date) return lockCard(t.pVisaLockedMsg);
    if (p.visa_granted) {
      return (
        <div className="rounded-2xl px-5 py-10 text-center" style={{ ...cardSt, border: "1px solid var(--success-border)" }}>
          <HeroIcon Icon={PartyPopper} tone="success" />
          <p className="text-[18px] font-semibold tracking-[-0.015em] mb-2" style={{ color: "var(--success)" }}>{t.pVisaGrantedTitle}</p>
          <p className="text-xs leading-relaxed max-w-xs mx-auto mb-3" style={{ color: "var(--w2)" }}>{t.pVisaGrantedSub}</p>
          {p.visa_date && (
            <p className="text-xs" style={{ color: "var(--w3)" }}>
              {t.pVisaDateLabel}: {new Date(p.visa_date).toLocaleDateString(undefined, { dateStyle: "long" })}
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="rounded-2xl px-5 py-10 text-center" style={cardSt}>
        <HeroIcon Icon={({ size, strokeWidth, color }) => <PhaseIcon kind="visa" size={size} strokeWidth={strokeWidth} style={{ color }} />} tone="neutral" />
        <p className="text-sm font-semibold mb-1" style={{ color: "var(--w)" }}>{t.pVisaWaitingTitle}</p>
        <p className="text-xs leading-relaxed max-w-xs mx-auto" style={{ color: "var(--w3)" }}>{t.pVisaWaitingSub}</p>
      </div>
    );
  }

  // ── Flight ──────────────────────────────────────────────────────────────
  if (mode === "flight") {
    if (!p?.flight_date) return lockCard(t.pFlightLockedMsg);
    return (
      <div className="rounded-2xl p-5 text-center" style={{ ...cardSt, border: "1px solid var(--border-gold)" }}>
        <HeroIcon Icon={({ size, strokeWidth, color }) => <PhaseIcon kind="flight" size={size} strokeWidth={strokeWidth} style={{ color }} />} tone="neutral" />
        <p className="text-[16px] font-semibold tracking-[-0.015em] mb-3" style={{ color: "var(--gold)" }}>{t.pFlightTitle}</p>
        <p className="text-sm font-semibold mb-1" style={{ color: "var(--w)" }}>
          {t.pFlightDateLabel}: {new Date(p.flight_date).toLocaleDateString(undefined, { dateStyle: "long" })}
        </p>
        {p.flight_info && (
          <p className="text-xs mt-3 leading-relaxed max-w-xs mx-auto whitespace-pre-line" style={{ color: "var(--w2)" }}>
            {p.flight_info}
          </p>
        )}
      </div>
    );
  }

  // ── Visum (merged embassy + visa) ────────────────────────────────────────
  if (mode === "visum") {
    if (!p?.embassy_unlocked) return lockCard(t.pEmbassyLockedMsg);
    return (
      <div className="space-y-4">
        <div className="rounded-2xl p-5" style={cardSt}>
          <p className="text-base font-semibold mb-1 flex items-center gap-2" style={{ color: "var(--w)" }}>
            <PhaseIcon kind="embassy" size={17} style={{ color: "var(--gold)" }} />
            {t.pEmbassyTitle}
          </p>
          <p className="text-xs mb-5 leading-relaxed" style={{ color: "var(--w3)" }}>{t.pEmbassySub}</p>
          <div className="space-y-1.5">
            {embassyDocs.map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-xs" style={{ color: "var(--w2)" }}>
                <span className="mt-0.5 flex-shrink-0" style={{ color: "var(--w3)" }}>□</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
        {p.visa_granted ? (
          <div className="rounded-2xl px-5 py-10 text-center" style={{ ...cardSt, border: "1px solid var(--success-border)" }}>
            <HeroIcon Icon={PartyPopper} tone="success" />
            <p className="text-[18px] font-semibold tracking-[-0.015em] mb-2" style={{ color: "var(--success)" }}>{t.pVisaGrantedTitle}</p>
            <p className="text-xs leading-relaxed max-w-xs mx-auto mb-3" style={{ color: "var(--w2)" }}>{t.pVisaGrantedSub}</p>
            {p.visa_date && (
              <p className="text-xs" style={{ color: "var(--w3)" }}>
                {t.pVisaDateLabel}: {new Date(p.visa_date).toLocaleDateString(undefined, { dateStyle: "long" })}
              </p>
            )}
          </div>
        ) : p.visa_date ? (
          <div className="rounded-2xl px-5 py-10 text-center" style={cardSt}>
            <HeroIcon Icon={({ size, strokeWidth, color }) => <PhaseIcon kind="visa" size={size} strokeWidth={strokeWidth} style={{ color }} />} tone="neutral" />
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--w)" }}>{t.pVisaWaitingTitle}</p>
            <p className="text-xs leading-relaxed max-w-xs mx-auto" style={{ color: "var(--w3)" }}>{t.pVisaWaitingSub}</p>
          </div>
        ) : null}
      </div>
    );
  }

  // ── Reise ────────────────────────────────────────────────────────────────
  if (mode === "reise") {
    if (!p?.flight_date) return lockCard(t.pFlightLockedMsg);
    return (
      <div className="rounded-2xl p-5 text-center" style={{ ...cardSt, border: "1px solid var(--border-gold)" }}>
        <HeroIcon Icon={({ size, strokeWidth, color }) => <PhaseIcon kind="flight" size={size} strokeWidth={strokeWidth} style={{ color }} />} tone="neutral" />
        <p className="text-[16px] font-semibold tracking-[-0.015em] mb-3" style={{ color: "var(--gold)" }}>{t.pFlightTitle}</p>
        <p className="text-sm font-semibold mb-1" style={{ color: "var(--w)" }}>
          {t.pFlightDateLabel}: {new Date(p.flight_date).toLocaleDateString(undefined, { dateStyle: "long" })}
        </p>
        {p.flight_info && (
          <p className="text-xs mt-3 leading-relaxed max-w-xs mx-auto whitespace-pre-line" style={{ color: "var(--w2)" }}>
            {p.flight_info}
          </p>
        )}
      </div>
    );
  }

  // ── Integration ──────────────────────────────────────────────────────────
  if (mode === "integration") {
    if (!p?.integration_unlocked) return lockCard(t.pIntegrationLockedMsg);
    return (
      <div className="rounded-2xl px-5 py-10 text-center" style={cardSt}>
        <HeroIcon Icon={({ size, strokeWidth, color }) => <PhaseIcon kind="integration" size={size} strokeWidth={strokeWidth} style={{ color }} />} tone="neutral" />
        <p className="text-sm font-semibold mb-1" style={{ color: "var(--w)" }}>{t.pJourneyIntegration}</p>
        <p className="text-xs leading-relaxed max-w-xs mx-auto" style={{ color: "var(--w3)" }}>{t.pIntegrationLockedMsg}</p>
      </div>
    );
  }

  // ── Start ────────────────────────────────────────────────────────────────
  if (mode === "start") {
    if (!p?.start_unlocked) return lockCard(t.pStartLockedMsg);
    return (
      <div className="rounded-2xl px-5 py-10 text-center" style={{ ...cardSt, border: "1px solid var(--success-border)" }}>
        <HeroIcon Icon={PartyPopper} tone="success" />
        <p className="text-sm font-semibold mb-1" style={{ color: "var(--success)" }}>{t.pJourneyStart}</p>
        <p className="text-xs leading-relaxed max-w-xs mx-auto" style={{ color: "var(--w2)" }}>{t.pStartLockedMsg}</p>
      </div>
    );
  }

  return null;
}

// ── Public: full candidate-side journey view (with back button) ────────────
export function JourneyView({ mode, pipeline, t, lang = "en", onBack }: {
  mode: JourneyMode;
  pipeline: JourneyPipeline | null;
  t: Translation;
  lang?: "fr"|"en"|"de";
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <button onClick={onBack}
        className="bv-row-hover flex items-center gap-2 text-xs px-2 py-1"
        style={{ color: "var(--w3)" }}>
        ← {t.pJourneyDocs}
      </button>
      <StageContent mode={mode} p={pipeline} t={t} lang={lang} />
    </div>
  );
}

// ── Public: single-stage preview (admin pipeline editor uses this) ─────────
export function CandidateStagePreview({ mode, pipeline, t, lang = "en" }: {
  mode: JourneyMode;
  pipeline: JourneyPipeline | null;
  t: Translation;
  lang?: "fr"|"en"|"de";
}) {
  return <StageContent mode={mode} p={pipeline} t={t} lang={lang} />;
}
