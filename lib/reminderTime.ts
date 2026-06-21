/**
 * Natural-language time parsing for reminders — so "remind me at 3pm",
 * "in 2 hours", "tomorrow 9am", "tonight", "Monday at 10h" actually capture a
 * REAL due instant, deterministically (no model needed). This is what makes
 * reminders CONSISTENT: the founder's #1 complaint was that the time he said was
 * silently thrown away and nothing ever fired.
 *
 * Everything resolves in the founder's timezone (BORIVON_TZ / Africa/Casablanca):
 * "3pm" means 15:00 in Casablanca, converted to a true UTC instant for storage.
 * The tz-offset math mirrors lib/workspaceCalendar.ts (kept self-contained here so
 * this hot-path util doesn't pull in the googleapis import chain).
 *
 * Returns { dueAt, whenLabel } — dueAt is null when the message carries no parseable
 * time (the reminder is still saved, just undated, exactly as before). Multilingual
 * tokens (EN/FR/DE) are covered for the common phrasings; anything exotic falls back
 * to the model path (saveReminder accepts an explicit dueAt the model can fill).
 */

const TZ = (process.env.CALENDAR_TZ || "Africa/Casablanca").trim();
const HAS_TZ = /([zZ])$|[+-]\d{2}:?\d{2}$/;

/** ms offset of TZ from UTC at a given instant (handles DST / Morocco's Ramadan shift). */
function tzOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).reduce((a, p) => { if (p.type !== "literal") a[p.type] = p.value; return a; }, {} as Record<string, string>);
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUTC - date.getTime();
}

/** A bare local wall-clock ("2026-06-18T15:00:00") interpreted in TZ → true UTC instant. */
function localToInstant(localIso: string): Date {
  const t = localIso.trim();
  if (HAS_TZ.test(t)) return new Date(Date.parse(t));
  const provisional = new Date(t + "Z");
  return new Date(provisional.getTime() - tzOffsetMs(provisional));
}

/** TZ-local Y/M/D + weekday (0=Sun) for an instant. */
function localParts(date: Date): { y: number; m: number; d: number; dow: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).reduce((a, x) => { if (x.type !== "literal") a[x.type] = x.value; return a; }, {} as Record<string, string>);
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: +p.year, m: +p.month, d: +p.day, dow: dowMap[p.weekday] ?? 0 };
}

/** TZ-local Y/M/D + H/M (24h) for an instant. */
function localPartsFull(date: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date).reduce((a, x) => { if (x.type !== "literal") a[x.type] = x.value; return a; }, {} as Record<string, string>);
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Build a UTC instant for a TZ-local date (y,m,d) at hh:mm. */
function instantAt(y: number, m: number, d: number, hh: number, mm: number): Date {
  return localToInstant(`${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00`);
}

/** Add `days` to a local Y/M/D and return the resulting Y/M/D (via a real Date so month rollover is correct). */
function addLocalDays(y: number, m: number, d: number, days: number): { y: number; m: number; d: number } {
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate() };
}

const DOW: Record<string, number> = {
  sunday: 0, sun: 0, dimanche: 0, sonntag: 0,
  monday: 1, mon: 1, lundi: 1, montag: 1,
  tuesday: 2, tue: 2, tues: 2, mardi: 2, dienstag: 2,
  wednesday: 3, wed: 3, mercredi: 3, mittwoch: 3,
  thursday: 4, thu: 4, thurs: 4, jeudi: 4, donnerstag: 4,
  friday: 5, fri: 5, vendredi: 5, freitag: 5,
  saturday: 6, sat: 6, samedi: 6, samstag: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, janvier: 1, januar: 1,
  february: 2, feb: 2, fevrier: 2, "février": 2, februar: 2,
  march: 3, mar: 3, mars: 3, "märz": 3, marz: 3,
  april: 4, apr: 4, avril: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juin: 6, juni: 6,
  july: 7, jul: 7, juillet: 7, juli: 7,
  august: 8, aug: 8, "août": 8, aout: 8,
  september: 9, sep: 9, sept: 9, septembre: 9,
  october: 10, oct: 10, octobre: 10, oktober: 10,
  november: 11, nov: 11, novembre: 11,
  december: 12, dec: 12, "décembre": 12, decembre: 12, dezember: 12,
};

