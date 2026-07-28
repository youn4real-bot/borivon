import { describe, it, expect } from "vitest";
import { isValidWindow, parseWeek, validateWeek } from "../lib/bookingConfig";
import { generateSlots, DEFAULT_AVAILABILITY, type Availability } from "../lib/booking";

/**
 * THE FOUNDER'S OWN WORKING HOURS.
 *
 * Two failures lived here, both of the same species — the software deciding it
 * knew better than the person typing.
 *
 *  1. An emptied week meant "I have no hours right now". loadBookingConfig read
 *     it as "nothing stored" and substituted Mon–Fri 09:00–18:00, so clearing
 *     the form could not stop the public page handing out times.
 *  2. The save-time check was a bare shape match, so "18:00-09:00" was stored
 *     happily and then silently discarded by the slot engine, which drops any
 *     window whose end is not after its start. Green tick, zero slots, no clue.
 *
 * These pin the rule that the check which decides whether a window can be SAVED
 * is the same one that decides whether it produces SLOTS.
 */

const at = (av: Partial<Availability>) => ({
  ...DEFAULT_AVAILABILITY,
  tz: undefined,
  tzOffsetMinutes: 0,
  ...av,
}) as Availability;

describe("isValidWindow", () => {
  it("accepts the shapes a human actually types", () => {
    for (const w of ["09:00-13:00", "9:00-13:00", "14:00-18:30", "00:00-23:59"]) {
      expect(isValidWindow(w), w).toBe(true);
    }
  });

  it("rejects a BACKWARDS window — the engine would silently drop it", () => {
    expect(isValidWindow("18:00-09:00")).toBe(false);
  });

  it("rejects a zero-length window", () => {
    expect(isValidWindow("12:00-12:00")).toBe(false);
  });

  it("rejects impossible clock values", () => {
    for (const w of ["99:99-25:70", "24:00-25:00", "12:60-13:00", "-1:00-13:00"]) {
      expect(isValidWindow(w), w).toBe(false);
    }
  });

  it("rejects malformed and non-string input", () => {
    for (const w of ["0900-1300", "09:00", "09:00-13:00-14:00", "", "  ", null, undefined, 900, {}]) {
      expect(isValidWindow(w), JSON.stringify(w)).toBe(false);
    }
  });

  it("agrees with the SLOT ENGINE — anything it accepts produces slots, anything it rejects produces none", () => {
    const now = Date.UTC(2026, 0, 5, 6, 0, 0);        // a Monday, 06:00 UTC
    const slotsFor = (window: string) => generateSlots({
      now,
      availability: at({ week: { 1: [window] }, slotMinutes: 30, minNoticeHours: 0, horizonDays: 1, bufferMinutes: 0 }),
      busy: [],
    }).length;

    expect(slotsFor("09:00-13:00"), "valid window must produce slots").toBeGreaterThan(0);
    expect(slotsFor("18:00-09:00"), "backwards window produces none").toBe(0);
    expect(slotsFor("12:00-12:00"), "zero-length produces none").toBe(0);
    expect(slotsFor("99:99-25:70"), "impossible produces none").toBe(0);
  });
});

describe("validateWeek — the SAVE path refuses instead of trimming", () => {
  it("accepts a good week and returns it", () => {
    const r = validateWeek({ 1: ["09:00-13:00", "14:00-18:00"], 5: ["10:00-12:00"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.week).toEqual({ 1: ["09:00-13:00", "14:00-18:00"], 5: ["10:00-12:00"] });
  });

  it("REFUSES a mistyped window instead of dropping it — this is the whole bug", () => {
    const r = validateWeek({ 1: ["09:00-13:00", "18:00-0900"] });
    expect(r.ok, "a typo must fail the save, not vanish from it").toBe(false);
    if (!r.ok) {
      expect(r.errors.join(" ")).toContain("Monday");
      expect(r.errors.join(" ")).toContain("18:00-0900");
    }
  });

  it("names the day so the founder isn't hunting through seven of them", () => {
    const r = validateWeek({ 3: ["18:00-09:00"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("Wednesday");
  });

  it("rejects a non-weekday key and a non-list value", () => {
    expect(validateWeek({ 9: ["09:00-10:00"] }).ok).toBe(false);
    expect(validateWeek({ 1: "09:00-10:00" }).ok).toBe(false);
    expect(validateWeek(null).ok).toBe(false);
    expect(validateWeek([]).ok).toBe(false);
    expect(validateWeek("mon").ok).toBe(false);
  });

  it("accepts a DELIBERATELY EMPTY week — that is a real instruction, not an error", () => {
    const r = validateWeek({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.week).toEqual({});
    const r2 = validateWeek({ 1: [], 2: [] });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.week).toEqual({});
  });
});

describe("parseWeek — the READ path stays tolerant", () => {
  it("keeps the good windows and skips the bad, so one bad row can't kill the page", () => {
    expect(parseWeek({ 1: ["09:00-13:00", "18:00-09:00"], 2: ["nonsense"] }))
      .toEqual({ 1: ["09:00-13:00"] });
  });

  it("returns null only when there is genuinely no week object to read", () => {
    expect(parseWeek(null)).toBeNull();
    expect(parseWeek("mon")).toBeNull();
    expect(parseWeek([])).toBeNull();
    // An EMPTY object is a week — an empty one. It must not read as absent,
    // because that is what made a cleared diary fall back to Mon–Fri 9–6.
    expect(parseWeek({})).toEqual({});
  });
});

describe("an emptied week offers nothing", () => {
  it("produces zero slots rather than the built-in Mon-Fri default", () => {
    const slots = generateSlots({
      now: Date.UTC(2026, 0, 5, 6, 0, 0),
      availability: at({ week: {}, minNoticeHours: 0, horizonDays: 14 }),
      busy: [],
    });
    expect(slots, "clearing every day must stop the page offering times").toEqual([]);
  });
});
