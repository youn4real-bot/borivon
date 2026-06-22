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

  // EXPLICIT clock must win over the keyword default — "tonight at 11pm" = 23:00, not 20:00.
  it("'tonight at 11pm' → today 23:00 (explicit clock beats the 'tonight' default)", () => {
    const { dueAt } = parseReminderTime("remind me tonight at 11pm to lock the door", NOW);
    const l = local(dueAt!);
    expect(l.day).toBe(18);
    expect(l.hh).toBe(23);
    expect(l.mm).toBe(0);
  });

  // Bare "in N" with NO unit = minutes (the founder's shorthand).
  it("'in 30' (no unit) → now + 30 min", () => {
    const { dueAt } = parseReminderTime("remind me in 30 to call the bank", NOW);
    expect(dueAt!.getTime()).toBe(NOW.getTime() + 30 * 60_000);
  });

  // EOD / COB → 18:00.
  it("'EOD' → today 18:00", () => {
    const { dueAt } = parseReminderTime("remind me to send the report EOD", NOW);
    const l = local(dueAt!);
    expect(l.day).toBe(18);
    expect(l.hh).toBe(18);
  });

  // Bare hour 1-11 with no am/pm, said in the afternoon → PM (disambiguated against now).
  it("'at 8' said at 18:00 local → 20:00 (PM-disambiguated)", () => {
    const evening = new Date("2026-06-18T17:00:00Z"); // 18:00 local at UTC+1
    const { dueAt } = parseReminderTime("remind me at 8 to take my meds", evening);
    const l = local(dueAt!);
    expect(l.day).toBe(18);
    expect(l.hh).toBe(20);
  });

  // The English article "a" before a number must NOT be read as a clock hour — otherwise
  // "book a 2 bedroom" / "send a 5 page summary" fabricate a 2pm/5pm reminder.
  it("'a <number>' (indefinite article) does NOT fabricate a time", () => {
    expect(parseReminderTime("remind me to book a 2 bedroom apartment", NOW).dueAt).toBeNull();
    expect(parseReminderTime("remind me to send a 5 page summary", NOW).dueAt).toBeNull();
  });
  // German "um 9" before an hour still parses (ASCII keyword, word-boundary-safe).
  it("German 'um 9' still parses a clock hour", () => {
    const evening = new Date("2026-06-18T17:00:00Z"); // 18:00 local → PM-disambiguates 9→21
    const { dueAt } = parseReminderTime("erinnere mich um 9 anzurufen", evening);
    expect(dueAt).not.toBeNull();
    expect(local(dueAt!).hh).toBe(21);
  });

  // A "today / this morning / tonight" keyword whose hour is already PAST must roll to the
  // next day — never store a past instant that fires on the very next message.
  it("'this morning' said in the afternoon rolls to tomorrow 09:00", () => {
    const afternoon = new Date("2026-06-18T13:00:00Z"); // 14:00 local
    const { dueAt } = parseReminderTime("remind me this morning to call the embassy", afternoon);
    const l = local(dueAt!);
    expect(l.day).toBe(19); // tomorrow, not today-9am-in-the-past
    expect(l.hh).toBe(9);
    expect(dueAt!.getTime()).toBeGreaterThan(afternoon.getTime());
  });
  it("'tonight' said late at night rolls to tomorrow 20:00", () => {
    const lateNight = new Date("2026-06-18T22:30:00Z"); // 23:30 local
    const { dueAt } = parseReminderTime("remind me tonight to lock up", lateNight);
    const l = local(dueAt!);
    expect(l.day).toBe(19);
    expect(l.hh).toBe(20);
    expect(dueAt!.getTime()).toBeGreaterThan(lateNight.getTime());
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