/** For a bare hour 1-11 with no am/pm: if it's already afternoon/evening locally, the
 *  founder almost always means PM ("remind me at 8" said at 7pm = 20:00, not 08:00). */
function disambiguatePm(r: { hh: number; mm: number }, nowLocalHour?: number): { hh: number; mm: number } {
  if (r.hh >= 1 && r.hh <= 11 && typeof nowLocalHour === "number" && nowLocalHour >= 12) return { hh: r.hh + 12, mm: r.mm };
  return r;
}

/** Extract a time-of-day (returns {hh,mm} or null). EXPLICIT clock is tried BEFORE the
 *  keyword defaults, so "tonight at 11pm" = 23:00 (not the 20:00 'tonight' default). */
function parseTimeOfDay(t: string, nowLocalHour?: number): { hh: number; mm: number } | null {
  // ── explicit clock FIRST ──
  // "3pm", "3:30 pm", "11 am"
  let m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/);
  if (m) {
    let hh = +m[1] % 12;
    if (/p/.test(m[3])) hh += 12;
    return { hh, mm: m[2] ? +m[2] : 0 };
  }
  // "15h", "15h30", "9 h", "à 15h", 24h "15:30", "21 Uhr", "21 uhr 30"
  m = t.match(/\b(\d{1,2})\s*(?:[:h]|uhr)\s*(\d{2})?\b/i);
  if (m) {
    const hh = +m[1], mm = m[2] ? +m[2] : 0;
    if (hh <= 23 && mm <= 59) return { hh, mm };
  }
  // bare "at 9" / "à 9" / "um 9" (no am/pm/colon) — PM-disambiguated against now
  m = t.match(/\b(?:at|à|a|um)\s+(\d{1,2})\b/);
  if (m) {
    const hh = +m[1];
    if (hh <= 23) return disambiguatePm({ hh, mm: 0 }, nowLocalHour);
  }
  // "EOD" / "COB" / "end of day" → 18:00
  if (/\b(eod|cob|end of (?:the )?day|close of business)\b/.test(t)) return { hh: 18, mm: 0 };

  // ── keyword defaults (only when no explicit clock above matched) ──
  if (/\b(tonight|this evening|ce soir|heute abend|abends?)\b/.test(t)) return { hh: 20, mm: 0 };
  if (/\b(this afternoon|cet après-midi|cet apres-midi|nachmittags?)\b/.test(t)) return { hh: 15, mm: 0 };
  if (/\b(this morning|ce matin|morgens?|in the morning)\b/.test(t)) return { hh: 9, mm: 0 };
  if (/\bnoon\b|\bmidi\b|\bmittag/.test(t)) return { hh: 12, mm: 0 };
  if (/\bmidnight|minuit|mitternacht\b/.test(t)) return { hh: 0, mm: 0 };
  return null;
}

export type ParsedReminderTime = { dueAt: Date | null; whenLabel: string | null };

/**
 * Parse a due instant from a free-text reminder message. `now` defaults to the
 * current instant; pass it in tests for determinism.
 */
