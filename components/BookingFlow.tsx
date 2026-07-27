"use client";

/**
 * /book — Borivon's own booking page. Three steps, nothing more:
 *
 *   1. Who are you?   nurse · clinic (needs nurses) · company (German training)
 *   2. When?          real free slots, from the founder's real calendar
 *   3. Your details   → a Google Calendar invite with a Meet link lands in their inbox
 *
 * The three audiences are Borivon's two businesses: nurse + clinic are the two
 * SIDES of the placement marketplace, company is the language academy. Asking
 * first means the founder walks into every call already knowing which it is.
 *
 * Trilingual inline (LAW #19).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "@/components/LangContext";
import { PhoneInput } from "@/components/PhoneInput";
import { QUESTIONS, type Selections } from "@/lib/booking";
import {
  Stethoscope, Building2, GraduationCap, ArrowLeft, ArrowRight,
  Loader2, Check, CalendarDays, Clock, Video,
} from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tr = (l: string, en: string, de: string, fr: string) => (l === "de" ? de : l === "fr" ? fr : en);

type Kind = "nurse" | "clinic" | "company";

const KINDS: { v: Kind; Icon: typeof Stethoscope; en: string; de: string; fr: string; subEn: string; subDe: string; subFr: string }[] = [
  {
    v: "nurse", Icon: Stethoscope,
    en: "I'm a nurse", de: "Ich bin Pflegekraft", fr: "Je suis infirmier·ère",
    subEn: "I want to work in Germany",
    subDe: "Ich möchte in Deutschland arbeiten",
    subFr: "Je veux travailler en Allemagne",
  },
  {
    v: "clinic", Icon: Building2,
    en: "We need nurses", de: "Wir suchen Pflegekräfte", fr: "Nous cherchons des infirmiers",
    subEn: "Hospital, clinic or care home",
    subDe: "Klinik, Krankenhaus oder Pflegeheim",
    subFr: "Hôpital, clinique ou EHPAD",
  },
  {
    v: "company", Icon: GraduationCap,
    en: "We need German training", de: "Wir brauchen Deutschkurse", fr: "Nous cherchons des cours d'allemand",
    subEn: "German courses for our team",
    subDe: "Deutschkurse für unser Team",
    subFr: "Cours d'allemand pour notre équipe",
  },
];

const locOf = (lang: string) => (lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB");

/**
 * Regroup the offered instants into the VISITOR's own days and times.
 *
 * The server groups by Morocco days because that's where the availability
 * windows live, but showing Morocco time to a clinic in Kiel means they pick
 * "14:00" and the confirmation — and the Google invite — say 15:00. Everything
 * the visitor sees is their own clock; only the instants cross the wire.
 */
function localDays(instants: number[], lang: string): { key: string; weekday: string; date: string; slots: { at: number; label: string }[] }[] {
  const loc = locOf(lang);
  const byDay = new Map<string, number[]>();
  for (const at of instants) {
    const d = new Date(at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(at);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, list]) => {
      const first = new Date(list[0]);
      return {
        key,
        weekday: first.toLocaleDateString(loc, { weekday: "short" }),
        date: first.toLocaleDateString(loc, { day: "numeric", month: "short" }),
        slots: list.sort((a, b) => a - b).map((at) => ({
          at,
          label: new Date(at).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }),
        })),
      };
    });
}

