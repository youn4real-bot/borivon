import { describe, it, expect } from "vitest";
import {
  generateSlots, groupByDay, slotLabel, parseHm, overlaps, looksLikeEmail, followUpsFor,
  zoneOffsetMinutes, DEFAULT_AVAILABILITY, type Availability,
} from "../lib/booking";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
// Monday 2026-08-03, 08:00 UTC (09:00 Casablanca).
const MON = Date.UTC(2026, 7, 3, 8, 0, 0);

const av = (o: Partial<Availability> = {}): Availability => ({
  ...DEFAULT_AVAILABILITY, minNoticeHours: 0, horizonDays: 1, ...o,
});

describe("parseHm / overlaps — the primitives", () => {
  it("parses valid times and rejects junk", () => {
    expect(parseHm("09:00")).toBe(540);
    expect(parseHm("9:05")).toBe(545);
    expect(parseHm("23:59")).toBe(1439);
    for (const bad of ["", "24:00", "09:60", "9", "0900", "aa:bb"]) expect(parseHm(bad), bad).toBeNull();
  });
  it("treats intervals as half-open — touching is NOT overlapping", () => {
    // A 10:00-10:30 meeting must not block a 10:30 slot.
    expect(overlaps({ start: 0, end: 100 }, { start: 100, end: 200 })).toBe(false);
    expect(overlaps({ start: 0, end: 101 }, { start: 100, end: 200 })).toBe(true);
  });
});

describe("generateSlots — what may actually be offered", () => {
  it("fills the working windows and skips the lunch gap", () => {
    const slots = generateSlots({ now: MON, availability: av(), busy: [] });
    const mondayLabels = slots.filter((s) => s < MON + DAY).map((s) => slotLabel(s, 60));
    expect(mondayLabels[0]).toBe("09:00");
    expect(mondayLabels).toContain("12:30");
    expect(mondayLabels).not.toContain("13:00"); // lunch — closed
    expect(mondayLabels).toContain("14:00");
    expect(mondayLabels[mondayLabels.length - 1]).toBe("17:30"); // last 30min fits before 18:00
  });

  it("never offers a slot the founder is already busy in", () => {
    const busyStart = MON + 2 * HOUR; // 11:00 Casablanca
    const slots = generateSlots({
      now: MON, availability: av(),
      busy: [{ start: busyStart, end: busyStart + HOUR }],
    });
    // MONDAY only — Tuesday has its own free 11:00 and would mask the blocking.
    const labels = slots.filter((s) => s < MON + DAY).map((s) => slotLabel(s, 60));
    expect(labels).not.toContain("11:00");
    expect(labels).not.toContain("11:30");
    expect(labels).toContain("10:30"); // ends exactly at 11:00 — still fine
    expect(labels).toContain("12:00"); // starts exactly when busy ends — fine
  });

  it("respects the minimum notice — no same-hour ambushes", () => {
    const none = generateSlots({ now: MON, availability: av({ minNoticeHours: 48 }), busy: [] });
    expect(none.filter((s) => s < MON + 48 * HOUR)).toHaveLength(0);
  });

  it("is closed at the weekend", () => {
    const SAT = Date.UTC(2026, 7, 8, 8, 0, 0);
    expect(generateSlots({ now: SAT, availability: av({ horizonDays: 0 }), busy: [] })).toHaveLength(0);
  });

  it("returns nothing when the day has no windows", () => {
    expect(generateSlots({ now: MON, availability: av({ week: {} }), busy: [] })).toHaveLength(0);
  });

  it("ignores malformed or inverted windows instead of throwing", () => {
    const slots = generateSlots({ now: MON, availability: av({ week: { 1: ["18:00-09:00", "oops", "09:00-10:00"] } }), busy: [] });
    expect(slots.map((s) => slotLabel(s, 60))).toEqual(["09:00", "09:30"]);
  });

  it("comes back sorted, always", () => {
    const slots = generateSlots({ now: MON, availability: av({ horizonDays: 5 }), busy: [] });
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
  });

  it("honours a longer appointment length", () => {
    const slots = generateSlots({ now: MON, availability: av({ slotMinutes: 60, week: { 1: ["09:00-11:00"] } }), busy: [] });
    expect(slots.map((s) => slotLabel(s, 60))).toEqual(["09:00", "10:00"]);
  });
});

