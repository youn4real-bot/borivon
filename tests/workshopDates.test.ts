import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WORKSHOP_DATES, upcomingOpenDates, dateRangeLabel, berlinToday } from "../lib/workshopDates";
import { followupMail } from "../lib/roadmap/emails";
import { scoreRoadmap, normalizeAnswers } from "../lib/roadmap/score";

/**
 * The workshop dates must be right EVERYWHERE (founder 2026-11-09): the /workshop page,
 * the follow-up mails, and never a date that has already passed.
 */
const page = readFileSync(path.join(__dirname, "..", "content", "pflege", "workshop.html"), "utf8");
const cards = [...page.matchAll(/class="date( sold)?"[^>]*data-start="([\d-]+)" data-end="([\d-]+)"[^>]*>(.*?)<\/(?:div|a)>/g)]
  .map((m) => ({ sold: !!m[1], start: m[2], end: m[3], inner: m[4] }));

afterEach(() => { vi.useRealTimers(); });

describe("workshop dates", () => {
  it("are Saturday + Sunday, in order", () => {
    for (const d of WORKSHOP_DATES) {
      expect(new Date(d.start + "T12:00:00Z").getUTCDay(), d.start).toBe(6);
      expect(new Date(d.end + "T12:00:00Z").getUTCDay(), d.end).toBe(0);
    }
    const starts = WORKSHOP_DATES.map((d) => d.start);
    expect([...starts].sort()).toEqual(starts);
  });

  it("the page shows exactly the same dates and seats as lib/workshopDates", () => {
    expect(cards.map((c) => [c.start, c.end])).toEqual(WORKSHOP_DATES.map((d) => [d.start, d.end]));
    cards.forEach((c, i) => {
      const seats = WORKSHOP_DATES[i].seatsLeft;
      if (seats === 0) { expect(c.sold).toBe(true); expect(c.inner).toContain("Ausgebucht"); }
      else if (seats === null) { expect(c.sold).toBe(false); expect(c.inner).toContain(">Offen<"); }
      else { expect(c.sold).toBe(false); expect(c.inner).toContain(`${seats} Plätze frei`); }
    });
  });

  it("only upcoming, not sold-out dates count as open", () => {
    const at = (iso: string) => new Date(iso).getTime();
    expect(upcomingOpenDates(at("2026-11-09T10:00:00Z")).map((d) => d.start)).toEqual(["2027-02-06", "2027-05-22", "2027-08-28"]);
    expect(upcomingOpenDates(at("2027-02-06T10:00:00Z")).map((d) => d.start)).toEqual(["2027-05-22", "2027-08-28"]);
    expect(upcomingOpenDates(at("2027-09-01T10:00:00Z"))).toEqual([]);
    expect(berlinToday(at("2026-11-09T23:30:00Z"))).toBe("2026-11-10"); // German midnight, not UTC
  });

  it("labels read naturally in every language", () => {
    const feb = WORKSHOP_DATES[1];
    expect(dateRangeLabel(feb, "de")).toBe("6.–7. Februar 2027");
    expect(dateRangeLabel(feb, "en")).toBe("February 6–7, 2027");
    expect(dateRangeLabel(feb, "fr")).toBe("6–7 février 2027");
  });

  it("the last follow-up mail names the next open dates, never a past one", () => {
    const result = scoreRoadmap(normalizeAnswers({}));
    const last = (lang: "de" | "en" | "fr") =>
      followupMail(3, { lang, result, unsubscribeUrl: "https://borivon.com/u", salutation: "none", lastName: "Muster", firstName: "Eva" } as never);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    const de = last("de")!;
    expect(de.html).toContain("6.–7. Februar 2027");
    expect(de.html).toContain("22.–23. Mai 2027");
    expect(de.html).toContain("3.000 € pro Person.");
    expect(last("en")!.html).toContain("February 6–7, 2027");
    vi.setSystemTime(new Date("2027-03-01T10:00:00Z"));
    const later = last("de")!;
    expect(later.html).not.toContain("Februar");
    expect(later.html).toContain("22.–23. Mai 2027");
    expect(later.html).toContain("28.–29. August 2027");
  });
});
