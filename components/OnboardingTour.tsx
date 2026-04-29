"use client";

/**
 * 5-step welcome tour for first-time candidates.
 *
 * Shown once per user (gated by `bv-onboarded-${userId}` localStorage flag).
 * Renders as a modal overlay — no positioning hacks against actual UI elements
 * (which are unreliable on responsive layouts). Each step is a focused card
 * explaining one piece of the journey.
 *
 * To replay: clear localStorage key `bv-onboarded-${userId}` or call the
 * exported `resetOnboarding(userId)` helper.
 */

import * as React from "react";
import {
  IdCard, FileText, Sparkles, Bell, PartyPopper,
} from "@/components/PortalIcons";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, X as XIcon } from "lucide-react";

type Step = {
  Icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
};

const STEPS: Record<"fr"|"en"|"de", Step[]> = {
  en: [
    { Icon: PartyPopper, eyebrow: "Welcome",   title: "Your path to Germany starts here", body: "We'll guide you through every step — from documents to your flight. Most candidates finish the upload phase in 2–3 weeks." },
    { Icon: IdCard,      eyebrow: "Step 1",    title: "Upload your documents",            body: "Start with your passport. We'll automatically extract the data so you don't have to type it. Then move through nursing diplomas, translations, and the rest." },
    { Icon: FileText,    eyebrow: "Step 2",    title: "Build your German CV",             body: "When you're ready, our CV builder generates a professional Lebenslauf in seconds — auto-filled with everything we already know about you." },
    { Icon: Bell,        eyebrow: "Step 3",    title: "Get notified instantly",           body: "Every approval, rejection, or next-step update appears in your bell at the top. No need to check email constantly." },
    { Icon: Sparkles,    eyebrow: "Ready",     title: "We're with you the whole way",     body: "Your case manager reviews everything you upload. If you ever get stuck, the locked stages tell you exactly what's being worked on." },
  ],
  fr: [
    { Icon: PartyPopper, eyebrow: "Bienvenue", title: "Votre chemin vers l'Allemagne commence ici", body: "Nous vous accompagnons à chaque étape — des documents jusqu'à votre vol. La plupart des candidats terminent la phase de téléversement en 2–3 semaines." },
    { Icon: IdCard,      eyebrow: "Étape 1",   title: "Téléversez vos documents",         body: "Commencez par votre passeport. Nous extrayons automatiquement les données pour vous éviter la saisie. Continuez ensuite avec les diplômes, traductions, et le reste." },
    { Icon: FileText,    eyebrow: "Étape 2",   title: "Créez votre CV allemand",          body: "Notre générateur produit un Lebenslauf professionnel en quelques secondes — pré-rempli avec ce que nous savons déjà." },
    { Icon: Bell,        eyebrow: "Étape 3",   title: "Soyez notifié immédiatement",      body: "Chaque approbation, refus ou nouvelle étape apparaît dans la cloche en haut. Pas besoin de vérifier vos emails." },
    { Icon: Sparkles,    eyebrow: "Prêt",      title: "Nous sommes avec vous",            body: "Votre conseiller examine tout ce que vous téléversez. En cas de blocage, les étapes verrouillées vous indiquent ce qui est en cours." },
  ],
  de: [
    { Icon: PartyPopper, eyebrow: "Willkommen",title: "Ihr Weg nach Deutschland beginnt hier", body: "Wir begleiten Sie bei jedem Schritt — von den Dokumenten bis zum Flug. Die meisten Kandidaten schließen die Upload-Phase in 2–3 Wochen ab." },
    { Icon: IdCard,      eyebrow: "Schritt 1", title: "Laden Sie Ihre Dokumente hoch",    body: "Beginnen Sie mit Ihrem Reisepass. Wir extrahieren die Daten automatisch — Sie müssen nichts eintippen. Danach folgen Diplome, Übersetzungen und der Rest." },
    { Icon: FileText,    eyebrow: "Schritt 2", title: "Erstellen Sie Ihren deutschen Lebenslauf", body: "Unser Generator erstellt in Sekunden einen professionellen Lebenslauf — vorausgefüllt mit allem, was wir bereits wissen." },
    { Icon: Bell,        eyebrow: "Schritt 3", title: "Sofort benachrichtigt",            body: "Jede Freigabe, Ablehnung oder neue Phase erscheint in der Glocke oben. Sie müssen keine E-Mails verfolgen." },
    { Icon: Sparkles,    eyebrow: "Bereit",    title: "Wir sind den ganzen Weg dabei",    body: "Ihr Berater prüft alles, was Sie hochladen. Falls etwas stockt, zeigen die gesperrten Stufen genau, woran gearbeitet wird." },
  ],
};

