"use client";

/**
 * /online-courses — premium 3-step course-registration wizard.
 *
 * Step 1 Information → Step 2 Group (time slot) → Step 3 Level. Sold-out groups
 * + levels are shown but not selectable (red badge). Submits a "person" lead to
 * /api/leads (rate-limited + dedup'd; lands in the admin inbox). Trilingual
 * inline (LAW #19). Built on the design-system primitives — one premium surface.
 */
import { Fragment, useState } from "react";
import { useLang } from "@/components/LangContext";
import { PhoneInput } from "@/components/PhoneInput";
import { Check, ArrowRight, ArrowLeft, GraduationCap, Loader2, PartyPopper } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tr = (l: string, en: string, de: string, fr: string) => (l === "de" ? de : l === "fr" ? fr : en);

type Opt = { v: string; en: string; de: string; fr: string; soldOut?: boolean };

// Time groups — two open, two sold out (shown for scarcity, not selectable).
const GROUPS: Opt[] = [
  { v: "1800", en: "18:00 – 20:00", de: "18:00 – 20:00", fr: "18:00 – 20:00" },
  { v: "2000", en: "20:00 – 22:00", de: "20:00 – 22:00", fr: "20:00 – 22:00" },
  { v: "1600", en: "16:00 – 18:00", de: "16:00 – 18:00", fr: "16:00 – 18:00", soldOut: true },
  { v: "1000", en: "10:00 – 12:00", de: "10:00 – 12:00", fr: "10:00 – 12:00", soldOut: true },
];
// Levels — A1 + B2 open, A2 + B1 sold out.
const LEVELS: Opt[] = [
  { v: "A1", en: "A1 – Beginner",           de: "A1 – Anfänger",         fr: "A1 – Débutant" },
  { v: "A2", en: "A2 – Elementary",         de: "A2 – Grundkenntnisse",  fr: "A2 – Élémentaire", soldOut: true },
  { v: "B1", en: "B1 – Intermediate",       de: "B1 – Mittelstufe",      fr: "B1 – Intermédiaire", soldOut: true },
  { v: "B2", en: "B2 – Upper intermediate", de: "B2 – Gute Mittelstufe", fr: "B2 – Avancé intermédiaire" },
];

// ▶ SOCIAL PROOF — set this to your REAL number of students to show a count
//   (e.g. 1200 → "Join 1,200+ learners…"). Leave null for count-free momentum
//   copy. Do NOT inflate it: a fabricated popularity figure is deceptive
//   advertising under EU/German consumer law (UWG/UCPD) and a trust risk the
//   moment a student or competitor checks. Use a number you can stand behind.
const LEARNER_COUNT: number | null = null;

// Member-avatar photos for the social-proof cluster. Drop REAL images at
// public/avatars/face1.jpg … face5.jpg  (face1 = the front-most one shown on
// top). Each falls back to a warm gradient circle until its file exists, so a
// missing photo never shows a broken-image icon. You can also point these at
// https URLs instead. Use only photos you have the right to use.
const FACES = [
  "/avatars/face1.jpg",
  "/avatars/face2.jpg",
  "/avatars/face3.jpg",
  "/avatars/face4.jpg",
  "/avatars/face5.jpg",
];

// Warm, intentionally abstract avatar tiles — blurred gradients so NO
// identifiable face is ever shown (also satisfies "faces not visible even when
// zoomed"). They read as "a group of people" for social proof without
// fabricating anyone's identity / using AI faces as fake testimonials.
function avatarBg(i: number): string {
  const h = [25, 18, 32, 20, 30][i % 5]; // warm skin-ish hues
  return [
    `radial-gradient(circle at 50% 72%, hsl(${h} 44% 72%) 0 36%, transparent 38%)`,
    `linear-gradient(180deg, hsl(${h + 6} 26% 27%) 0 38%, hsl(${h} 40% 58%) 40% 100%)`,
  ].join(", ");
}