describe("groupByDay / slotLabel — what the picker renders", () => {
  it("groups into ascending days", () => {
    const slots = generateSlots({ now: MON, availability: av({ horizonDays: 2 }), busy: [] });
    const days = groupByDay(slots, 60);
    expect(days.length).toBeGreaterThan(1);
    expect(days.map((d) => d.day)).toEqual([...days.map((d) => d.day)].sort());
    expect(days[0].day).toBe("2026-08-03");
  });
  it("labels in business time, not UTC", () => {
    expect(slotLabel(MON, 60)).toBe("09:00"); // 08:00 UTC is 09:00 in Casablanca
    expect(slotLabel(MON, 0)).toBe("08:00");
  });
});

describe("zoneOffsetMinutes — the page and the invite must agree", () => {
  it("resolves a real zone against a real instant", () => {
    // A fixed August instant: UTC is 0, Berlin is on summer time (+120).
    const aug = Date.UTC(2026, 7, 3, 12, 0, 0);
    expect(zoneOffsetMinutes("UTC", aug)).toBe(0);
    expect(zoneOffsetMinutes("Europe/Berlin", aug)).toBe(120);
    // …and the same zone in January is +60. A hardcoded offset can't do this,
    // which is exactly the bug this exists to prevent.
    expect(zoneOffsetMinutes("Europe/Berlin", Date.UTC(2026, 0, 3, 12, 0, 0))).toBe(60);
  });

  it("tracks Morocco's Ramadan shift instead of assuming +1", () => {
    // Morocco is UTC+1 year-round EXCEPT during Ramadan, when it drops to UTC+0.
    // Ramadan 2026 runs roughly 17 Feb – 19 Mar.
    const ramadan = zoneOffsetMinutes("Africa/Casablanca", Date.UTC(2026, 2, 1, 12, 0, 0));
    const normal  = zoneOffsetMinutes("Africa/Casablanca", Date.UTC(2026, 6, 1, 12, 0, 0));
    expect(normal).toBe(60);
    expect(ramadan).toBe(0);
  });

  it("falls back to the default rather than throwing on a bogus zone", () => {
    expect(zoneOffsetMinutes("Not/AZone", Date.UTC(2026, 7, 3))).toBe(DEFAULT_AVAILABILITY.tzOffsetMinutes);
  });
});

describe("looksLikeEmail — we only ever SEND to it", () => {
  it("accepts real addresses", () => {
    for (const e of ["a@b.co", "youness.taoufiq@borivon.com", "x+tag@sub.domain.de"]) expect(looksLikeEmail(e), e).toBe(true);
  });
  it("rejects junk", () => {
    for (const e of ["", "a@b", "no-at.com", "a b@c.de", "@b.co", "a@.co"]) expect(looksLikeEmail(e), e).toBe(false);
  });
});

describe("followUpsFor — where bookings actually become business", () => {
  const START = Date.UTC(2026, 7, 10, 9, 0, 0);
  it("creates the reminder day-before, the log-it, and the real chase", () => {
    const f = followUpsFor({ startsAt: START, name: "Anna", kind: "company" });
    expect(f).toHaveLength(3);
    expect(f[0].dueAt).toBe(START - DAY);
    expect(f[1].dueAt).toBe(START + HOUR);
    expect(f[2].dueAt).toBe(START + 2 * DAY);
    // Always in chronological order so the reminder list reads sensibly.
    expect(f.map((x) => x.dueAt)).toEqual([...f.map((x) => x.dueAt)].sort((a, b) => a - b));
  });
  it("covers all three kinds — a clinic must never read like a candidate", () => {
    const clinic = followUpsFor({ startsAt: START, name: "UKSH Kiel", kind: "clinic" });
    expect(clinic[2].text).toContain("clinic");
    expect(clinic[2].text).not.toContain("nurse");
    // Every kind produces the SAME three-step chase — a manually-added booking
    // gets chased exactly like a self-booked one, which is the point of it.
    for (const k of ["nurse", "clinic", "company"] as const) {
      expect(followUpsFor({ startsAt: START, name: "X", kind: k })).toHaveLength(3);
    }
  });

  it("names the person AND which conversation it is", () => {
    const nurse = followUpsFor({ startsAt: START, name: "Fatima", kind: "nurse" });
    expect(nurse[0].text).toContain("Fatima");
    expect(nurse[0].text).toContain("nurse");
    const co = followUpsFor({ startsAt: START, name: "UKSH", kind: "company" });
    expect(co[2].text).toContain("company");
  });
  it("stays minimalist — no emojis, per the standing rule", () => {
    for (const f of followUpsFor({ startsAt: START, name: "Anna", kind: "nurse" })) {
      expect(f.text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });
});
