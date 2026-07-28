/**
 * Slot engine for the public booking page — PURE, so the one thing that must
 * never be wrong (which minutes are actually offerable) is fully unit-tested.
 *
 * Everything here works in UTC instants. The page renders them in Casablanca
 * time; the DB stores timestamptz. No local-time arithmetic anywhere, because
 * that is exactly where booking systems quietly break across a DST change.
 */

/** A bookable window: [start, end) as epoch ms. */
export type Interval = { start: number; end: number };

export type Availability = {
  /** Weekday → list of "HH:MM-HH:MM" working windows in the business timezone.
   *  0 = Sunday … 6 = Saturday. A missing/empty day means closed. */
  week: Record<number, string[]>;
  /** How long one appointment is. */
  slotMinutes: number;
  /** Don't offer anything sooner than this many hours from now — you need
   *  warning, and a slot 5 minutes away is a no-show waiting to happen. */
  minNoticeHours: number;
  /** How far ahead the page offers. */
  horizonDays: number;
  /** Business timezone offset in minutes (Casablanca = UTC+1). Kept explicit
   *  rather than reading the server's clock, which on Workers is UTC. Used as
   *  the fallback when `tz` is not set. */
  tzOffsetMinutes: number;
  /** IANA zone name. When set, the offset is resolved PER DAY instead of once,
   *  so days on the far side of a clock change keep the real working hours.
   *  Morocco flips UTC+1 → UTC+0 for Ramadan and back, and the offer horizon is
   *  14 days, so a single request routinely spans a transition. */
  tz?: string;
  /** Breathing room around every existing commitment. A call that ends at 11:00
   *  should not be followed by one starting at 11:00 — you need a minute to
   *  write the notes and take a breath. Applied to BOTH sides of anything busy. */
  bufferMinutes?: number;
  /** Days off, as "YYYY-MM-DD" in the business timezone: holidays, Aïd, travel.
   *  Nothing is offered on these days at all. */
  blackoutDates?: string[];
};

/** Borivon's default: weekdays 09:00–18:00, half-hour calls, a day's notice. */
export const DEFAULT_AVAILABILITY: Availability = {
  week: {
    1: ["09:00-13:00", "14:00-18:00"],
    2: ["09:00-13:00", "14:00-18:00"],
    3: ["09:00-13:00", "14:00-18:00"],
    4: ["09:00-13:00", "14:00-18:00"],
    5: ["09:00-13:00", "14:00-18:00"],
  },
  slotMinutes: 30,
  minNoticeHours: 12,
  horizonDays: 14,
  tzOffsetMinutes: 60,
};

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/**
 * The REAL UTC offset (in minutes) of an IANA zone at a given instant.
 *
 * Morocco sits at UTC+1 but drops to UTC+0 for Ramadan every year. A hardcoded
 * +60 would mislabel every slot on the page for those weeks — the visitor books
 * "10:00" and the calendar invite says 09:00. Resolving it against the real zone
 * keeps the page and the invite telling the same story.
 */
/**
 * One formatter per timezone, kept for the life of the isolate.
 *
 * `new Intl.DateTimeFormat(...)` is expensive — it loads and configures ICU
 * data — and this function is called ONCE PER SLOT when the booking API labels
 * its response, so a two-week horizon built roughly 160 of them per request.
 * Measured on production: the calendar fetch took 0.6–2.0s while the whole
 * handler took 2.4–4.7s, and that ~2s gap was almost entirely this. The
 * formatter itself is stateless — the instant is an argument to formatToParts —
 * so there is nothing to invalidate and one instance serves every call.
 */
const OFFSET_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let f = OFFSET_FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    OFFSET_FORMATTERS.set(tz, f);
  }
  return f;
}

export function zoneOffsetMinutes(tz: string, at: number = Date.now()): number {
  try {
    const d = new Date(at);
    const p = offsetFormatter(tz).formatToParts(d).reduce((a, x) => {
      if (x.type !== "literal") a[x.type] = x.value;
      return a;
    }, {} as Record<string, string>);
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const mins = Math.round((asUtc - d.getTime()) / MIN);
    return Number.isFinite(mins) ? mins : DEFAULT_AVAILABILITY.tzOffsetMinutes;
  } catch {
    return DEFAULT_AVAILABILITY.tzOffsetMinutes;
  }
}

