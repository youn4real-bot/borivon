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
 * LAYOUT — deliberately the Calendly shape, because that flow is tuned for
 * conversion and this page is measured on booking rate:
 *
 *   ┌────────────┬──────────────────────────────┐
 *   │ meeting    │  month grid   │  times       │
 *   │ summary    │               │  column      │
 *   │ (sticky)   │               │              │
 *   └────────────┴──────────────────────────────┘
 *
 * The left rail is reassurance that never scrolls away — who you are meeting,
 * how long it takes, that it's a video call, and which clock the times are in.
 * That is what answers "what am I actually signing up for" at the exact moment
 * of doubt. On a narrow screen the panes STACK (summary → calendar → times),
 * because most candidates arrive on an iPhone over Moroccan mobile data.
 *
 * The SKIN is Borivon's own: design tokens and bv-* primitives only. We copied
 * the layout and the interaction, never the colours or the type.
 *
 * Trilingual inline (LAW #19).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/components/LangContext";
import { PhoneInput } from "@/components/PhoneInput";
import { QUESTIONS, type Selections } from "@/lib/booking";
import {
  Stethoscope, Building2, GraduationCap, ArrowLeft, ArrowRight,
  Loader2, Check, CalendarDays, Clock, Video, Globe, ChevronLeft, ChevronRight,
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

/* ───────────────────────────── date plumbing ─────────────────────────────
 * All of it in the VISITOR's own local clock. `new Date(y, m, d)` is the local
 * constructor on purpose: day arithmetic done this way survives a DST change,
 * where adding 86_400_000 ms does not.
 * ------------------------------------------------------------------------ */

/** "YYYY-MM-DD" in the visitor's own timezone — the key everything is filed under. */
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const parseKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** A month as a single sortable number, so "is this month reachable" is a compare. */
const anchorOf = (y: number, m: number) => y * 12 + m;
const anchorOfDate = (d: Date) => anchorOf(d.getFullYear(), d.getMonth());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * The cells of one month, Monday-first, padded to whole weeks.
 * `null` = a leading/trailing blank, rendered as an empty cell rather than a
 * neighbouring month's date — a greyed-out 31st from last month is the single
 * most common misclick in a date picker.
 */
function monthCells(year: number, month: number): (Date | null)[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;   // Mon=0 … Sun=6
  const total = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Weekday names in the active language. 2024-01-01 was a Monday. */
function weekdayNames(loc: string): { short: string; long: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 1 + i);
    return {
      short: d.toLocaleDateString(loc, { weekday: "short" }),
      long: d.toLocaleDateString(loc, { weekday: "long" }),
    };
  });
}

/**
 * Regroup the offered instants into the VISITOR's own days and times.
 *
 * The server groups by Morocco days because that's where the availability
 * windows live, but showing Morocco time to a clinic in Kiel means they pick
 * "14:00" and the confirmation — and the Google invite — say 15:00. Everything
 * the visitor sees is their own clock; only the instants cross the wire.
 *
 * This is also what the month grid is built from: which DAYS are clickable is
 * derived from these instants, never from the server's day strings, or a
 * visitor in Auckland would see a day light up that has nothing on it for them.
 */
