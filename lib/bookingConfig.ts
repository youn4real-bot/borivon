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
import { DEFAULT_AVAILABILITY, zoneOffsetMinutes, type Availability } from "@/lib/booking";

export type BookingConfig = { availability: Availability; accepting: boolean };

const isHm = (s: unknown): s is string => typeof s === "string" && /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(s.trim());
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;
};

/** Weekday → windows, keeping only well-formed "HH:MM-HH:MM" entries. */
export function parseWeek(raw: unknown): Record<number, string[]> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<number, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(k);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    const windows = (Array.isArray(v) ? v : []).filter(isHm).map((s) => s.trim());
    if (windows.length) out[day] = windows;
  }
  return out;
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
        week: week && Object.keys(week).length ? week : base.week,
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
