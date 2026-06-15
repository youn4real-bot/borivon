import { describe, it, expect } from "vitest";
import { slaKey, hoursOld, formatSlaEmails, SLA_HOURS } from "@/lib/inboxSla";
import type { UnansweredEmail } from "@/lib/gmailInbox";

const NOW = Date.parse("2026-06-15T18:00:00.000Z");
function mk(over: Partial<UnansweredEmail> = {}): UnansweredEmail {
  return { from: "anna@klinik.de", fromName: "Anna Gombert", subject: "Bewerbung Hajar", date: "2026-06-15T10:00:00.000Z", ageDays: 0, ...over };
}

describe("inbox SLA helpers", () => {
  it("hoursOld measures from the receive time", () => {
    expect(Math.round(hoursOld(mk({ date: "2026-06-15T10:00:00.000Z" }), NOW))).toBe(8);
    expect(Math.round(hoursOld(mk({ date: "2026-06-15T12:00:00.000Z" }), NOW))).toBe(6);
    expect(hoursOld(mk({ date: "not-a-date" }), NOW)).toBe(0);
  });

  it("the 6h breach filter keeps only emails at/over the SLA", () => {
    const emails = [
      mk({ from: "a@x.de", date: "2026-06-15T11:00:00.000Z" }), // 7h → breach
      mk({ from: "b@x.de", date: "2026-06-15T14:00:00.000Z" }), // 4h → not yet
      mk({ from: "c@x.de", date: "2026-06-15T12:00:00.000Z" }), // 6h → breach (boundary)
    ];
    const breached = emails.filter((e) => hoursOld(e, NOW) >= SLA_HOURS).map((e) => e.from);
    expect(breached).toEqual(["a@x.de", "c@x.de"]);
  });

  it("slaKey is stable per message (sender + receive time)", () => {
    expect(slaKey(mk())).toBe("anna@klinik.de|2026-06-15T10:00:00.000Z");
    // Same sender, different arrival → different key (two distinct emails).
    expect(slaKey(mk({ date: "2026-06-15T12:00:00.000Z" }))).not.toBe(slaKey(mk()));
  });

  it("formats a readable nudge with hour/day ages", () => {
    const out = formatSlaEmails([
      mk({ fromName: "Anna", subject: "Interview", date: "2026-06-15T11:00:00.000Z" }),
      mk({ fromName: "Omar", subject: "Vertrag", date: "2026-06-13T18:00:00.000Z" }),
    ], NOW);
    expect(out).toContain("Still waiting on your reply (6h+)");
    expect(out).toContain("Anna — Interview (7h ago)");
    expect(out).toContain("Omar — Vertrag (2d ago)");
  });
});