function localDays(instants: number[], lang: string): { key: string; weekday: string; date: string; slots: { at: number; label: string }[] }[] {
  const loc = locOf(lang);
  const byDay = new Map<string, number[]>();
  for (const at of instants) {
    const key = keyOf(new Date(at));
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

/**
 * @param initialKind  Set by a shareable per-audience link (/book/nurse etc.).
 *                     When present, step 0 ("who are you?") is answered already
 *                     and skipped — the person you sent the link to lands on the
 *                     calendar, which is the entire point of handing out a link.
 * @param eventType    The slug, sent with the booking so the server can apply
 *                     that type's own duration and record which link was used.
 * @param headline     Per-type title/blurb, already translated by the server.
 */
export function BookingFlow({
  initialKind,
  eventType,
  headline,
  blurb,
}: {
  initialKind?: Kind;
  eventType?: string;
  headline?: { en: string; de: string; fr: string };
  blurb?: { en: string; de: string; fr: string };
} = {}) {
  const { lang } = useLang();
  const T = useCallback((en: string, de: string, fr: string) => tr(lang, en, de, fr), [lang]);
  const loc = locOf(lang);

  // Start on "when" when the link already said who they are.
  const [step, setStep] = useState(initialKind ? 1 : 0);   // 0 who · 1 when · 2 details
  const [loading, setLoading] = useState(true);
  const [instants, setInstants] = useState<number[]>([]);
  const [accepting, setAccepting] = useState(true);
  const [tz, setTz] = useState("");
  const [slotMinutes, setSlotMinutes] = useState(30);

  const [kind, setKind] = useState<Kind | null>(initialKind ?? null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);

  // Which month the grid is showing, as a y*12+m anchor. null = "not chosen
  // yet", which resolves to the first month that actually has something free.
  const [monthAnchor, setMonthAnchor] = useState<number | null>(null);
  // Roving tabindex: exactly one day in the grid is tabbable at a time.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const wantFocus = useRef<string | null>(null);

  // Where a step swap must land the visitor. The browser preserves the old
  // scroll offset across a step change, and step 1 is taller than a phone
  // viewport, so "Confirm" at the bottom of the times list drops her into the
  // MIDDLE of the details form — name, email and their error messages all above
  // the fold. She taps the one button she can see, nothing visibly happens, and
  // the booking is lost on the very last tap.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const timesRef = useRef<HTMLDivElement | null>(null);
  const stepped = useRef(false);

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
      // The type decides the meeting length, so the grid must be built for it —
      // a 45-minute company call cannot be offered on a 30-minute grid.
      const r = await fetch(eventType ? `/api/book?type=${encodeURIComponent(eventType)}` : "/api/book", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      // Only the INSTANTS cross the wire. The server groups by Morocco days
      // because that's where the availability lives; we regroup into the
      // visitor's own days below so nothing they see is in a foreign clock.
      type RawDay = { slots?: { at?: unknown }[] };
      const list = (Array.isArray(j?.days) ? (j.days as RawDay[]) : [])
        .flatMap((d) => (d.slots ?? []).map((s) => Number(s?.at)))
        .filter((n) => Number.isFinite(n));
      setInstants(list);
      // Only an explicit false closes the page — an old cached response without
      // the field must keep working exactly as it did.
      setAccepting(j?.accepting !== false);
      setSlotMinutes(Number(j?.slotMinutes) || 30);
    } catch {
      setInstants([]);
    } finally {
      setLoading(false);
    }
  }, [eventType]);

  useEffect(() => { void loadSlots(); }, [loadSlots]);

  // Show the time in THEIR timezone name, so nobody assumes it's their own
  // clock. Every label on this page is already in the visitor's own zone.
  useEffect(() => {
    try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""); } catch { /* older browser */ }
  }, []);

  const days = useMemo(() => localDays(instants, lang), [instants, lang]);
  const byKey = useMemo(() => new Map(days.map((d) => [d.key, d])), [days]);

  /* Month bounds. Past months are unreachable; so is anything beyond the last
     day the API actually offered — an arrow that leads to a guaranteed-empty
     month is a dead end dressed up as progress. */
  const todayAnchor = useMemo(() => anchorOfDate(new Date()), []);
  const availAnchors = useMemo(
    () => [...new Set(days.map((d) => anchorOfDate(parseKey(d.key))))].sort((a, b) => a - b),
    [days],
  );
  const minAnchor = todayAnchor;
  const maxAnchor = Math.max(todayAnchor, availAnchors[availAnchors.length - 1] ?? todayAnchor);
  // Default to the FIRST month with availability, not to today — if the diary
  // is full until the 3rd of next month, opening on an empty grid reads as
  // "nothing is available" and the visitor leaves.
  const anchor = Math.min(maxAnchor, Math.max(minAnchor, monthAnchor ?? availAnchors[0] ?? todayAnchor));
  const gridYear = Math.floor(anchor / 12);
  const gridMonth = anchor - gridYear * 12;
  const cells = useMemo(() => monthCells(gridYear, gridMonth), [gridYear, gridMonth]);
  const weekdays = useMemo(() => weekdayNames(loc), [loc]);

  // The day whose times are on screen. It must belong to the month the grid is
  // SHOWING — otherwise "next month" leaves September's calendar sat beside
  // August's times with nothing highlighted, and a visitor who taps one books a
  // month earlier than the grid in front of them says. Pre-selecting the first
  // free day OF THAT MONTH means they still see real times immediately.
  const activeKey =
    dayKey && byKey.has(dayKey) && anchorOfDate(parseKey(dayKey)) === anchor
      ? dayKey
      : days.find((d) => anchorOfDate(parseKey(d.key)) === anchor)?.key ?? null;
  const selectedDay = activeKey ? byKey.get(activeKey) ?? null : null;

  // Exactly one tabbable day, and it must live in the month on screen.
  const inGrid = (k: string | null) => !!k && anchorOfDate(parseKey(k)) === anchor;
  const firstCellKey = cells.find((c): c is Date => !!c);
  const rovingKey =
    (inGrid(focusKey) ? focusKey : null) ??
    (inGrid(activeKey) ? activeKey : null) ??
    (days.find((d) => anchorOfDate(parseKey(d.key)) === anchor)?.key ?? null) ??
    (firstCellKey ? keyOf(firstCellKey) : null);

  // Moving to another month re-renders the grid before the target day exists,
  // so the focus is handed over on the next commit instead.
  useEffect(() => {
    const k = wantFocus.current;
    if (!k) return;
    wantFocus.current = null;
    dayRefs.current.get(k)?.focus();
  });

  // Bring each new step to the top of the viewport. Skipped on first paint so a
  // deep-linked /book/nurse doesn't yank the page out from under the arrival.
  useEffect(() => {
    if (!stepped.current) { stepped.current = true; return; }
    panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [step]);

  const goMonth = useCallback((next: number) => {
    setMonthAnchor(Math.min(maxAnchor, Math.max(minAnchor, next)));
    // A time held in the month they just left must not stay armed in the rail —
    // the grid can no longer show it, so nothing on screen could un-choose it.
    setDayKey(null);
    setAt(null);
  }, [minAnchor, maxAnchor]);

  const isOrg = kind === "clinic" || kind === "company";
  const emailBad = !EMAIL_RE.test(email.trim());
  const nameBad = name.trim().length < 2;
  const canSubmit = !!kind && at != null && !nameBad && !emailBad;

  /** Full-date label for the times column header and the summary rail. */
  const longDate = (k: string) =>
    parseKey(k).toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" });

  /**
   * Arrow-key navigation over the grid, per the WAI-ARIA date-picker pattern.
   * Unavailable days stay focusable (aria-disabled, not `disabled`) so keyboard
   * users can traverse the month instead of being teleported over the gaps.
   */
  function onGridKeys(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!rovingKey) return;
    const cur = parseKey(rovingKey);
    const dow = (cur.getDay() + 6) % 7;
    let next: Date | null = null;
    if (e.key === "ArrowLeft") next = addDays(cur, -1);
    else if (e.key === "ArrowRight") next = addDays(cur, 1);
    else if (e.key === "ArrowUp") next = addDays(cur, -7);
    else if (e.key === "ArrowDown") next = addDays(cur, 7);
    else if (e.key === "Home") next = addDays(cur, -dow);
    else if (e.key === "End") next = addDays(cur, 6 - dow);
    else if (e.key === "PageUp") next = new Date(cur.getFullYear(), cur.getMonth() - 1, 1);
    else if (e.key === "PageDown") next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    else return;
    e.preventDefault();
    const nextAnchor = anchorOfDate(next);
    if (nextAnchor < minAnchor || nextAnchor > maxAnchor) return;
    const k = keyOf(next);
    setFocusKey(k);
    // Leaving the month must clear the held day/time for the same reason the
    // arrows do it: the grid can no longer show what is armed.
    if (nextAnchor !== anchor) { wantFocus.current = k; setMonthAnchor(nextAnchor); setDayKey(null); setAt(null); }
    else dayRefs.current.get(k)?.focus();
  }

  function pickDay(k: string) {
    setDayKey(k);
    setFocusKey(k);
    setAt(null);
    setErr(null);
    // Below md the times sit UNDER a six-row month grid, i.e. off-screen. Without
    // this, tapping a day changes one 44px cell's colour and nothing else the
    // visitor can see — the times she just asked for stay below the fold.
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 768px)").matches) {
      requestAnimationFrame(() => timesRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }

  async function submit() {
    if (!canSubmit) {
      setTouched(true);
      // A button that silently does nothing is the end of the booking. Say what
      // is missing AND put it in front of her eyes.
      if (at == null) {
        setErr(T("Please pick a time first.",
                 "Bitte zuerst einen Termin wählen.",
                 "Merci de choisir d'abord un créneau."));
        setStep(1);
        return;
      }
      const bad = nameBad ? nameRef.current : emailBad ? emailRef.current : null;
      bad?.scrollIntoView({ block: "center", behavior: "smooth" });
      bad?.focus({ preventScroll: true });
      return;
    }
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
          // Which shareable link this came through. Decides the meeting length
          // server-side and records how the lead arrived.
          ...(eventType ? { type: eventType } : {}),
          // So the confirmation, reminder and any cancellation come back in the
          // language they actually booked in.
          lang,
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
          {/* The address the invite actually went to, echoed back — a typo'd
              email is otherwise a booking she never hears about again and has
              no way left to notice, because the form is gone. */}
          <p className="text-[14px] mb-1" style={{ color: "var(--w2)" }}>
            {T("Invitation sent to", "Einladung an", "Invitation envoyée à")}{" "}
            <strong style={{ color: "var(--w)", fontWeight: 600 }}>{email.trim()}</strong>
          </p>
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
  // A shareable link already answered "who are you?", so that step must not
  // appear in the rail either — a permanently-completed first step is noise.
  const STEPS: { i: number; label: string }[] = [
    ...(initialKind ? [] : [{ i: 0, label: T("You", "Sie", "Vous") }]),
    { i: 1, label: T("Time", "Termin", "Créneau") },
    { i: 2, label: T("Details", "Angaben", "Coordonnées") },
  ];

  // The IANA id is an identifier, not a label — "Europe/Vienna" is English even
  // for a German reader. Intl names the zone in the active language; the id
  // stays as the fallback for zones Intl cannot name (or cannot even parse).
  const zoneName = (id: string) => {
    const city = id.split("/").pop()?.replace(/_/g, " ") || id;
    try {
      const name = new Intl.DateTimeFormat(loc, { timeZone: id, timeZoneName: "long" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value;
      if (!name) return city;
      // CLDR has no long name for every zone — Africa/Casablanca, this page's
      // single most common one, comes back as a bare "GMT+01:00". An offset is
      // precise but unrecognisable, so the city leads and the offset qualifies.
      return /^(GMT|UTC)/i.test(name) ? `${city} · ${name}` : name;
    } catch {
      return city;
    }
  };
  const tzLine = tz ? zoneName(tz) : T("Your local time", "Ihre Ortszeit", "Votre heure locale");
  const noTimes = !accepting || !days.length;

  /* ── the left rail: what am I signing up for? ── */
  const summary = (
    <aside
      className="bv-card p-5 lg:sticky"
      style={{ borderRadius: 18, top: 88, alignSelf: "start" }}
      aria-label={T("About this meeting", "Über diesen Termin", "À propos de ce rendez-vous")}
    >
      <p className="bv-eyebrow mb-2">{T("Borivon", "Borivon", "Borivon")}</p>
      <h1 className="text-[clamp(1.25rem,2.6vw,1.6rem)] font-medium mb-2" style={{ color: "var(--w)", letterSpacing: "-0.02em" }}>
        {/* A shareable link names its own meeting: someone who was sent
            /book/company should see "German training for teams", not a generic
            greeting that leaves them wondering if they clicked the right thing. */}
        {headline ? headline[lang] : T("Let's talk", "Sprechen wir", "Parlons-en")}
      </h1>

      <ul className="grid gap-2.5 mt-4" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <li className="flex items-center gap-2.5 text-[13.5px]" style={{ color: "var(--w2)" }}>
          <Clock size={15} style={{ color: "var(--gold)", flexShrink: 0 }} aria-hidden />
          {T(`${slotMinutes} min`, `${slotMinutes} Min.`, `${slotMinutes} min`)}
        </li>
        <li className="flex items-center gap-2.5 text-[13.5px]" style={{ color: "var(--w2)" }}>
          <Video size={15} style={{ color: "var(--gold)", flexShrink: 0 }} aria-hidden />
          {T("Video call — link by email", "Videogespräch — Link per E-Mail", "Appel vidéo — lien par e-mail")}
        </li>
        <li className="flex items-start gap-2.5 text-[13.5px]" style={{ color: "var(--w2)" }}>
          <Globe size={15} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 2 }} aria-hidden />
          <span>
            {T("Times in your timezone", "Zeiten in Ihrer Zeitzone", "Horaires dans votre fuseau")}
            <span className="block text-[12.5px]" style={{ color: "var(--w3)" }}>{tzLine}</span>
          </span>
        </li>
      </ul>

      {/* The choice, echoed back. Once a time is held this is the thing the
          visitor keeps glancing at while they fill in the form. */}
      {at != null && (
        <div
          className="flex items-start gap-2.5 mt-4 p-3 bv-enter-soft"
          style={{ borderRadius: 12, background: "var(--gdim)", border: "1px solid var(--border-gold)" }}
        >
          <CalendarDays size={15} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 2 }} aria-hidden />
          <p className="text-[13.5px]" style={{ color: "var(--w)", lineHeight: 1.5 }}>
            {new Date(at).toLocaleString(loc, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      )}

      <p className="text-[13px] mt-4" style={{ color: "var(--w3)", lineHeight: 1.6 }}>
        {/* Say the three things a hesitant visitor needs BEFORE they commit: it
            costs nothing, it's short, and it's a real conversation with a person. */}
        {blurb
          ? blurb[lang]
          : T(`A free ${slotMinutes}-minute video call with the Borivon team — no obligation.`,
              `Ein kostenloses ${slotMinutes}-minütiges Videogespräch mit dem Borivon-Team — unverbindlich.`,
              `Un appel vidéo gratuit de ${slotMinutes} minutes avec l'équipe Borivon — sans engagement.`)}
      </p>
      <p className="text-[12.5px] mt-2" style={{ color: "var(--w3)" }}>
        {T("Booking takes about 30 seconds.",
           "Die Buchung dauert etwa 30 Sekunden.",
           "La réservation prend environ 30 secondes.")}
      </p>
    </aside>
  );

  /* ── the month grid ── */
  const monthTitle = new Date(gridYear, gridMonth, 1).toLocaleDateString(loc, { month: "long", year: "numeric" });
  const calendar = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[14.5px] font-medium" style={{ color: "var(--w)" }} id="bv-month-title" aria-live="polite">
          {monthTitle}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goMonth(anchor - 1)}
            disabled={anchor <= minAnchor}
            aria-label={T("Previous month", "Vorheriger Monat", "Mois précédent")}
            className="bv-tap grid place-items-center"
            style={{
              width: 44, height: 44, borderRadius: 12,
              border: "1px solid var(--border)", background: "var(--bg2)",
              color: anchor <= minAnchor ? "var(--w3)" : "var(--w2)",
              opacity: anchor <= minAnchor ? 0.4 : 1,
              cursor: anchor <= minAnchor ? "not-allowed" : "pointer",
            }}
          >
            <ChevronLeft size={18} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => goMonth(anchor + 1)}
            disabled={anchor >= maxAnchor}
            aria-label={T("Next month", "Nächster Monat", "Mois suivant")}
            className="bv-tap grid place-items-center"
            style={{
              width: 44, height: 44, borderRadius: 12,
              border: "1px solid var(--border)", background: "var(--bg2)",
              color: anchor >= maxAnchor ? "var(--w3)" : "var(--w2)",
              opacity: anchor >= maxAnchor ? 0.4 : 1,
              cursor: anchor >= maxAnchor ? "not-allowed" : "pointer",
            }}
          >
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
      </div>

      {/* The negative margin is a touch-target decision, not a cosmetic one:
          seven 44px cells plus gaps do not fit inside the card's padding on a
          phone, and 39px squares are exactly the misclick that loses a booking.
          -mx-4 exactly cancels the card's own p-4 (a smaller claw-back left
          42.7px cells at 360px — the dominant Android width in Morocco — while
          passing at 375px only), and the gap drops to 1px to buy the rest.
          Measured: 360px → 44.7px, 375px → 46.9px, no horizontal overflow, the
          grid still inside the card's border. From sm up the card has room to
          spare and both the margin and the tight gap go away. */}
      <div role="grid" aria-labelledby="bv-month-title" onKeyDown={onGridKeys} className="-mx-4 sm:mx-0">
        <div role="row" className="grid gap-px sm:gap-1" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
          {weekdays.map((w) => (
            <div
              key={w.long}
              role="columnheader"
              aria-label={w.long}
              className="text-center text-[11px] uppercase pb-2"
              style={{ color: "var(--w3)", letterSpacing: ".06em" }}
            >
              {w.short}
            </div>
          ))}
        </div>

        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <div key={row} role="row" className="grid gap-px sm:gap-1 mb-px sm:mb-1" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
            {cells.slice(row * 7, row * 7 + 7).map((cell, col) => {
              if (!cell) return <div key={`b${col}`} role="gridcell" />;
              const k = keyOf(cell);
              const day = byKey.get(k);
              const free = (day?.slots.length ?? 0) > 0;
              const on = free && k === activeKey;
              const label = cell.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
              return (
                <div key={k} role="gridcell" aria-selected={on}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) dayRefs.current.set(k, el); else dayRefs.current.delete(k);
                    }}
                    tabIndex={k === rovingKey ? 0 : -1}
                    // Kept focusable when there is nothing free (aria-disabled,
                    // not `disabled`) so arrow keys can cross an empty weekend.
                    aria-disabled={!free}
                    aria-pressed={on}
                    aria-label={free
                      ? `${label} — ${day!.slots.length} ${day!.slots.length === 1
                          ? T("time available", "Termin frei", "créneau disponible")
                          : T("times available", "Termine frei", "créneaux disponibles")}`
                      : `${label} — ${T("no times", "keine Termine", "aucun créneau")}`}
                    onClick={() => { if (free) pickDay(k); else setFocusKey(k); }}
                    className="bv-tap w-full grid place-items-center"
                    style={{
                      minHeight: 44, borderRadius: 12,
                      // Not colour-only: the chosen day is also the only one
                      // that is bold and ringed, and it reports aria-pressed.
                      border: `1px solid ${on ? "var(--gold)" : free ? "var(--border)" : "transparent"}`,
                      boxShadow: on ? "0 0 0 2px var(--border-gold)" : "none",
                      background: on ? "var(--gold)" : free ? "var(--card)" : "transparent",
                      // #131312, not var(--bg): in the light theme --bg is pearl
                      // white, and white-on-gold is ~3.4:1. This is the same ink
                      // .bv-btn-primary puts on gold, and it passes in both themes.
                      // No extra opacity on dead days: --w3 is ALREADY a 58%
                      // ink, and dimming it again lands the date number at
                      // 1.64:1 on the card — illegible on a phone outdoors, and
                      // two thirds of a month's cells are dead days. They stay
                      // plainly recessive via the missing dot, the transparent
                      // background and the lighter weight.
                      color: on ? "#131312" : free ? "var(--w)" : "var(--w3)",
                      fontWeight: on ? 700 : free ? 500 : 400,
                      cursor: free ? "pointer" : "default",
                    }}
                  >
                    <span className="text-[14px] leading-none">{cell.getDate()}</span>
                    {/* A shape, not just a colour: free days carry a dot. */}
                    <span
                      aria-hidden
                      style={{
                        width: 4, height: 4, borderRadius: 999, marginTop: 3,
                        background: on ? "#131312" : free ? "var(--gold)" : "transparent",
                      }}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  /* ── the times column ── */
  const times = (
    <div className="min-w-0 scroll-mt-4" ref={timesRef}>
      {/* aria-live, like the month title: picking a day swaps this whole list
          while focus stays on the day button, so without it a screen-reader
          user gets no confirmation that anything happened. The heading is
          already the translated long date, so it announces the right thing. */}
      <p className="text-[14.5px] font-medium mb-1" style={{ color: "var(--w)" }} id="bv-times-title" aria-live="polite">
        {activeKey ? longDate(activeKey) : T("Pick a day", "Tag wählen", "Choisissez un jour")}
      </p>
      {/* The timezone is stated right where the times are, always — a booking
          made in the wrong clock is a no-show. */}
      <p className="flex items-start gap-1.5 text-[12px] mb-3" style={{ color: "var(--w3)" }}>
        <Globe size={12} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
        <span>
          {T(`${slotMinutes} min · your time`, `${slotMinutes} Min. · Ihre Zeit`, `${slotMinutes} min · votre heure`)}
          {tz ? ` · ${tzLine}` : ""}
        </span>
      </p>
      {/* The list only becomes its own scroll region once it sits BESIDE the
          calendar. On a phone it is the last thing on the page, so a nested
          scroller there would just be a second thing to fight with a thumb. */}
      <ul
        className="grid grid-cols-2 md:grid-cols-1 gap-2 bv-scroll md:max-h-[min(60vh,420px)] md:overflow-y-auto md:pr-1"
        style={{ listStyle: "none", padding: 0, margin: 0 }}
        aria-labelledby="bv-times-title"
      >
        {(selectedDay?.slots ?? []).map((s) => {
          const on = at === s.at;
          // Two columns on a phone — a 16-slot day is ~820px of identical 44px
          // rows in one column, which is most of a second screen. The chosen row
          // spans both so the time and its Confirm still sit side by side under
          // the thumb.
          return (
            <li key={s.at} className={`flex gap-2 ${on ? "col-span-2 md:col-span-1" : ""}`}>
              <button
                type="button"
                onClick={() => { setAt(on ? null : s.at); setErr(null); }}
                aria-pressed={on}
                className="bv-tap flex-1 flex items-center justify-center gap-1.5 text-[14px]"
                style={{
                  minHeight: 44, borderRadius: 10,
                  border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`,
                  background: on ? "var(--gdim)" : "var(--card)",
                  // Gold-on-gdim would be ~3.4:1 in the light theme. The chosen
                  // time keeps full-contrast ink; the selection is carried by
                  // the border, the wash, the weight and the tick.
                  color: "var(--w)",
                  fontWeight: on ? 600 : 400,
                }}
              >
                {on && <Check size={13} strokeWidth={3} style={{ color: "var(--gold)" }} aria-hidden />}
                {s.label}
              </button>
              {/* Calendly's move: choosing a time SPLITS the row and puts the
                  commit right under the thumb, instead of scrolling the page
                  to a button somewhere else. */}
              {on && (
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="bv-btn bv-btn-primary bv-tap flex-1 bv-enter-soft"
                  style={{ minHeight: 44 }}
                >
                  {T("Confirm", "Bestätigen", "Confirmer")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <main className="mx-auto px-5 py-14 bv-page-bottom bv-enter" style={{ maxWidth: 1040 }}>
      {/* Two panes on a wide screen, one column on a phone. The inline
          grid-template only bites once `display:grid` is switched on at lg. */}
      <div className="lg:grid lg:gap-8" style={{ gridTemplateColumns: "300px minmax(0, 1fr)" }}>
        {/* On a narrow screen this stacks FIRST — the reassurance has to be
            read before the calendar, not after it. */}
        <div className="mb-6 lg:mb-0">{summary}</div>

        <div className="min-w-0" ref={panelRef}>
          {/* step rail */}
          <div className="flex items-center gap-2 mb-6" role="list">
            {STEPS.map((s, idx) => (
              <div key={s.i} className="flex items-center gap-2" role="listitem">
                <span
                  className="text-[12px] px-3 py-1.5"
                  style={{
                    borderRadius: 999,
                    // #131312, not var(--bg): in the light theme --bg is pearl
                    // white and white-on-gold is ~3.1:1, which fails AA for
                    // 12px semibold. Same ink .bv-btn-primary puts on gold.
                    color: s.i === step ? "#131312" : s.i < step ? "var(--gold)" : "var(--w3)",
                    background: s.i === step ? "var(--gold)" : "transparent",
                    border: `1px solid ${s.i <= step ? "var(--border-gold)" : "var(--border)"}`,
                    fontWeight: s.i === step ? 600 : 400,
                  }}
                  aria-current={s.i === step ? "step" : undefined}
                >
                  {s.label}
                </span>
                {idx < STEPS.length - 1 && <span style={{ width: 16, height: 1, background: "var(--border)" }} aria-hidden />}
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
              {/* Above the calendar, never under it: this is the message that
                  explains why she was just thrown out of the details form. Under
                  a full month grid plus a times list it is a screen and a half
                  below the fold — i.e. never read, and the booking is gone with
                  no reason given. */}
              {err && (
                <p
                  className="text-[13px] mb-4 p-3"
                  role="alert"
                  style={{
                    borderRadius: 12,
                    color: "#ef4444",
                    background: "rgba(239,68,68,.08)",
                    border: "1px solid rgba(239,68,68,.35)",
                  }}
                >
                  {err}
                </p>
              )}
              {loading ? (
                <div className="grid gap-2" aria-busy="true">
                  <div className="bv-skeleton" style={{ height: 44, borderRadius: 12 }} />
                  <div className="bv-skeleton" style={{ height: 240, borderRadius: 14 }} />
                </div>
              ) : noTimes ? (
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
                // Calendar and times side by side from tablet up; stacked on a
                // phone, calendar first — the order the decision is made in.
                <div
                  className="bv-card p-4 sm:p-5 grid gap-6 md:gap-5 md:grid-cols-[minmax(0,1fr)_200px]"
                  style={{ borderRadius: 18 }}
                >
                  {calendar}
                  {times}
                </div>
              )}

              {/* Hidden when a shareable link already answered "who are you?" —
                  sending them back to the audience picker is the one place this
                  flow could undo the whole point of handing out /book/company. */}
              {!initialKind && (
                <div className="flex items-center gap-3 mt-6">
                  <button type="button" onClick={() => setStep(0)} className="bv-btn bv-btn-ghost bv-tap bv-touch flex items-center gap-2">
                    <ArrowLeft size={15} aria-hidden /> {T("Back", "Zurück", "Retour")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── step 2 · details ── */}
          {step === 2 && (
            <div className="bv-enter-soft grid gap-4">
              <div>
                <label className="bv-label" htmlFor="bk-name">{T("Full name", "Vollständiger Name", "Nom complet")}</label>
                <input
                  id="bk-name" ref={nameRef} className="bv-input" value={name} autoComplete="name"
                  onChange={(e) => setName(e.target.value)} maxLength={120}
                  aria-invalid={touched && nameBad}
                />
                {touched && nameBad && <p className="text-[12px] mt-1" style={{ color: "#ef4444" }}>{T("Please enter your name.", "Bitte Namen eingeben.", "Merci d'indiquer votre nom.")}</p>}
              </div>

              <div>
                <label className="bv-label" htmlFor="bk-email">{T("Email", "E-Mail", "E-mail")}</label>
                <input
                  id="bk-email" ref={emailRef} className="bv-input" type="email" value={email} autoComplete="email" inputMode="email"
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
                              minHeight: 44,
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
                              {/* Same gold-chip ink problem as the step rail. */}
                              {on && <Check size={11} strokeWidth={3} style={{ color: "#131312" }} />}
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
        </div>
      </div>
    </main>
  );
}
