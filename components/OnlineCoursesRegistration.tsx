"use client";

/**
 * /online-courses — premium 3-step course-registration wizard.
 *
 * Step 1 Information → Step 2 Course → Step 3 Group. Submits a "person" lead to
 * /api/leads (rate-limited + dedup'd; lands in the admin inbox). Trilingual
 * inline (LAW #19). Uses the design-system primitives so it reads as one
 * premium surface, not an ad-hoc form.
 */
import { Fragment, useState } from "react";
import { useLang } from "@/components/LangContext";
import { PhoneInput } from "@/components/PhoneInput";
import { Check, ChevronDown, ArrowRight, ArrowLeft, GraduationCap, Loader2, PartyPopper } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tr = (l: string, en: string, de: string, fr: string) => (l === "de" ? de : l === "fr" ? fr : en);

type Opt = { v: string; en: string; de: string; fr: string };
const COURSES: Opt[] = [
  { v: "standard",  en: "Standard course · 2×/week", de: "Standardkurs · 2×/Woche", fr: "Cours standard · 2×/sem." },
  { v: "intensive", en: "Intensive course · 5×/week", de: "Intensivkurs · 5×/Woche", fr: "Cours intensif · 5×/sem." },
  { v: "evening",   en: "Evening course",             de: "Abendkurs",               fr: "Cours du soir" },
  { v: "weekend",   en: "Weekend course",             de: "Wochenendkurs",           fr: "Cours du week-end" },
  { v: "private",   en: "Private · 1-on-1",           de: "Einzelunterricht",        fr: "Cours particulier" },
];
const GROUPS: Opt[] = [
  { v: "morning",   en: "Morning · 09:00–11:00",   de: "Vormittag · 09:00–11:00",   fr: "Matin · 09:00–11:00" },
  { v: "afternoon", en: "Afternoon · 14:00–16:00", de: "Nachmittag · 14:00–16:00",  fr: "Après-midi · 14:00–16:00" },
  { v: "evening",   en: "Evening · 18:00–20:00",   de: "Abend · 18:00–20:00",       fr: "Soir · 18:00–20:00" },
  { v: "night",     en: "Night · 20:00–22:00",     de: "Spätgruppe · 20:00–22:00",  fr: "Nuit · 20:00–22:00" },
];
const LEVELS: Opt[] = [
  { v: "A0", en: "A0 – No prior knowledge", de: "A0 – Keine Vorkenntnisse", fr: "A0 – Aucune connaissance" },
  { v: "A1", en: "A1 – Beginner",           de: "A1 – Anfänger",            fr: "A1 – Débutant" },
  { v: "A2", en: "A2 – Elementary",         de: "A2 – Grundkenntnisse",     fr: "A2 – Élémentaire" },
  { v: "B1", en: "B1 – Intermediate",       de: "B1 – Mittelstufe",         fr: "B1 – Intermédiaire" },
  { v: "B2", en: "B2 – Upper intermediate", de: "B2 – Gute Mittelstufe",    fr: "B2 – Avancé intermédiaire" },
  { v: "C1", en: "C1 – Advanced",           de: "C1 – Fortgeschritten",     fr: "C1 – Avancé" },
];

