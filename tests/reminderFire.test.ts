import { describe, it, expect } from "vitest";
import { nextFutureOccurrence, nextOccurrence } from "../lib/reminderTime";

// When a recurring reminder fires (lib/reminderFire.ts), it must re-arm to the next
// occurrence that is STRICTLY in the future. On Vercel HOBBY there's no sub-daily cron,
// so a daily reminder can sit days overdue and get flushed by an inbound message — if we
// only advanced +1 period it could STILL be in the past and re-fire on the very next
// message, spamming the founder. nextFutureOccurrence is the pure core of that re-arm.

const TZ = process.env.CALENDAR_TZ || "Africa/Casablanca";
// A UTC instant from a TZ-local wall clock, so the fixtures read in the founder's time.
function localInstant(y: number, mo: number, d: number, hh: number, mm: number): Date {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const seen = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess)).reduce((a, p) => { if (p.type !== "literal") a[p.type] = p.value; return a; }, {} as Record<string, string>);
  const asUTC = Date.UTC(+seen.year, +seen.month - 1, +seen.day, +seen.hour, +seen.minute);
  return new Date(guess - (asUTC - guess));
}

describe("nextFutureOccurrence — re-arm always lands in the future", () => {
  it("a daily reminder days overdue re-arms to a FUTURE slot, not the next-day-still-past one", () => {
    // Reminder was due 09:00 on Jun 10; it's now Jun 14 13:00 (4 days overdue, past today's 09:00).
    const due = localInstant(2026, 6, 10, 9, 0);
    const now = localInstant(2026, 6, 14, 13, 0);
    const next = nextFutureOccurrence(due.toISOString(), "daily", now)!;
    expect(next).not.toBeNull();
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    // Next future 09:00 after 13:00 on the 14th is the 15th at 09:00.
    expect(next.getTime()).toBe(localInstant(2026, 6, 15, 9, 0).getTime());
  });

  it("preserves the local wall-clock time across the skip (9:00 stays 9:00)", () => {
    const due = localInstant(2026, 6, 1, 9, 0);
    const now = localInstant(2026, 6, 20, 12, 0);
    const next = nextFutureOccurrence(due.toISOString(), "daily", now)!;
    const hh = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", hour: "2-digit" }).format(next);
    expect(hh).toBe("09");
  });

  it("when the +1 period is already in the future, returns it unchanged (no over-skip)", () => {
    // Due today 09:00, now 10:00 → next daily is tomorrow 09:00 (one hop, not two).
    const due = localInstant(2026, 6, 14, 9, 0);
    const now = localInstant(2026, 6, 14, 10, 0);
    const next = nextFutureOccurrence(due.toISOString(), "daily", now)!;
    expect(next.getTime()).toBe(nextOccurrence(due.toISOString(), "daily")!.getTime());
    expect(next.getTime()).toBe(localInstant(2026, 6, 15, 9, 0).getTime());
  });

  it("weekly overdue by several weeks re-arms to a future week on the same weekday", () => {
    const due = localInstant(2026, 6, 1, 9, 0); // a Monday
    const now = localInstant(2026, 6, 25, 9, 30);
    const next = nextFutureOccurrence(due.toISOString(), "weekly", now)!;
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    // step is exactly a multiple of 7 days from the original due
    const stepDays = Math.round((next.getTime() - due.getTime()) / 86_400_000);
    expect(stepDays % 7).toBe(0);
  });

  it("monthly overdue re-arms to a future month preserving day-of-month", () => {
    const due = localInstant(2026, 1, 15, 9, 0);
    const now = localInstant(2026, 6, 20, 9, 0);
    const next = nextFutureOccurrence(due.toISOString(), "monthly", now)!;
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    const dom = new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "2-digit" }).format(next);
    expect(dom).toBe("15");
  });
});

// A NON-recurring reminder must never re-arm — once it fires it's done. The fire path
// keys re-arm off this returning null.
describe("nextFutureOccurrence — non-recurring never re-arms", () => {
  it("returns null for a bare/empty recurrence", () => {
    const due = localInstant(2026, 6, 10, 9, 0);
    const now = localInstant(2026, 6, 14, 13, 0);
    // @ts-expect-error — deliberately passing a non-recurrence to assert the guard
    expect(nextFutureOccurrence(due.toISOString(), "", now)).toBeNull();
  });
});
