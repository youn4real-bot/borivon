/**
 * Server-side booking configuration: the founder's availability as stored in
 * `booking_availability`, plus the unguessable token that lets someone manage
 * their own booking without an account.
 *
 * Kept apart from lib/booking.ts so that file stays pure and fully unit-tested;
 * everything here touches the database or crypto.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { BORIVON_TZ } from "@/lib/workspaceCalendar";
import { DEFAULT_AVAILABILITY, parseHm, zoneOffsetMinutes, type Availability } from "@/lib/booking";

export type BookingConfig = { availability: Availability; accepting: boolean };

/**
 * A window is valid only if the SLOT ENGINE will actually produce times from it.
 *
 * The old test was a bare shape match — /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/ — which
 * happily accepted "18:00-09:00" (backwards), "99:99-25:70" and "12:00-12:00".
 * generateSlots then discarded every one of them (lib/booking.ts:154 drops
 * `to <= from`, and parseHm rejects out-of-range numbers), so the founder saved
 * working hours, got a green confirmation, and the public page offered nothing
 * on that day with no explanation anywhere.
 *
 * Reusing the engine's own parseHm is the point: the check that decides whether
 * a window can be SAVED is now literally the check that decides whether it
 * produces slots, so the two can never drift apart again.
 */
export function isValidWindow(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const parts = s.trim().split("-");
  if (parts.length !== 2) return false;
  const from = parseHm(parts[0]), to = parseHm(parts[1]);
  return from != null && to != null && to > from;
}

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;
};

/**
 * Weekday → windows, keeping only ones the engine can use. TOLERANT by design:
 * this is the READ path, and one bad row must never take the public booking
 * page down. Writes go through validateWeek instead, which refuses rather than
 * quietly discards.
 */
export function parseWeek(raw: unknown): Record<number, string[]> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<number, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(k);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    const windows = (Array.isArray(v) ? v : []).filter(isValidWindow).map((s) => s.trim());
    if (windows.length) out[day] = windows;
  }
  return out;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * STRICT check for the save path: refuse a bad week instead of silently
 * shrinking it.
 *
 * parseWeek FILTERS — `.filter(isValidWindow)` — which is right for reading and
 * wrong for saving. The PUT handler used it, so a typo like "18:00-0900" was
 * dropped on the way to the database, the save returned 200, and the founder
 * was left believing they had set hours that do not exist. Silently discarding
 * what someone typed is the one thing a settings form must never do.
 *
 * Returns every rejection so the editor can point at the offending value.
 */
export function validateWeek(raw: unknown):
  | { ok: true; week: Record<number, string[]> }
  | { ok: false; errors: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["Working hours must be a set of days."] };
  }
  const out: Record<number, string[]> = {};
  const errors: string[] = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(k);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      errors.push(`"${k}" is not a weekday (use 0–6, Sunday first).`);
      continue;
    }
    if (v != null && !Array.isArray(v)) {
      errors.push(`${DAY_NAMES[day]}: expected a list of time windows.`);
      continue;
    }
    const windows: string[] = [];
    for (const w of (v as unknown[]) ?? []) {
      if (isValidWindow(w)) windows.push(w.trim());
      else errors.push(`${DAY_NAMES[day]}: "${String(w).slice(0, 40)}" is not a usable window (needs HH:MM-HH:MM, and the end must be after the start).`);
    }
    if (windows.length) out[day] = windows;
  }
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, week: out };
}

/**
 * The availability to offer right now.
 *
 * FAILS OPEN to the built-in defaults: if the table isn't migrated yet or the
 * row is malformed, the booking page keeps working on weekday 09:00–18:00
 * rather than showing a visitor an empty calendar.
 */
export async function loadBookingConfig(): Promise<BookingConfig> {
  const base: Availability = {
    ...DEFAULT_AVAILABILITY,
    tz: BORIVON_TZ,
    tzOffsetMinutes: zoneOffsetMinutes(BORIVON_TZ),
  };
  try {
    const { data, error } = await getServiceSupabase()
      .from("booking_availability")
      .select("week,slot_minutes,buffer_minutes,min_notice_hours,horizon_days,blackout_dates,accepting")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return { availability: base, accepting: true };

    const row = data as {
      week?: unknown; slot_minutes?: unknown; buffer_minutes?: unknown;
      min_notice_hours?: unknown; horizon_days?: unknown;
      blackout_dates?: unknown; accepting?: unknown;
    };
    const week = parseWeek(row.week);
    return {
      accepting: row.accepting !== false,
      availability: {
        ...base,
        // An EMPTY week is an instruction, not a missing value. Clearing every
        // day is how the founder says "I have no hours right now"; the old
        // `Object.keys(week).length ? week : base.week` read that as nothing
        // stored and fell back to Mon–Fri 09:00–18:00 — so the page kept
        // handing out times they had explicitly removed, and no amount of
        // clearing the form could stop it. Defaults now apply only when there
        // is genuinely no week to read (parseWeek returns null for a row that
        // is absent or not an object).
        week: week ?? base.week,
        slotMinutes: clamp(row.slot_minutes, 5, 240, base.slotMinutes),
        bufferMinutes: clamp(row.buffer_minutes, 0, 120, 0),
        minNoticeHours: clamp(row.min_notice_hours, 0, 720, base.minNoticeHours),
        horizonDays: clamp(row.horizon_days, 1, 90, base.horizonDays),
        blackoutDates: (Array.isArray(row.blackout_dates) ? row.blackout_dates : []).filter(isDay),
      },
    };
  } catch {
    return { availability: base, accepting: true };
  }
}

/**
 * The credential on the public "reschedule or cancel" link.
 *
 * 32 bytes of CSPRNG entropy, base64url. This is the ONLY thing standing between
 * a stranger and someone else's booking, so it must be generated with WebCrypto
 * (available on Workers) — never Math.random, which is seeded and guessable.
 */
export function newManageToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Shape check before any DB lookup, so junk never reaches Postgres. */
export function looksLikeManageToken(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(s);
}
