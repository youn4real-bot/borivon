import { describe, it, expect, vi } from "vitest";

// loadEventType reads the DB first; with no row it must fall back to the code-only workshop type.
vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  }),
}));

import { generateSlots, DEFAULT_AVAILABILITY, validTimeZone, type Availability } from "../lib/booking";
import { loadEventType, overlayEventType } from "../lib/bookingEventTypes";
import { whenLine } from "../lib/email";

/**
 * The workshop calendar (founder 2026-11-09): 30-minute calls, 3 hours each
 * morning (09–12) and evening (17–20) in GERMAN time, every day, today + 2 days.
 * A booking blocks exactly its own 30 minutes.
 */
const berlin = (iso: string) => {
  // "2026-11-10 09:00" Berlin wall clock → epoch ms (Nov = UTC+1, May = UTC+2)
  const [d, t] = iso.split(" ");
  const month = Number(d.slice(5, 7));
  const off = month >= 4 && month <= 10 ? 2 : 1;
  const [h, m] = t.split(":").map(Number);
  return Date.UTC(Number(d.slice(0, 4)), month - 1, Number(d.slice(8, 10)), h - off, m);
};
const label = (at: number) =>
  new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(at);
const dayOf = (at: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

async function workshopAv(): Promise<Availability> {
  const et = await loadEventType("workshop");
  expect(et).not.toBeNull();
  // the global row: Morocco, weekdays 09–18 with a 12h notice — the workshop must override all of it
  return overlayEventType({ ...DEFAULT_AVAILABILITY, tz: "Africa/Casablanca", bufferMinutes: 15 }, et);
}

describe("workshop calendar", () => {
  it("is 30 minutes, no buffer, German time, today + 2 days", async () => {
    const av = await workshopAv();
    expect(av.slotMinutes).toBe(30);
    expect(av.bufferMinutes).toBe(0);
    expect(av.horizonDays).toBe(2);
    expect(av.tz).toBe("Europe/Berlin");
  });

  it("offers 09:00–11:30 and 17:00–19:30 German time on 3 days, weekend included", async () => {
    const av = await workshopAv();
    const now = berlin("2026-11-13 06:00"); // Friday morning
    const slots = generateSlots({ now, availability: av, busy: [] });
    const days = [...new Set(slots.map(dayOf))];
    expect(days).toEqual(["2026-11-13", "2026-11-14", "2026-11-15"]); // Fri, Sat, Sun — nothing on day 4
    const fri = slots.filter((s) => dayOf(s) === "2026-11-13").map(label);
    expect(fri).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30"]);
  });

  it("stays on German hours across summer time", async () => {
    const av = await workshopAv();
    const slots = generateSlots({ now: berlin("2027-05-10 06:00"), availability: av, busy: [] });
    const first = slots.filter((s) => dayOf(s) === "2027-05-10").map(label);
    expect(first[0]).toBe("09:00");
    expect(first[first.length - 1]).toBe("19:30");
  });

  it("today is bookable: only 2 hours' notice", async () => {
    const av = await workshopAv();
    const now = berlin("2026-11-10 09:10");
    const today = generateSlots({ now, availability: av, busy: [] }).filter((s) => dayOf(s) === "2026-11-10").map(label);
    expect(today).toEqual(["11:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30"]);
  });

  it("a booking blocks exactly its own 30 minutes", async () => {
    const av = await workshopAv();
    const at = berlin("2026-11-11 10:00");
    const slots = generateSlots({ now: berlin("2026-11-10 06:00"), availability: av, busy: [{ start: at, end: at + 30 * 60_000 }] });
    const day = slots.filter((s) => dayOf(s) === "2026-11-11").map(label);
    expect(day).not.toContain("10:00");
    expect(day).toContain("09:30");
    expect(day).toContain("10:30");
  });
});

describe("booking emails name the clock", () => {
  const at = new Date(berlin("2026-11-10 09:00")).toISOString();
  it("German bookers get German time by default", () => {
    expect(whenLine(at, "de")).toMatch(/09:00.*\(deutsche Zeit\)/);
  });
  it("the clock the visitor picked wins", () => {
    expect(whenLine(at, "de", "Asia/Shanghai")).toMatch(/16:00.*\(Shanghai\)/);
  });
  it("public tz input is shape-checked", () => {
    expect(validTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(validTimeZone("Not/AZone")).toBeNull();
    expect(validTimeZone("<script>")).toBeNull();
    expect(validTimeZone(42)).toBeNull();
  });
});