export function OnlineCoursesRegistration() {
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => tr(lang, en, de, fr);
  const label = (o: Opt) => tr(lang, o.en, o.de, o.fr);

  const [step, setStep] = useState(0); // 0,1,2
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+212 ");
  const [address, setAddress] = useState("");
  const [course, setCourse] = useState("standard");
  const [group, setGroup] = useState("morning");
  const [level, setLevel] = useState("A0");

  const phoneDigits = phone.replace(/^\+\d+/, "").replace(/\D/g, "");
  const e = {
    firstName: !firstName.trim(),
    lastName: !lastName.trim(),
    email: !EMAIL_RE.test(email.trim()),
    phone: phoneDigits.length < 6,
    address: !address.trim(),
  };
  const step1Valid = !e.firstName && !e.lastName && !e.email && !e.phone && !e.address;

  const STEPS = [T("Information", "Angaben", "Informations"), T("Course", "Kurs", "Cours"), T("Group", "Gruppe", "Groupe")];

  function next() {
    if (step === 0 && !step1Valid) { setTouched(true); return; }
    setTouched(false);
    setStep((s) => Math.min(2, s + 1));
  }
  function back() { setErr(null); setStep((s) => Math.max(0, s - 1)); }

  async function submit() {
    if (!step1Valid) { setStep(0); setTouched(true); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const courseLabel = label(COURSES.find((o) => o.v === course)!);
      const groupLabel = label(GROUPS.find((o) => o.v === group)!);
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "person",
          email: email.trim(),
          phone: phone.trim(),
          level,
          message: `Online-Kurs Anmeldung — ${firstName.trim()} ${lastName.trim()} | Adresse: ${address.trim()} | Kurs: ${courseLabel} | Gruppe: ${groupLabel} | Niveau: ${level}`,
        }),
      });
      if (res.ok) { setDone(true); return; }
      setErr(res.status === 429
        ? T("Too many requests — please try again in a minute.", "Zu viele Anfragen — bitte in einer Minute erneut versuchen.", "Trop de requêtes — réessayez dans une minute.")
        : T("Something went wrong. Please try again.", "Etwas ist schiefgelaufen. Bitte erneut versuchen.", "Une erreur est survenue. Réessayez."));
    } catch {
      setErr(T("Network error. Please try again.", "Netzwerkfehler. Bitte erneut versuchen.", "Erreur réseau. Réessayez."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bv-page-bottom" style={{ background: "var(--bg)" }}>
      {/* Ambient brand glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{
        background: "radial-gradient(ellipse 70% 50% at 50% -10%, var(--gdim) 0%, transparent 60%)",
      }} />

      <div className="relative mx-auto px-5 pt-20 pb-16 sm:pt-28" style={{ maxWidth: 660 }}>
        {/* Header */}
        <div className="text-center bv-enter">
          <span className="bv-eyebrow">{T("Online German courses", "Deutschkurse online", "Cours d'allemand en ligne")}</span>
          <h1 className="bv-h1 mt-3">{T("Learn German, live online", "Deutsch lernen, live online", "Apprenez l'allemand, en direct")}</h1>
          <p className="bv-body mx-auto mt-3" style={{ maxWidth: 460 }}>
            {T(
              "Reserve your seat in a live small-group course — A0 to C1, qualified instructors. Three quick steps.",
              "Sichern Sie sich Ihren Platz im Live-Kleingruppenkurs — A0 bis C1, qualifizierte Lehrkräfte. Drei kurze Schritte.",
              "Réservez votre place en petit groupe en direct — A0 à C1, formateurs qualifiés. Trois étapes rapides.",
            )}
          </p>
        </div>

        {/* Stepper */}
        {!done && (
          <div className="mt-12 flex items-center justify-center">
            {STEPS.map((s, i) => {
              const isDone = i < step;
              const isActive = i === step;
              return (
                <Fragment key={s}>
                  <div className="flex flex-col items-center gap-2" style={{ minWidth: 72 }}>
                    <div className="flex items-center justify-center rounded-full transition-all"
                      style={{
                        width: 34, height: 34, fontSize: 14, fontWeight: 700,
                        background: isDone ? "var(--success)" : isActive ? "var(--gold)" : "var(--bg2)",
                        color: isDone || isActive ? "#131312" : "var(--w3)",
                        border: isActive ? "none" : `1px solid var(--border)`,
                        boxShadow: isActive ? "var(--shadow-gold-sm)" : "none",
                      }}>
                      {isDone ? <Check size={17} strokeWidth={2.4} /> : i + 1}
                    </div>
                    <span className="text-[11px] font-semibold tracking-[0.06em]"
                      style={{ color: isActive || isDone ? "var(--gold)" : "var(--w3)" }}>
                      {s}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="flex-1 mx-2 rounded-full" style={{ height: 2, maxWidth: 90, background: i < step ? "var(--gold)" : "var(--border)" }} />
                  )}
                </Fragment>
              );
            })}
          </div>
        )}

        {/* Card */}
        <div className="mt-8 p-6 sm:p-9" style={{
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
        }}>
          {done ? (
            <div className="text-center py-6 bv-enter">
              <div className="mx-auto mb-5 flex items-center justify-center rounded-full" style={{ width: 64, height: 64, background: "var(--gdim)", color: "var(--gold)" }}>
                <PartyPopper size={30} strokeWidth={1.8} />
              </div>
              <h2 className="bv-h2">{T("Request received!", "Anfrage erhalten!", "Demande reçue !")}</h2>
              <p className="bv-body mx-auto mt-2" style={{ maxWidth: 420 }}>
                {T(
                  "Thank you — our team will contact you shortly to confirm your seat and the start date.",
                  "Vielen Dank — unser Team meldet sich in Kürze, um Ihren Platz und den Starttermin zu bestätigen.",
                  "Merci — notre équipe vous contactera sous peu pour confirmer votre place et la date de début.",
                )}
              </p>
              <a href="/" className="bv-btn bv-btn-ghost mt-7 inline-flex">{T("Back to home", "Zur Startseite", "Retour à l'accueil")}</a>
            </div>
          ) : (
            <div key={step} className="bv-enter">
              {step === 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-5">
                  <Field label={T("First name", "Vorname", "Prénom")} req>
                    <input className={`bv-input ${touched && e.firstName ? "error" : ""}`} value={firstName} onChange={(ev) => setFirstName(ev.target.value)} autoComplete="given-name" />
                  </Field>
                  <Field label={T("Last name", "Nachname", "Nom")} req>
                    <input className={`bv-input ${touched && e.lastName ? "error" : ""}`} value={lastName} onChange={(ev) => setLastName(ev.target.value)} autoComplete="family-name" />
                  </Field>
                  <Field label={T("Email", "E-Mail", "E-mail")} req>
                    <input type="email" inputMode="email" className={`bv-input ${touched && e.email ? "error" : ""}`} value={email} onChange={(ev) => setEmail(ev.target.value)} autoComplete="email" />
                  </Field>
                  <Field label={T("Phone", "Telefon", "Téléphone")} req>
                    <PhoneInput value={phone} onChange={setPhone} hasError={touched && e.phone} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label={T("Address", "Adresse", "Adresse")} req>
                      <input className={`bv-input ${touched && e.address ? "error" : ""}`} value={address} onChange={(ev) => setAddress(ev.target.value)} autoComplete="street-address" placeholder={T("Street, city, country", "Straße, Stadt, Land", "Rue, ville, pays")} />
                    </Field>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-2">
                  <Field label={T("Course type", "Kursart", "Type de cours")} req>
                    <Select value={course} onChange={setCourse} options={COURSES} label={label} />
                  </Field>
                  <div className="flex items-start gap-2.5 mt-5 rounded-xl px-3.5 py-3" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
                    <GraduationCap size={16} strokeWidth={1.9} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 1 }} />
                    <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--w2)" }}>
                      {T(
                        "All courses are 100% online, live with a teacher — not pre-recorded.",
                        "Alle Kurse sind 100% online, live mit Lehrkraft — keine Aufzeichnungen.",
                        "Tous les cours sont 100% en ligne, en direct avec un professeur — pas d'enregistrements.",
                      )}
                    </p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <Field label={T("Group / schedule", "Gruppe / Zeit", "Groupe / horaire")} req>
                    <Select value={group} onChange={setGroup} options={GROUPS} label={label} />
                  </Field>
                  <Field label={T("German level", "Deutschniveau", "Niveau d'allemand")} req>
                    <Select value={level} onChange={setLevel} options={LEVELS} label={label} />
                  </Field>
                </div>
              )}

              {err && <p className="mt-5 text-[13px] font-medium" style={{ color: "var(--danger)" }}>{err}</p>}

              {/* Nav */}
              <div className="mt-8 flex items-center justify-between gap-3">
                {step > 0 ? (
                  <button onClick={back} className="bv-btn bv-btn-ghost" type="button">
                    <ArrowLeft size={15} strokeWidth={2} /> {T("Back", "Zurück", "Retour")}
                  </button>
                ) : <span />}

                {step < 2 ? (
                  <button onClick={next} className="bv-btn bv-btn-primary-lg bv-glow-gold" type="button">
                    {T("Continue", "Weiter", "Continuer")} <ArrowRight size={16} strokeWidth={2} />
                  </button>
                ) : (
                  <button onClick={submit} disabled={submitting} className="bv-btn bv-btn-primary-lg bv-glow-gold" type="button">
                    {submitting ? <><Loader2 size={16} className="animate-spin" /> {T("Submitting…", "Wird gesendet…", "Envoi…")}</> : T("Submit request", "Anfrage senden", "Envoyer la demande")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="bv-label">{label}{req && <span className="req">*</span>}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: Opt[]; label: (o: Opt) => string }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        className="w-full appearance-none rounded-[10px] px-4 py-3.5 pr-11 text-[15px] font-medium outline-none cursor-pointer"
        style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v} style={{ background: "var(--card)", color: "var(--w)" }}>{label(o)}</option>
        ))}
      </select>
      <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" style={{ color: "var(--w3)" }} />
    </div>
  );
}
