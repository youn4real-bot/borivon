import { describe, it, expect } from "vitest";
import { parseReminderTime, localIsoToInstant, nextOccurrence } from "../lib/reminderTime";

// All reminders resolve in the founder's tz (Africa/Casablanca). June 2026 is NOT
// Ramadan, so Morocco sits at UTC+1 — but the tests assert via a TZ-local formatter
// (never a hardcoded offset), so they stay correct regardless of DST/Ramadan logic.
const TZ = "Africa/Casablanca";
function local(d: Date): { y: number; m: number; day: number; hh: number; mm: number; dow: string } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d).reduce((a, x) => { if (x.type !== "literal") a[x.type] = x.value; return a; }, {} as Record<string, string>);
  return { y: +p.year, m: +p.month, day: +p.day, hh: +p.hour, mm: +p.minute, dow: p.weekday };
}

// Thursday 2026-06-18, 11:00 local (10:00Z at UTC+1).
const NOW = new Date("2026-06-18T10:00:00Z");

describe("parseReminderTime — capture the time the founder actually said", () => {
  it("'at 3pm' → today 15:00 local", () => {
    const { dueAt } = parseReminderTime("remind me to call the embassy at 3pm", NOW);
    expect(dueAt).not.toBeNull();
    const l = local(dueAt!);
    expect(l.day).toBe(18);
    expect(l.hh).toBe(15);
    expect(l.mm).toBe(0);
  });

  it("'in 2 hours' → now + 2h", () => {
    const { dueAt } = parseReminderTime("remind me in 2 hours to follow up", NOW);
    expect(dueAt).not.toBeNull();
    expect(dueAt!.getTime()).toBe(NOW.getTime() + 2 * 3600_000);
  });

  it("'in 30 min' → now + 30m", () => {
    const { dueAt } = parseReminderTime("ping me in 30 min", NOW);
    expect(dueAt!.getTime()).toBe(NOW.getTime() + 30 * 60_000);
  });

  it("'tomorrow 9am' → next day 09:00 local", () => {
    const { dueAt } = parseReminderTime("remind me tomorrow 9am to review diplomas", NOW);
    const l = local(dueAt!);
    expect(l.day).toBe(19);
    expect(l.hh).toBe(9);
  });

  it("'tonight' → today 20:00 local", () => {
    const { dueAt } = parseReminderTime("remind me tonight to send the contract", NOW);
    const l = local(dueAt!);
    expect(l.day).toBe(18);
    expect(l.hh).toBe(20);
  });

  it("'monday 10h' → the coming Monday 10:00", () => {
    const { dueAt } = parseReminderTime("remind me monday 10h to send the update", NOW);
    const l = local(dueAt!);
    expect(l.dow).toBe("Mon");
    expect(l.hh).toBe(10);
    expect(dueAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("'15h30' 24-hour time → 15:30 today", () => {
    const { dueAt } = parseReminderTime("rappelle-moi à 15h30 d'appeler", NOW);
    const l = local(dueAt!);
    expect(l.hh).toBe(15);
    expect(l.mm).toBe(30);
  });

  it("a time already past today rolls to tomorrow", () => {
    const { dueAt } = parseReminderTime("remind me at 9am to call", NOW); // 9am < 11:00 now
    const l = local(dueAt!);
    expect(l.day).toBe(19); // tomorrow
    expect(l.hh).toBe(9);
  });

  it("explicit date '20/6' → June 20 this year, default 09:00", () => {
    const { dueAt } = parseReminderTime("remind me on 20/6 to renew", NOW);
    const l = local(dueAt!);
    expect(l.m).toBe(6);
    expect(l.day).toBe(20);
    expect(l.hh).toBe(9);
  });

  it("no time mentioned → null (saved undated)", () => {
    const { dueAt } = parseReminderTime("remind me to chase the passport", NOW);
    expect(dueAt).toBeNull();
  });
});

describe("localIsoToInstant — model-emitted local wall-clock ISO", () => {
  it("keeps the wall-clock time in the founder's tz", () => {
    const d = localIsoToInstant("2026-06-19T15:00:00");
    expect(d).not.toBeNull();
    const l = local(d!);
    expect(l.day).toBe(19);
    expect(l.hh).toBe(15);
  });
  it("date-only defaults to 09:00 local", () => {
    const l = local(localIsoToInstant("2026-06-20")!);
    expect(l.day).toBe(20);
    expect(l.hh).toBe(9);
  });
  it("rejects garbage", () => {
    expect(localIsoToInstant("not a date")).toBeNull();
  });
});

describe("nextOccurrence — recurring re-arm preserves wall-clock", () => {
  it("weekly = +7 days, same local time", () => {
    const from = localIsoToInstant("2026-06-22T09:00:00")!; // a Monday 09:00
    const next = nextOccurrence(from.toISOString(), "weekly")!;
    const l = local(next);
    expect(l.day).toBe(29);
    expect(l.hh).toBe(9);
  });
  it("daily = +1 day", () => {
    const from = localIsoToInstant("2026-06-18T20:00:00")!;
    const l = local(nextOccurrence(from.toISOString(), "daily")!);
    expect(l.day).toBe(19);
    expect(l.hh).toBe(20);
  });
  it("monthly clamps the 31st to the last day of a short month", () => {
    const from = localIsoToInstant("2026-01-31T09:00:00")!;
    const l = local(nextOccurrence(from.toISOString(), "monthly")!);
    expect(l.m).toBe(2);
    expect(l.day).toBe(28); // 2026 is not a leap year
    expect(l.hh).toBe(9);
  });
});