export function parseReminderTime(text: string, now: Date = new Date()): ParsedReminderTime {
  const t = (text || "").toLowerCase();
  if (!t) return { dueAt: null, whenLabel: null };

  // 1) Relative "in N <unit>" / "in a/an/half an <unit>" — explicit offset from now.
  //    Unit is OPTIONAL: a bare "in 30" / "in 15" (the founder's shorthand) = minutes.
  const rel = t.match(/\bin\s+(\d+|an?|half an|half a|a couple of|a few)\s*(min(?:ute)?s?|hours?|hrs?|h|days?|weeks?|months?)?\b/);
  if (rel) {
    const word = rel[1];
    let n = parseInt(word, 10);
    if (Number.isNaN(n)) n = /half/.test(word) ? 0.5 : /couple/.test(word) ? 2 : /few/.test(word) ? 3 : 1;
    const unit = rel[2] || "";
    let ms = 0;
    if (!unit) { if (Number.isFinite(n) && n > 0 && n <= 180) ms = n * 60_000; } // bare "in 30" → 30 min
    else if (/^min/.test(unit)) ms = n * 60_000;
    else if (/^h/.test(unit)) ms = n * 3_600_000;
    else if (/^day/.test(unit)) ms = n * 86_400_000;
    else if (/^week/.test(unit)) ms = n * 7 * 86_400_000;
    else if (/^month/.test(unit)) ms = n * 30 * 86_400_000;
    if (ms > 0) {
      const dueAt = new Date(now.getTime() + ms);
      return { dueAt, whenLabel: fmtWhen(dueAt) };
    }
  }

  const cur = localParts(now);
  const time = parseTimeOfDay(t, localPartsFull(now).hh);

  // 2) Day anchors.
  let day: { y: number; m: number; d: number } | null = null;

  if (/\b(tomorrow|tmrw|demain|morgen)\b/.test(t)) {
    day = addLocalDays(cur.y, cur.m, cur.d, 1);
  } else if (/\b(today|tonight|aujourd|heute|ce soir|this (morning|afternoon|evening))\b/.test(t)) {
    day = { y: cur.y, m: cur.m, d: cur.d };
  } else {
    // day-of-week
    const dowMatch = t.match(/\b(next\s+|prochain\s+|nächste[nr]?\s+)?(sunday|sun|dimanche|sonntag|monday|mon|lundi|montag|tuesday|tues?|mardi|dienstag|wednesday|wed|mercredi|mittwoch|thursday|thur?s?|jeudi|donnerstag|friday|fri|vendredi|freitag|saturday|sat|samedi|samstag)\b/);
    if (dowMatch) {
      const target = DOW[dowMatch[2]];
      let delta = (target - cur.dow + 7) % 7;
      // same weekday as today: "monday" with a future time → today; otherwise next week.
      if (delta === 0) {
        const wantsNext = !!dowMatch[1];
        const todayAtTime = time ? instantAt(cur.y, cur.m, cur.d, time.hh, time.mm) : null;
        if (wantsNext || !todayAtTime || todayAtTime.getTime() <= now.getTime()) delta = 7;
      } else if (dowMatch[1]) {
        // "next monday" when today isn't monday → the monday at least 7 days out if the nearer one is this week
        // (kept simple: nearest upcoming; "next" only forces +7 on same-day collisions above).
      }
      day = addLocalDays(cur.y, cur.m, cur.d, delta);
    }
  }

  // 3) Explicit calendar date: "20/6", "20.06.2026", "june 20", "20 june", "20. Juni".
  if (!day) {
    const dmy = t.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/);
    if (dmy) {
      const d = +dmy[1], m = +dmy[2];
      let y = dmy[3] ? +dmy[3] : cur.y;
      if (y < 100) y += 2000;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        let cand = { y, m, d };
        // No year given and the date already passed this year → assume next year.
        if (!dmy[3] && instantAt(y, m, d, time?.hh ?? 9, time?.mm ?? 0).getTime() < now.getTime() - 86_400_000) {
          cand = { y: y + 1, m, d };
        }
        day = cand;
      }
    }
  }
  if (!day) {
    const monMatch = t.match(/\b(\d{1,2})(?:st|nd|rd|th|\.)?\s+(january|jan|janvier|januar|february|feb|fevrier|février|februar|march|mar|mars|märz|marz|april|apr|avril|may|mai|june|jun|juin|juni|july|jul|juillet|juli|august|aug|août|aout|september|sep|sept|septembre|october|oct|octobre|oktober|november|nov|novembre|december|dec|décembre|decembre|dezember)\b/)
      || t.match(/\b(january|jan|janvier|januar|february|feb|fevrier|février|februar|march|mar|mars|märz|marz|april|apr|avril|may|mai|june|jun|juin|juni|july|jul|juillet|juli|august|aug|août|aout|september|sep|sept|septembre|october|oct|octobre|oktober|november|nov|novembre|december|dec|décembre|decembre|dezember)\s+(\d{1,2})\b/);
    if (monMatch) {
      const num = /^\d/.test(monMatch[1]) ? +monMatch[1] : +monMatch[2];
      const monName = /^\d/.test(monMatch[1]) ? monMatch[2] : monMatch[1];
      const m = MONTHS[monName];
      if (m && num >= 1 && num <= 31) {
        let y = cur.y;
        if (instantAt(y, m, num, time?.hh ?? 9, time?.mm ?? 0).getTime() < now.getTime() - 86_400_000) y += 1;
        day = { y, m, d: num };
      }
    }
  }

  // 4) Combine day + time.
  if (day) {
    const hh = time?.hh ?? 9;   // default reminders to 09:00 local when only a day is given
    const mm = time?.mm ?? 0;
    const dueAt = instantAt(day.y, day.m, day.d, hh, mm);
    return { dueAt, whenLabel: fmtWhen(dueAt) };
  }

  // 5) Time only (no day): today if still in the future, else tomorrow.
  if (time) {
    let dueAt = instantAt(cur.y, cur.m, cur.d, time.hh, time.mm);
    if (dueAt.getTime() <= now.getTime()) {
      const tm = addLocalDays(cur.y, cur.m, cur.d, 1);
      dueAt = instantAt(tm.y, tm.m, tm.d, time.hh, time.mm);
    }
    return { dueAt, whenLabel: fmtWhen(dueAt) };
  }

  return { dueAt: null, whenLabel: null };
}