export function BookingFlow() {
  const { lang } = useLang();
  const T = useCallback((en: string, de: string, fr: string) => tr(lang, en, de, fr), [lang]);

  const [step, setStep] = useState(0);          // 0 who · 1 when · 2 details
  const [loading, setLoading] = useState(true);
  const [instants, setInstants] = useState<number[]>([]);
  const [tz, setTz] = useState("");
  const [slotMinutes, setSlotMinutes] = useState(30);

  const [kind, setKind] = useState<Kind | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+212 ");
  const [company, setCompany] = useState("");
  const [selections, setSelections] = useState<Selections>({});

  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const loadSlots = useCallback(async () => {
    try {
      const r = await fetch("/api/book", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      // Only the INSTANTS cross the wire. The server groups by Morocco days
      // because that's where the availability lives; we regroup into the
      // visitor's own days below so nothing they see is in a foreign clock.
      type RawDay = { slots?: { at?: unknown }[] };
      const list = (Array.isArray(j?.days) ? (j.days as RawDay[]) : [])
        .flatMap((d) => (d.slots ?? []).map((s) => Number(s?.at)))
        .filter((n) => Number.isFinite(n));
      setInstants(list);
      setSlotMinutes(Number(j?.slotMinutes) || 30);
    } catch {
      setInstants([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSlots(); }, [loadSlots]);

  // Show the time in THEIR timezone name, so nobody assumes it's their own
  // clock. The slot labels themselves are Borivon (Casablanca) time.
  useEffect(() => {
    try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""); } catch { /* older browser */ }
  }, []);

  const days = useMemo(() => localDays(instants, lang), [instants, lang]);
  const selectedDay = useMemo(
    () => days.find((d) => d.key === dayKey) ?? days[0] ?? null,
    [days, dayKey],
  );
  const isOrg = kind === "clinic" || kind === "company";
  const emailBad = !EMAIL_RE.test(email.trim());
  const nameBad = name.trim().length < 2;
  const canSubmit = !!kind && at != null && !nameBad && !emailBad;

  async function submit() {
    if (!canSubmit) { setTouched(true); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const r = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, at, name: name.trim(), email: email.trim(),
          phone: phone.replace(/^\+\d+\s*$/, "").trim() ? phone.trim() : "",
          company: isOrg ? company.trim() : "",
          selections,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // A slot taken while they were typing is the one error worth a retry
        // path rather than a dead end — reload the grid and send them back.
        if (j?.error === "slot_unavailable") {
          setErr(T("That time was just taken — please pick another.",
                   "Der Termin wurde gerade vergeben — bitte wählen Sie einen anderen.",
                   "Ce créneau vient d'être pris — merci d'en choisir un autre."));
          setAt(null);
          setStep(1);
          void loadSlots();
          return;
        }
        setErr(j?.error === "rate_limited"
          ? T("Too many attempts. Please try again in a few minutes.",
              "Zu viele Versuche. Bitte in ein paar Minuten erneut versuchen.",
              "Trop de tentatives. Merci de réessayer dans quelques minutes.")
          : T("Something went wrong. Please try again.",
              "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
              "Une erreur est survenue. Merci de réessayer."));
        return;
      }
      setDone(true);
    } catch {
      setErr(T("Network error. Please try again.", "Netzwerkfehler. Bitte erneut versuchen.", "Erreur réseau. Merci de réessayer."));
    } finally {
      setSubmitting(false);
    }
  }

  /* ─────────────────────────────── confirmation ─────────────────────────── */
  if (done) {
    const chosen = at != null ? new Date(at) : null;
    const loc = lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB";
    return (
      // The whole <main> is swapped out on success. Without a live region and a
      // focus target, a keyboard or screen-reader user gets silence — they hit
      // "Confirm" and are never told it worked. tabIndex={-1} + autofocus moves
      // the caret here so the confirmation is the next thing announced.
      <main
        className="mx-auto px-5 py-20 bv-page-bottom bv-enter"
        style={{ maxWidth: 560 }}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        ref={(el) => { el?.focus(); }}
      >
        <div className="bv-card p-8 text-center" style={{ borderRadius: 20 }}>
          <div
            className="mx-auto mb-5 grid place-items-center"
            style={{ width: 56, height: 56, borderRadius: 999, background: "rgba(22,163,74,.14)", border: "1px solid rgba(22,163,74,.4)" }}
          >
            <Check size={26} style={{ color: "#16a34a" }} />
          </div>
          <h1 className="text-[1.4rem] font-medium mb-2" style={{ color: "var(--w)", letterSpacing: "-0.02em" }}>
            {T("You're booked", "Termin bestätigt", "Rendez-vous confirmé")}
          </h1>
          {chosen && (
            <p className="text-[15px] mb-1" style={{ color: "var(--w2)" }}>
              {chosen.toLocaleString(loc, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
          <p className="text-[13px] mb-6" style={{ color: "var(--w3)" }}>
            {T("Times shown in your local timezone.", "Zeiten in Ihrer lokalen Zeitzone.", "Horaires affichés dans votre fuseau horaire.")}
          </p>
          <div
            className="flex items-start gap-3 text-left p-4"
            style={{ borderRadius: 14, background: "var(--bg2)", border: "1px solid var(--border)" }}
          >
            <Video size={18} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 2 }} />
            <p className="text-[13.5px]" style={{ color: "var(--w2)", lineHeight: 1.6 }}>
              {T("A calendar invitation with the video link is on its way to your email. If you don't see it, check your spam folder.",
                 "Eine Kalendereinladung mit dem Video-Link ist auf dem Weg in Ihr Postfach. Falls sie nicht ankommt, prüfen Sie bitte den Spam-Ordner.",
                 "Une invitation avec le lien visio arrive dans votre boîte mail. Si vous ne la voyez pas, vérifiez vos spams.")}
            </p>
          </div>
        </div>
      </main>
    );
  }

  /* ──────────────────────────────── the wizard ──────────────────────────── */
  const STEPS = [
    T("You", "Sie", "Vous"),
    T("Time", "Termin", "Créneau"),
    T("Details", "Angaben", "Coordonnées"),
  ];

  return (
    <main className="mx-auto px-5 py-14 bv-page-bottom bv-enter" style={{ maxWidth: 720 }}>
      <p className="bv-eyebrow mb-2">{T("Book a call", "Termin buchen", "Réserver un appel")}</p>
      <h1 className="text-[clamp(1.6rem,3.4vw,2.2rem)] font-medium mb-2" style={{ color: "var(--w)", letterSpacing: "-0.02em" }}>
        {T("Let's talk", "Sprechen wir", "Parlons-en")}
      </h1>
      {/* Say the three things a hesitant visitor needs BEFORE they commit: it
          costs nothing, it's short, and it's a real conversation with a person.
          "Takes 30 seconds" alone was ambiguous — it reads as the length of the
          CALL rather than of the booking. */}
      <p className="text-[15px] mb-3 bv-measure" style={{ color: "var(--w3)" }}>
        {T(`A free ${slotMinutes}-minute video call with the Borivon team — no obligation.`,
           `Ein kostenloses ${slotMinutes}-minütiges Videogespräch mit dem Borivon-Team — unverbindlich.`,
           `Un appel vidéo gratuit de ${slotMinutes} minutes avec l'équipe Borivon — sans engagement.`)}
      </p>
      <p className="text-[13.5px] mb-8 bv-measure" style={{ color: "var(--w3)" }}>
        {T("Booking takes about 30 seconds.",
           "Die Buchung dauert etwa 30 Sekunden.",
           "La réservation prend environ 30 secondes.")}
      </p>

      {/* step rail */}
      <div className="flex items-center gap-2 mb-8" role="list">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2" role="listitem">
            <span
              className="text-[12px] px-3 py-1.5"
              style={{
                borderRadius: 999,
                color: i === step ? "var(--bg)" : i < step ? "var(--gold)" : "var(--w3)",
                background: i === step ? "var(--gold)" : "transparent",
                border: `1px solid ${i <= step ? "var(--border-gold)" : "var(--border)"}`,
                fontWeight: i === step ? 600 : 400,
              }}
              aria-current={i === step ? "step" : undefined}
            >
              {s}
            </span>
            {i < STEPS.length - 1 && <span style={{ width: 16, height: 1, background: "var(--border)" }} aria-hidden />}
          </div>
        ))}
      </div>

      {/* ── step 0 · who ── */}
      {step === 0 && (
        <div className="grid gap-3 bv-enter-soft">
          {KINDS.map(({ v, Icon, en, de, fr, subEn, subDe, subFr }) => (
            <button
              key={v}
              type="button"
              // The label sits in two nested spans, so the accessible name comes
              // out empty — a screen reader announced three unnamed buttons.
              aria-label={`${tr(lang, en, de, fr)} — ${tr(lang, subEn, subDe, subFr)}`}
              onClick={() => { setKind(v); setStep(1); }}
              className="bv-choice bv-tap text-left flex items-center gap-4 p-4 w-full"
              style={{
                borderRadius: 16,
                border: `1px solid ${kind === v ? "var(--border-gold)" : "var(--border)"}`,
                background: "var(--card)",
              }}
            >
              <span
                className="grid place-items-center flex-shrink-0"
                style={{ width: 44, height: 44, borderRadius: 12, background: "var(--bg2)", border: "1px solid var(--border)" }}
              >
                <Icon size={20} style={{ color: "var(--gold)" }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium" style={{ color: "var(--w)" }}>{tr(lang, en, de, fr)}</span>
                <span className="block text-[13px] mt-0.5" style={{ color: "var(--w3)" }}>{tr(lang, subEn, subDe, subFr)}</span>
              </span>
              <ArrowRight size={16} style={{ color: "var(--w3)", flexShrink: 0 }} aria-hidden />
            </button>
          ))}
        </div>
      )}

      {/* ── step 1 · when ── */}
      {step === 1 && (
        <div className="bv-enter-soft">
          {loading ? (
            <div className="grid gap-2" aria-busy="true">
              {[0, 1, 2].map((i) => <div key={i} className="bv-skeleton" style={{ height: 64, borderRadius: 14 }} />)}
            </div>
          ) : !days.length ? (
            <div className="bv-card p-6 text-center" style={{ borderRadius: 16 }}>
              <CalendarDays size={22} style={{ color: "var(--w3)" }} className="mx-auto mb-3" />
              <p className="text-[14px]" style={{ color: "var(--w2)" }}>
                {T("No times are open right now. Please write to us and we'll find one.",
                   "Aktuell sind keine Termine frei. Schreiben Sie uns — wir finden einen.",
                   "Aucun créneau disponible pour le moment. Écrivez-nous, nous en trouverons un.")}
              </p>
              <a className="bv-link text-[14px] mt-3 inline-block" href="mailto:contact@borivon.com">contact@borivon.com</a>
            </div>
          ) : (
            <>
              {/* days — plain toggle buttons, NOT role="tab": there is no tabpanel
                  here, and the time grid below is a sibling, not a panel. */}
              <div className="flex gap-2 overflow-x-auto pb-3 bv-scroll" role="group" aria-label={T("Day", "Tag", "Jour")}>
                {days.map(({ key, weekday, date }) => {
                  const on = key === selectedDay?.key;
                  return (
                    <button
                      key={key}
                      type="button"
                      // The visible label is split across two spans, which gives
                      // screen readers nothing useful — name it explicitly.
                      aria-label={`${weekday} ${date}`}
                      aria-pressed={on}
                      onClick={() => { setDayKey(key); setAt(null); }}
                      className="bv-tap bv-touch flex-shrink-0 px-4 py-2.5 text-center"
                      style={{
                        borderRadius: 12, minWidth: 76,
                        border: `1px solid ${on ? "var(--border-gold)" : "var(--border)"}`,
                        background: on ? "rgba(212,175,55,.08)" : "var(--card)",
                      }}
                    >
                      <span className="block text-[11px] uppercase" style={{ color: on ? "var(--gold)" : "var(--w3)", letterSpacing: ".06em" }}>{weekday}</span>
                      <span className="block text-[14px] mt-0.5" style={{ color: "var(--w)" }}>{date}</span>
                    </button>
                  );
                })}
              </div>

              {/* times */}
              <p className="flex items-center gap-2 text-[12.5px] mt-4 mb-3" style={{ color: "var(--w3)" }}>
                <Clock size={13} aria-hidden />
                {T(`${slotMinutes} minutes · your local time`,
                   `${slotMinutes} Minuten · Ihre Ortszeit`,
                   `${slotMinutes} minutes · votre heure locale`)}
                {tz ? ` (${tz})` : ""}
              </p>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}>
                {(selectedDay?.slots ?? []).map((s) => {
                  const on = at === s.at;
                  return (
                    <button
                      key={s.at}
                      type="button"
                      onClick={() => { setAt(s.at); setErr(null); }}
                      className="bv-tap bv-touch py-2.5 text-[14px]"
                      style={{
                        borderRadius: 10,
                        border: `1px solid ${on ? "var(--border-gold)" : "var(--border)"}`,
                        background: on ? "var(--gold)" : "var(--card)",
                        color: on ? "var(--bg)" : "var(--w)",
                        fontWeight: on ? 600 : 400,
                      }}
                      aria-pressed={on}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {err && <p className="text-[13px] mt-4" style={{ color: "#ef4444" }} role="alert">{err}</p>}

          <div className="flex items-center gap-3 mt-8">
            <button type="button" onClick={() => setStep(0)} className="bv-btn bv-btn-ghost bv-tap bv-touch flex items-center gap-2">
              <ArrowLeft size={15} aria-hidden /> {T("Back", "Zurück", "Retour")}
            </button>
            <button
              type="button"
              disabled={at == null}
              onClick={() => setStep(2)}
              className="bv-btn bv-btn-primary bv-tap bv-touch flex items-center gap-2"
              style={{ opacity: at == null ? 0.45 : 1 }}
            >
              {T("Continue", "Weiter", "Continuer")} <ArrowRight size={15} aria-hidden />
            </button>
          </div>
        </div>
      )}

      {/* ── step 2 · details ── */}
      {step === 2 && (
        <div className="bv-enter-soft grid gap-4">
          <div>
            <label className="bv-label" htmlFor="bk-name">{T("Full name", "Vollständiger Name", "Nom complet")}</label>
            <input
              id="bk-name" className="bv-input" value={name} autoComplete="name"
              onChange={(e) => setName(e.target.value)} maxLength={120}
              aria-invalid={touched && nameBad}
            />
            {touched && nameBad && <p className="text-[12px] mt-1" style={{ color: "#ef4444" }}>{T("Please enter your name.", "Bitte Namen eingeben.", "Merci d'indiquer votre nom.")}</p>}
          </div>

          <div>
            <label className="bv-label" htmlFor="bk-email">{T("Email", "E-Mail", "E-mail")}</label>
            <input
              id="bk-email" className="bv-input" type="email" value={email} autoComplete="email" inputMode="email"
              onChange={(e) => setEmail(e.target.value)} maxLength={254}
              aria-invalid={touched && emailBad}
            />
            <p className="text-[12px] mt-1" style={{ color: touched && emailBad ? "#ef4444" : "var(--w3)" }}>
              {touched && emailBad
                ? T("Please enter a valid email.", "Bitte gültige E-Mail eingeben.", "Merci d'indiquer un e-mail valide.")
                : T("Your invitation and video link go here.", "Einladung und Video-Link gehen hierhin.", "Votre invitation et le lien visio arrivent ici.")}
            </p>
          </div>

          <div>
            {/* Not a <label htmlFor> — PhoneInput is a composite (country dropdown
                + number field) with no single control to point at. */}
            <p className="bv-label">{T("Phone", "Telefon", "Téléphone")} <span style={{ color: "var(--w3)" }}>({T("optional", "optional", "facultatif")})</span></p>
            <PhoneInput value={phone} onChange={setPhone} />
          </div>

          {isOrg && (
            <div>
              <label className="bv-label" htmlFor="bk-company">
                {kind === "clinic"
                  ? T("Facility name", "Name der Einrichtung", "Nom de l'établissement")
                  : T("Company name", "Firmenname", "Nom de l'entreprise")}
              </label>
              <input id="bk-company" className="bv-input" value={company} autoComplete="organization"
                onChange={(e) => setCompany(e.target.value)} maxLength={160} />
            </div>
          )}

          {/* Everything below is a TAP. Nobody types an answer on this form —
              free-text boxes get skipped or answered in one word, and can't be
              counted. A fixed option list means every booking arrives sorted. */}
          {(kind ? QUESTIONS[kind] : []).map((q) => {
            const picked = selections[q.id] ?? [];
            return (
              <fieldset key={q.id} style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="bv-label" style={{ padding: 0 }}>
                  {tr(lang, q.en, q.de, q.fr)}{" "}
                  <span style={{ color: "var(--w3)" }}>({T("optional", "optional", "facultatif")})</span>
                </legend>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {q.options.map((o) => {
                    const on = picked.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSelections((s) => {
                          const cur = s[q.id] ?? [];
                          const next = q.multi
                            ? (cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id])
                            : (cur[0] === o.id ? [] : [o.id]);   // tapping the chosen one clears it
                          const copy = { ...s };
                          if (next.length) copy[q.id] = next; else delete copy[q.id];
                          return copy;
                        })}
                        className="bv-tap bv-touch flex items-center gap-2 px-3 py-2 text-[13.5px] text-left"
                        style={{
                          borderRadius: 10,
                          border: `1px solid ${on ? "var(--border-gold)" : "var(--border)"}`,
                          background: on ? "rgba(212,175,55,.10)" : "var(--card)",
                          color: on ? "var(--w)" : "var(--w2)",
                        }}
                      >
                        <span
                          aria-hidden
                          className="grid place-items-center flex-shrink-0"
                          style={{
                            width: 16, height: 16,
                            borderRadius: q.multi ? 5 : 999,
                            border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`,
                            background: on ? "var(--gold)" : "transparent",
                          }}
                        >
                          {on && <Check size={11} strokeWidth={3} style={{ color: "var(--bg)" }} />}
                        </span>
                        {tr(lang, o.en, o.de, o.fr)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          {err && <p className="text-[13px]" style={{ color: "#ef4444" }} role="alert">{err}</p>}

          <div className="flex items-center gap-3 mt-2">
            <button type="button" onClick={() => setStep(1)} disabled={submitting}
              className="bv-btn bv-btn-ghost bv-tap bv-touch flex items-center gap-2">
              <ArrowLeft size={15} aria-hidden /> {T("Back", "Zurück", "Retour")}
            </button>
            <button type="button" onClick={submit} disabled={submitting}
              className="bv-btn bv-btn-primary bv-tap bv-touch flex items-center gap-2">
              {submitting
                ? <><Loader2 size={15} className="animate-spin" aria-hidden /> {T("Booking…", "Wird gebucht…", "Réservation…")}</>
                : <>{T("Confirm booking", "Termin bestätigen", "Confirmer le rendez-vous")} <Check size={15} aria-hidden /></>}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