/** "HH:MM" → minutes past midnight, or null if malformed. */
export function parseHm(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

/** True when the two half-open intervals overlap at all. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Every slot that is genuinely offerable.
 *
 * A slot survives only if it is inside a working window, far enough in the
 * future, and collides with NOTHING already on the calendar or already booked.
 * `busy` is the founder's real Google Calendar — so the page can never offer a
 * time he is already in a meeting.
 */
export function generateSlots(opts: {
  now: number;
  availability: Availability;
  busy: Interval[];
}): number[] {
  const { now, availability: av, busy } = opts;
  const slotMs = Math.max(5, av.slotMinutes) * MIN;
  const earliest = now + av.minNoticeHours * 60 * MIN;
  const out: number[] = [];

  // Grow every busy block by the buffer on BOTH sides, once, up front. Doing it
  // here rather than per-slot keeps the collision test below a plain overlap.
  const pad = Math.max(0, av.bufferMinutes ?? 0) * MIN;
  const blocked: Interval[] = pad
    ? busy.map((b) => ({ start: b.start - pad, end: b.end + pad }))
    : busy;
  const closed = new Set(av.blackoutDates ?? []);

  for (let d = 0; d <= av.horizonDays; d++) {
    const base = now + d * DAY;
    // Resolve the offset for THIS day, not once for the whole horizon. With a
    // single offset, every day beyond a clock change comes out an hour off the
    // real working window — Morocco shifts twice a year and the horizon is 14
    // days, so a fortnight of slots would sit outside business hours (09:00
    // offered at 08:00, or a last slot running to 19:00).
    let off = av.tz ? zoneOffsetMinutes(av.tz, base) : av.tzOffsetMinutes;
    const shifted = new Date(base + off * MIN);
    const dow = shifted.getUTCDay();
    const windows = av.week[dow] ?? [];
    if (!windows.length) continue;
    const Y = shifted.getUTCFullYear(), M = shifted.getUTCMonth(), D = shifted.getUTCDate();
    // Days off (holidays, Aïd, travel) — offer nothing at all.
    if (closed.has(`${Y}-${String(M + 1).padStart(2, "0")}-${String(D).padStart(2, "0")}`)) continue;
    let dayStartUtc = Date.UTC(Y, M, D) - off * MIN;
    if (av.tz) {
      // `base` is "now + d days", which can still land on the near side of a
      // transition that the DAY itself is past. Transitions happen at 02:00/
      // 03:00 local, so midday of the day in question is always unambiguous.
      const midday = zoneOffsetMinutes(av.tz, dayStartUtc + 12 * 60 * MIN);
      if (midday !== off) { off = midday; dayStartUtc = Date.UTC(Y, M, D) - off * MIN; }
    }

    for (const w of windows) {
      const [fromRaw, toRaw] = w.split("-");
      const from = parseHm(fromRaw ?? ""), to = parseHm(toRaw ?? "");
      if (from == null || to == null || to <= from) continue;
      for (let t = from; t + av.slotMinutes <= to; t += av.slotMinutes) {
        const start = dayStartUtc + t * MIN;
        if (start < earliest) continue;
        const slot = { start, end: start + slotMs };
        if (blocked.some((b) => overlaps(slot, b))) continue;
        out.push(start);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** Group slots by their calendar day in the business timezone, for the picker. */
export function groupByDay(slots: number[], tzOffsetMinutes: number): { day: string; slots: number[] }[] {
  const byDay = new Map<string, number[]>();
  for (const s of slots) {
    const d = new Date(s + tzOffsetMinutes * MIN);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(s);
  }
  return [...byDay.entries()].map(([day, s]) => ({ day, slots: s })).sort((a, b) => a.day.localeCompare(b.day));
}

/** "14:30" in the business timezone, for rendering a slot button. */
export function slotLabel(startMs: number, tzOffsetMinutes: number): string {
  const d = new Date(startMs + tzOffsetMinutes * MIN);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Cheap sanity check on a submitted email — the real gate is that we only ever
 *  send to it, never trust it for identity. */
export function looksLikeEmail(s: string): boolean {
  const v = (s ?? "").trim();
  return v.length >= 5 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/**
 * The follow-ups a booking must create. THIS is where bookings turn into
 * business: the call itself is easy, the chase afterwards is what gets dropped.
 * Returned as plain data so it's testable and the caller just writes rows.
 */
export type BookingKind = "nurse" | "clinic" | "company";

/** What each kind is called in a reminder — the founder must know instantly
 *  whether a chase is a candidate or a paying counterparty. */
export const KIND_SHORT: Record<BookingKind, string> = {
  nurse: "nurse",
  clinic: "clinic",
  company: "company",
};

/* ───────────────────────── what we ask, without asking ────────────────────
 * NOBODY types an answer on the booking form except their name, email and
 * phone. Everything else is a tap. Free-text boxes get skipped, get one-word
 * answers, and can't be counted — a fixed option list means every booking
 * arrives already sorted, and the founder walks into the call knowing whether
 * it's a Klinik or an ambulanter Pflegedienst.
 * ------------------------------------------------------------------------ */

export type BookingOption = { id: string; en: string; de: string; fr: string };
export type BookingQuestion = {
  id: string;
  /** false → one answer only (the tile behaves like a radio). */
  multi: boolean;
  en: string; de: string; fr: string;
  options: BookingOption[];
};

const SIZE_OPTIONS: BookingOption[] = [
  { id: "1-5",  en: "1–5",   de: "1–5",   fr: "1–5" },
  { id: "6-20", en: "6–20",  de: "6–20",  fr: "6–20" },
  { id: "20+",  en: "20+",   de: "20+",   fr: "20+" },
];

export const QUESTIONS: Record<BookingKind, BookingQuestion[]> = {
  nurse: [
    {
      id: "setting", multi: true,
      en: "Where would you like to work?", de: "Wo möchten Sie arbeiten?", fr: "Où souhaitez-vous travailler ?",
      options: [
        { id: "klinik",   en: "Hospital / clinic",      de: "Klinik / Krankenhaus",     fr: "Hôpital / clinique" },
        { id: "altenheim",en: "Care home",              de: "Altenheim / Pflegeheim",   fr: "Maison de retraite" },
        { id: "ambulant", en: "Outpatient care service",de: "Ambulanter Pflegedienst",  fr: "Soins à domicile" },
        { id: "intensiv", en: "Intensive care",         de: "Intensivpflege",           fr: "Soins intensifs" },
        { id: "reha",     en: "Rehabilitation",         de: "Reha",                     fr: "Rééducation" },
        { id: "egal",     en: "Open to anything",       de: "Egal — offen für alles",   fr: "Peu importe" },
      ],
    },
    {
      id: "german", multi: false,
      en: "Your German level", de: "Ihr Deutschniveau", fr: "Votre niveau d'allemand",
      options: [
        { id: "none",   en: "None yet", de: "Noch keins", fr: "Aucun" },
        { id: "a1a2",   en: "A1–A2",    de: "A1–A2",      fr: "A1–A2" },
        { id: "b1",     en: "B1",       de: "B1",         fr: "B1" },
        { id: "b2plus", en: "B2 or higher", de: "B2 oder höher", fr: "B2 ou plus" },
      ],
    },
  ],
  clinic: [
    {
      id: "roles", multi: true,
      en: "Which nurses do you need?", de: "Welche Pflegekräfte brauchen Sie?", fr: "Quels infirmiers cherchez-vous ?",
      options: [
        { id: "pflegefach", en: "General ward nurses", de: "Pflegefachkräfte",  fr: "Infirmiers généraux" },
        { id: "intensiv",   en: "Intensive care",      de: "Intensivpflege",    fr: "Soins intensifs" },
        { id: "altenpflege",en: "Elderly care",        de: "Altenpflege",       fr: "Soins aux personnes âgées" },
        { id: "op",         en: "Operating theatre",   de: "OP-Pflege",         fr: "Bloc opératoire" },
        { id: "ambulant",   en: "Outpatient care",     de: "Ambulante Pflege",  fr: "Soins à domicile" },
      ],
    },
    {
      id: "headcount", multi: false,
      en: "How many, roughly?", de: "Wie viele, ungefähr?", fr: "Combien, environ ?",
      options: SIZE_OPTIONS,
    },
  ],
  company: [
    {
      id: "training", multi: true,
      en: "What training do you need?", de: "Welche Kurse brauchen Sie?", fr: "Quelle formation cherchez-vous ?",
      options: [
        { id: "pflege",   en: "German for care professions", de: "Deutsch für Pflegeberufe", fr: "Allemand pour les soignants" },
        { id: "business", en: "Business German",             de: "Business-Deutsch",         fr: "Allemand des affaires" },
        { id: "pruefung", en: "Exam preparation (telc / Goethe)", de: "Prüfungsvorbereitung (telc / Goethe)", fr: "Préparation aux examens" },
        { id: "alltag",   en: "Everyday German",             de: "Alltagsdeutsch",           fr: "Allemand du quotidien" },
      ],
    },
    {
      id: "format", multi: false,
      en: "Format", de: "Format", fr: "Format",
      options: [
        { id: "online", en: "Online",  de: "Online",   fr: "En ligne" },
        { id: "onsite", en: "On site", de: "Vor Ort",  fr: "Sur place" },
        { id: "hybrid", en: "Either",  de: "Beides",   fr: "Les deux" },
      ],
    },
    {
      id: "size", multi: false,
      en: "How many people?", de: "Wie viele Personen?", fr: "Combien de personnes ?",
      options: SIZE_OPTIONS,
    },
  ],
};

export type Selections = Record<string, string[]>;

/**
 * Keep ONLY option ids this kind actually offers.
 *
 * The booking endpoint is public, so `selections` is attacker-controlled JSON
 * heading for a jsonb column that the admin panel renders. Whitelisting against
 * the catalog means nothing unexpected is ever stored or displayed — no free
 * text arrives through the back door of a field the form doesn't render.
 */
export function sanitizeSelections(kind: BookingKind, raw: unknown): Selections {
  const out: Selections = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const q of QUESTIONS[kind] ?? []) {
    const picked = src[q.id];
    const list = Array.isArray(picked) ? picked : picked == null ? [] : [picked];
    const valid = list
      .filter((v): v is string => typeof v === "string")
      .filter((v) => q.options.some((o) => o.id === v));
    const unique = [...new Set(valid)];
    if (unique.length) out[q.id] = q.multi ? unique : [unique[0]];
  }
  return out;
}

/** Selections as one readable line for the lead row / calendar description. */
export function describeSelections(kind: BookingKind, sel: Selections, lang: "en" | "de" | "fr" = "en"): string {
  const parts: string[] = [];
  for (const q of QUESTIONS[kind] ?? []) {
    const ids = sel[q.id];
    if (!ids?.length) continue;
    const labels = ids
      .map((id) => q.options.find((o) => o.id === id))
      .filter((o): o is BookingOption => !!o)
      .map((o) => o[lang]);
    if (labels.length) parts.push(`${q[lang]}: ${labels.join(", ")}`);
  }
  return parts.join(" · ");
}

export function followUpsFor(opts: {
  startsAt: number;
  name: string;
  kind: BookingKind;
  /** Now, so reminders that are ALREADY overdue can be dropped. Omit only in
   *  tests that are asserting the raw schedule. */
  now?: number;
}): { dueAt: number; text: string }[] {
  const { startsAt, name, kind } = opts;
  const who = `${name} (${KIND_SHORT[kind]})`;
  const all = [
    // The day before — so it isn't a surprise.
    { dueAt: startsAt - DAY, text: `Call tomorrow: ${who}` },
    // Right after it should have ended — while it's fresh.
    { dueAt: startsAt + 60 * MIN, text: `Log the call outcome: ${who}` },
    // Two days later — the one that actually converts.
    { dueAt: startsAt + 2 * DAY, text: `Follow up: ${who}` },
  ];
  if (opts.now == null) return all;

  // Drop anything already past. The reminder runner fires everything with
  // due_at <= now on the very next tick, so a past-due row is not a reminder —
  // it's an instant Telegram ping. The public form's minimum notice is 12h,
  // which is LESS than the 24h day-before lead time, so without this every
  // booking on the earliest slot pings "Call tomorrow" within minutes for a
  // call that's still half a day out — and burns the real nudge, because the
  // runner then stamps notified_at and never sends it again. Worse for a
  // manual booking recorded after the fact: all three would fire at once.
  return all.filter((f) => f.dueAt > opts.now!);
}