const STORAGE_KEY = (userId: string) => `bv-onboarded-${userId}`;

export function OnboardingTour({ userId, lang = "en" }: { userId: string | null; lang?: "fr"|"en"|"de" }) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);

  const steps = STEPS[lang] ?? STEPS.en;

  React.useEffect(() => {
    if (!userId) return;
    try {
      const seen = localStorage.getItem(STORAGE_KEY(userId));
      if (!seen) {
        // Small delay so the welcome tour appears AFTER the page renders
        const timer = setTimeout(() => setOpen(true), 600);
        return () => clearTimeout(timer);
      }
    } catch { /* ignore */ }
  }, [userId]);

  // Esc closes the tour (treated as "skip", marks onboarded so it doesn't pop again).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    if (userId) {
      try { localStorage.setItem(STORAGE_KEY(userId), new Date().toISOString()); } catch { /* ignore */ }
    }
  }

  function next() {
    if (step < steps.length - 1) setStep(step + 1);
    else close();
  }

  if (!open) return null;

  const cur = steps[step];
  const isLast = step === steps.length - 1;

  const labelNext   = lang === "fr" ? "Suivant" : lang === "de" ? "Weiter" : "Next";
  const labelDone   = lang === "fr" ? "Commencer" : lang === "de" ? "Loslegen" : "Get started";
  const labelSkip   = lang === "fr" ? "Passer" : lang === "de" ? "Überspringen" : "Skip";

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(10px)", animation: "bvFadeRise 0.32s var(--ease-out)" }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[460px] overflow-hidden"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-2xl)",
          boxShadow: "var(--shadow-lg)",
          paddingBottom: "env(safe-area-inset-bottom)",
          animation: "bvFadeRise 0.36s var(--ease-out)",
        }}>
        {/* Skip in corner */}
        <div className="flex items-center justify-end px-4 pt-4">
          <button onClick={close}
            aria-label={labelSkip}
            className="bv-row-hover inline-flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1.5"
            style={{ color: "var(--w3)" }}>
            {labelSkip}
            <XIcon size={11} strokeWidth={1.8} />
          </button>
        </div>

        {/* Hero icon */}
        <div className="px-7 pt-2 pb-6 text-center">
          <span className="mx-auto mb-5 flex items-center justify-center w-14 h-14 rounded-full"
            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
            <cur.Icon size={26} strokeWidth={1.6} />
          </span>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] mb-2.5" style={{ color: "var(--gold)" }}>
            {cur.eyebrow}
          </p>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] mb-2.5 leading-tight" style={{ color: "var(--w)" }}>
            {cur.title}
          </h2>
          <p className="text-[13.5px] leading-relaxed max-w-[360px] mx-auto" style={{ color: "var(--w3)" }}>
            {cur.body}
          </p>
        </div>

        {/* Progress dots + Next button */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <span key={i}
                className="rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 18 : 6,
                  height: 6,
                  background: i === step ? "var(--gold)" : i < step ? "var(--border-gold)" : "var(--border)",
                }} />
            ))}
          </div>
          <button onClick={next}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold tracking-tight transition-opacity hover:opacity-90"
            style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-sm)", boxShadow: "var(--shadow-sm)" }}>
            {isLast ? labelDone : labelNext}
            {!isLast && <ChevronRight size={14} strokeWidth={2} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Helper to reset onboarding (e.g. from a debug menu or settings). */
export function resetOnboarding(userId: string): void {
  try { localStorage.removeItem(STORAGE_KEY(userId)); } catch { /* ignore */ }
}