export function OnlineCoursesRegistration() {
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => tr(lang, en, de, fr);
  const label = (o: Opt) => tr(lang, o.en, o.de, o.fr);
  const soldOutLabel = T("Sold out", "Ausgebucht", "Complet");

  const [step, setStep] = useState(0); // 0 Info · 1 Group · 2 Level
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+212 ");
  const [address, setAddress] = useState("");
  const [group, setGroup] = useState("1800");  // first open slot
  const [level, setLevel] = useState("A1");     // first open level

  const phoneDigits = phone.replace(/^\+\d+/, "").replace(/\D/g, "");
  const e = {
    firstName: !firstName.trim(),
    lastName: !lastName.trim(),
    email: !EMAIL_RE.test(email.trim()),
    phone: phoneDigits.length < 6,
    address: !address.trim(),
  };
  const step1Valid = !e.firstName && !e.lastName && !e.email && !e.phone && !e.address;

  const STEPS = [T("Information", "Angaben", "Informations"), T("Group", "Gruppe", "Groupe"), T("Level", "Niveau", "Niveau")];

  // Social-proof line — shows a real count only if LEARNER_COUNT is set above.
  const nStr = LEARNER_COUNT?.toLocaleString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-US");
  const joinText = LEARNER_COUNT
    ? T(`Join ${nStr}+ learners getting fluent in German`,
        `${nStr}+ Lernende werden mit Borivon fließend in Deutsch`,
        `Rejoignez ${nStr}+ apprenants vers la maîtrise de l'allemand`)
    : T("Join a growing community learning German with Borivon",
        "Teil einer wachsenden Deutsch-Lerngemeinschaft bei Borivon",
        "Rejoignez une communauté grandissante qui apprend l'allemand");

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
      const groupLabel = label(GROUPS.find((o) => o.v === group)!);
      const res = await fetch("/api/online-courses/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: address.trim(),
          group: groupLabel,
          level,
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
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{
        background: "radial-gradient(ellipse 70% 50% at 50% -10%, var(--gdim) 0%, transparent 60%)",
      }} />

      <div className="relative mx-auto px-5 pt-20 pb-16 sm:pt-28" style={{ maxWidth: 660 }}>
        {/* Header */}
        <div className="text-center bv-enter">
          {/* Brand wordmark — plain text (not a link), the largest element. */}
          <span className="bv-wordmark inline-block" style={{ fontSize: "clamp(2.8rem, 9vw, 4.2rem)", lineHeight: 1 }}>
            Borivon<span className="bv-wordmark-dot">.</span>
          </span>
          {/* Headline — big, but a notch smaller than the logo. */}
          <h1 className="bv-h1 mt-3" style={{ fontSize: "clamp(1.9rem, 5vw, 2.8rem)" }}>{T("Learn German Online", "Online Deutsch lernen", "Apprendre l'allemand en ligne")}</h1>
          <p className="bv-body mx-auto mt-3" style={{ maxWidth: 440 }}>
            {T(
              "Reserve your seat by submitting your info.",
              "Sichern Sie sich Ihren Platz — senden Sie einfach Ihre Daten.",
              "Réservez votre place en envoyant vos informations.",
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
                // Placeholder-as-label (matches the portal register): field name
                // lives in-box as a grey placeholder — saves the label row, fits
                // phones. aria-label keeps each input screen-reader accessible.
                <div className="space-y-3.5">
                  {/* First + last name share a row on EVERY size (incl. phones). */}
                  <div className="grid grid-cols-2 gap-3.5">
                    <input className={`bv-input ${touched && e.firstName ? "error" : ""}`} value={firstName} onChange={(ev) => setFirstName(ev.target.value)} autoComplete="given-name" placeholder={T("First name", "Vorname", "Prénom")} aria-label={T("First name", "Vorname", "Prénom")} />
                    <input className={`bv-input ${touched && e.lastName ? "error" : ""}`} value={lastName} onChange={(ev) => setLastName(ev.target.value)} autoComplete="family-name" placeholder={T("Last name", "Nachname", "Nom")} aria-label={T("Last name", "Nachname", "Nom")} />
                  </div>
                  {/* Email + phone: stacked on phones, side-by-side on desktop. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <input type="email" inputMode="email" className={`bv-input ${touched && e.email ? "error" : ""}`} value={email} onChange={(ev) => setEmail(ev.target.value)} autoComplete="email" placeholder={T("Email", "E-Mail", "E-mail")} aria-label={T("Email", "E-Mail", "E-mail")} />
                    <PhoneInput value={phone} onChange={setPhone} hasError={touched && e.phone} />
                  </div>
                  <input className={`bv-input ${touched && e.address ? "error" : ""}`} value={address} onChange={(ev) => setAddress(ev.target.value)} autoComplete="street-address" placeholder={T("Address — street, city, country", "Adresse — Straße, Stadt, Land", "Adresse — rue, ville, pays")} aria-label={T("Address", "Adresse", "Adresse")} />
                </div>
              )}

              {step === 1 && (
                <div>
                  <span className="bv-label">{T("Choose your group", "Gruppe wählen", "Choisissez votre groupe")}<span className="req">*</span></span>
                  <Cards value={group} onChange={setGroup} options={GROUPS} label={label} soldOutLabel={soldOutLabel} />
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
                <div>
                  <span className="bv-label">{T("Choose your German level", "Deutschniveau wählen", "Choisissez votre niveau")}<span className="req">*</span></span>
                  <Cards value={level} onChange={setLevel} options={LEVELS} label={label} soldOutLabel={soldOutLabel} />
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

        {/* ── Social proof — centered avatars with the text below them ──────────── */}
        {!done && (
          <div className="mt-12 flex flex-col items-center text-center bv-enter gap-3.5">
            {/* Member avatars — real photos from public/avatars/face1..5.jpg
                (face1 = front, on top). Each falls back to a warm gradient
                circle until its file exists, so a missing photo is never a
                broken image. */}
            <div className="flex justify-center" aria-hidden>
              {FACES.map((src, i) => (
                <span key={i} className="block" style={{
                  width: 46, height: 46, borderRadius: 999, overflow: "hidden",
                  border: "2px solid var(--bg)", marginLeft: i === 0 ? 0 : -14,
                  boxShadow: "var(--shadow-sm)", flexShrink: 0, position: "relative", zIndex: FACES.length - i,
                  background: avatarBg(i),
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </span>
              ))}
            </div>
            <p className="text-[14.5px] sm:text-[15px] font-semibold" style={{ color: "var(--w)", maxWidth: 320 }}>
              {joinText}
            </p>
            {/* Live "enrolling now" — centered, below the faces + text. */}
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-semibold"
              style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
              <span className="bv-live-dot inline-block rounded-full" style={{ width: 8, height: 8, background: "var(--success)" }} />
              {T("Enrolling now", "Anmeldung läuft", "Inscriptions ouvertes")}
            </span>
          </div>
        )}
      </div>
    </main>
  );
}

/** Premium option cards — selected = gold ring + check; sold-out = greyed + red badge, not clickable. */
function Cards({ value, onChange, options, label, soldOutLabel }: {
  value: string; onChange: (v: string) => void; options: Opt[]; label: (o: Opt) => string; soldOutLabel: string;
}) {
  return (
    <div className="space-y-2.5 mt-2">
      {options.map((o) => {
        const selected = value === o.v;
        const so = !!o.soldOut;
        return (
          <button
            key={o.v}
            type="button"
            disabled={so}
            aria-pressed={selected}
            onClick={() => { if (!so) onChange(o.v); }}
            className="w-full flex items-center justify-between gap-3 rounded-[14px] px-4 py-3.5 text-left transition-all"
            style={{
              background: selected ? "var(--gdim)" : "var(--bg2)",
              border: `1px solid ${selected ? "var(--border-gold)" : "var(--border)"}`,
              opacity: so ? 0.6 : 1,
              cursor: so ? "not-allowed" : "pointer",
            }}
          >
            <span className="text-[15px] font-medium" style={{ color: so ? "var(--w3)" : "var(--w)" }}>{label(o)}</span>
            {so ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                {soldOutLabel}
              </span>
            ) : selected ? (
              <Check size={18} strokeWidth={2.4} style={{ color: "var(--gold)", flexShrink: 0 }} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
