import { describe, it, expect } from "vitest";
import { localToInstant } from "../lib/workspaceCalendar";

// Calendar times must always mean the founder's timezone (Africa/Casablanca), NEVER the
// server's UTC. This is the core that the invite end-time bug violated (it used
// `new Date(bareLocal)` = server-UTC). Asserting via a TZ-formatter so it holds under
// DST / Ramadan shifts, not a hardcoded offset.
const TZ = "Africa/Casablanca";
function clockInTz(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

describe("localToInstant — bare local wall-clock means Casablanca, not server-UTC", () => {
  it("17:00 local reads back as 17:00 in Casablanca", () => {
    expect(clockInTz(localToInstant("2026-06-21T17:00:00"))).toBe("17:00");
  });
  it("a bare-local string is NOT taken as UTC (the bug): its UTC hour is shifted", () => {
    // June (non-Ramadan) Morocco = UTC+1, so 17:00 Casablanca = 16:00Z.
    expect(localToInstant("2026-06-21T17:00:00").toISOString()).toBe("2026-06-21T16:00:00.000Z");
  });
  it("an absolute Z instant passes through unchanged", () => {
    expect(localToInstant("2026-06-21T16:00:00Z").toISOString()).toBe("2026-06-21T16:00:00.000Z");
  });
  it("an explicit +offset instant passes through unchanged", () => {
    expect(localToInstant("2026-06-21T17:00:00+01:00").toISOString()).toBe("2026-06-21T16:00:00.000Z");
  });
  it("a +30min end stays exactly +30min from the start anchor (no TZ drift)", () => {
    const start = localToInstant("2026-06-21T17:00:00");
    const end = new Date(start.getTime() + 30 * 60_000);
    expect(end.getTime() - start.getTime()).toBe(30 * 60_000);
    expect(clockInTz(end)).toBe("17:30");
  });
});
