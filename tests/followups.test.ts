import { describe, it, expect } from "vitest";
import { hoursSince, formatFollowups, FOLLOWUP_GATE_HOURS, FOLLOWUP_MAX_NUDGES } from "@/lib/followups";

const NOW = Date.parse("2026-06-15T18:00:00.000Z");

describe("follow-up chase helpers", () => {
  it("hoursSince measures elapsed hours; junk → Infinity (always eligible)", () => {
    expect(Math.round(hoursSince("2026-06-15T06:00:00.000Z", NOW))).toBe(12);
    expect(hoursSince("not-a-date", NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it("gate (~12h) and max-nudges are sane", () => {
    expect(FOLLOWUP_GATE_HOURS).toBeGreaterThanOrEqual(8);
    expect(FOLLOWUP_GATE_HOURS).toBeLessThanOrEqual(12);
    expect(FOLLOWUP_MAX_NUDGES).toBe(8);
  });

  it("formats one consolidated digest with ages + reminder count", () => {
    const out = formatFollowups([
      { to_email: "a.gombert@calmaroi.de", subject: "CVs Hajar", sent_at: "2026-06-14T18:00:00.000Z", nudge: 2 },
      { to_email: "o.musleh@calmaroi.de", subject: "", sent_at: "2026-06-15T12:00:00.000Z", nudge: 1 },
    ], NOW);
    expect(out).toContain("No reply yet");
    expect(out).toContain("a.gombert@calmaroi.de — \"CVs Hajar\" (sent 1d ago, reminder 2/8)");
    expect(out).toContain("o.musleh@calmaroi.de — \"(no subject)\" (sent 6h ago, reminder 1/8)");
    expect(out).toContain("stop chasing");
  });
});