/**
 * Convert a model-emitted local wall-clock ISO ("2026-06-19T15:00:00", no Z) to a
 * true UTC instant in the founder's tz. A date-only string defaults to 09:00 local.
 * Returns null if unparseable. Used by the saveReminder tool (the model resolves the
 * relative time against the "RIGHT NOW" anchor, then emits a clean local ISO).
 */
export function localIsoToInstant(iso: string): Date | null {
  const t = (iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?([zZ]|[+-]\d{2}:?\d{2})?$/.test(t)) return null;
  const hasTime = /[T ]\d{2}:\d{2}/.test(t);
  const norm = hasTime ? t.replace(" ", "T") : `${t}T09:00:00`;
  const d = localToInstant(norm);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type Recurrence = "daily" | "weekly" | "monthly";

/**
 * The next firing instant for a recurring reminder, advancing from `fromIso` by one
 * period while PRESERVING the local wall-clock time (so a 9:00 reminder stays 9:00
 * across DST / month-length changes). Monthly clamps to the last day of short months
 * (e.g. the 31st → 30th/28th). Returns null on bad input.
 */
export function nextOccurrence(fromIso: string, recurrence: Recurrence): Date | null {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  let { y, m, d } = localPartsFull(from);
  const { hh, mm } = localPartsFull(from);
  if (recurrence === "daily") ({ y, m, d } = addLocalDays(y, m, d, 1));
  else if (recurrence === "weekly") ({ y, m, d } = addLocalDays(y, m, d, 7));
  else { // monthly — same day-of-month next month, clamped to the month's length
    m += 1; if (m > 12) { m = 1; y += 1; }
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d > daysInMonth) d = daysInMonth;
  }
  return instantAt(y, m, d, hh, mm);
}

/**
 * The next firing instant STRICTLY in the future. On Vercel HOBBY a daily/weekly
 * reminder can sit days overdue (no sub-daily cron) — advancing only +1 period could
 * still land in the past, so it would re-fire on the very next inbound message and
 * spam the founder. This skips forward period-by-period until the slot is actually
 * ahead of `now`. Returns null for a non-recurring reminder or bad input. The guard
 * caps the skip (a stuck clock can't loop forever).
 */
export function nextFutureOccurrence(fromIso: string, recurrence: Recurrence, now: Date = new Date()): Date | null {
  // Guard the recurrence explicitly: nextOccurrence treats any non-daily/weekly value as
  // monthly (its else branch), so a blank/garbage recurrence must NOT be re-armed here.
  if (recurrence !== "daily" && recurrence !== "weekly" && recurrence !== "monthly") return null;
  let next = nextOccurrence(fromIso, recurrence);
  for (let guard = 0; next && next.getTime() <= now.getTime() && guard < 400; guard++) {
    next = nextOccurrence(next.toISOString(), recurrence);
  }
  return next;
}

/** Human "when" label in the founder's tz, e.g. "Thu 19 Jun, 3:00 PM". */
export function fmtWhen(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}
