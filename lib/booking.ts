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
   *  rather than reading the server's clock, which on Workers is UTC. */
  tzOffsetMinutes: number;
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
export function zoneOffsetMinutes(tz: string, at: number = Date.now()): number {
  try {
    const d = new Date(at);
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(d).reduce((a, x) => {
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

  for (let d = 0; d <= av.horizonDays; d++) {
    // Midnight of day d in the BUSINESS timezone, expressed as a UTC instant.
    const shifted = new Date(now + d * DAY + av.tzOffsetMinutes * MIN);
    const dow = shifted.getUTCDay();
    const windows = av.week[dow] ?? [];
    if (!windows.length) continue;
    const dayStartUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
      - av.tzOffsetMinutes * MIN;

    for (const w of windows) {
      const [fromRaw, toRaw] = w.split("-");
      const from = parseHm(fromRaw ?? ""), to = parseHm(toRaw ?? "");
      if (from == null || to == null || to <= from) continue;
      for (let t = from; t + av.slotMinutes <= to; t += av.slotMinutes) {
        const start = dayStartUtc + t * MIN;
        if (start < earliest) continue;
        const slot = { start, end: start + slotMs };
        if (busy.some((b) => overlaps(slot, b))) continue;
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

export function followUpsFor(opts: {
  startsAt: number;
  name: string;
  kind: BookingKind;
}): { dueAt: number; text: string }[] {
  const { startsAt, name, kind } = opts;
  const who = `${name} (${KIND_SHORT[kind]})`;
  return [
    // The day before — so it isn't a surprise.
    { dueAt: startsAt - DAY, text: `Call tomorrow: ${who}` },
    // Right after it should have ended — while it's fresh.
    { dueAt: startsAt + 60 * MIN, text: `Log the call outcome: ${who}` },
    // Two days later — the one that actually converts.
    { dueAt: startsAt + 2 * DAY, text: `Follow up: ${who}` },
  ];
}
