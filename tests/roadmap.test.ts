import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { scoreRoadmap, normalizeAnswers, COST_PER_OPEN_POST_MONTH, COST_PER_DEPARTURE, type RoadmapAnswers } from "../lib/roadmap/score";
import { dueFollowup } from "../lib/roadmap/leadState";
import { signLeadToken, verifyLeadToken } from "../lib/roadmap/token";
import { renderRoadmapPdf, formatEuro } from "../lib/roadmap/pdf";
import { deliveryMail, followupMail, FOLLOWUP_DAYS } from "../lib/roadmap/emails";
import { LEVELS, CLIMB, UI, LANGS } from "../lib/roadmap/content";
import { STAGES, AREAS, STAGE_UI } from "../lib/roadmap/stages";

const healthy: RoadmapAnswers = { facilityType: "hospital", staff: 200, openPosts: 1, leftLastYear: 4, agency: "none", foreign: "most_stayed", onboarding: ["mentor", "german", "housing", "plan", "checkins"], pain: "open_posts" };
const struggling: RoadmapAnswers = { facilityType: "care_home", staff: 30, openPosts: 9, leftLastYear: 12, agency: "very_high", foreign: "tried_left", onboarding: [], pain: "leaving" };

describe("Pflege-Fahrplan scoring", () => {
  it("puts a healthy house on level 5 and a struggling one on level 1", () => {
    expect(scoreRoadmap(healthy).level).toBe(5);
    expect(scoreRoadmap(struggling).level).toBe(1);
  });

  it("uses the same money model as the borivon.com calculator", () => {
    expect(COST_PER_OPEN_POST_MONTH).toBe(18_400);
    expect(COST_PER_DEPARTURE).toBe(39_800);
    const r = scoreRoadmap(struggling);
    expect(r.openCostMonth).toBe(9 * 18_400);
    expect(r.openCostYear).toBe(9 * 18_400 * 12);
    expect(r.turnoverCostYear).toBe(12 * 39_800);
    expect(r.totalYear).toBe(r.openCostYear + r.turnoverCostYear);
  });

  it("names the right bottleneck", () => {
    expect(scoreRoadmap(struggling).bottleneck).toBe("keep");
    expect(scoreRoadmap({ ...healthy, openPosts: 40, leftLastYear: 0 }).bottleneck).toBe("fill");
    expect(scoreRoadmap({ ...healthy, pain: "paperwork" }).bottleneck).toBe("process");
  });

  it("survives garbage input", () => {
    const a = normalizeAnswers({ staff: -5 as never, openPosts: "abc" as never, agency: "x" as never, onboarding: ["mentor", "hack"] as never });
    expect(a.staff).toBe(1);
    expect(a.openPosts).toBe(0);
    expect(a.agency).toBe("none");
    expect(a.onboarding).toEqual(["mentor"]);
    const r = scoreRoadmap({});
    expect(r.level).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(r.totalYear)).toBe(true);
  });
});

describe("follow-up timing (double opt-in)", () => {
  const confirmed = "2026-10-01T09:00:00.000Z";
  const at = (days: number) => new Date(Date.parse(confirmed) + days * 86_400_000 + 3_600_000);
  it("sends nothing without a ticked box AND a confirm click", () => {
    expect(dueFollowup({ consent: { tipsAsked: true, confirmedAt: null } }, at(30))).toBeNull();
    expect(dueFollowup({ consent: { tipsAsked: false, confirmedAt: confirmed } }, at(30))).toBeNull();
  });
  it("follows FOLLOWUP_DAYS and stops after the last one", () => {
    const base = { consent: { tipsAsked: true, confirmedAt: confirmed } };
    expect(dueFollowup({ ...base, seq: { step: 0 } }, at(FOLLOWUP_DAYS[0] - 1))).toBeNull();
    expect(dueFollowup({ ...base, seq: { step: 0 } }, at(FOLLOWUP_DAYS[0]))).toBe(0);
    expect(dueFollowup({ ...base, seq: { step: 2 } }, at(FOLLOWUP_DAYS[2]))).toBe(2);
    expect(dueFollowup({ ...base, seq: { step: FOLLOWUP_DAYS.length } }, at(60))).toBeNull();
  });
  it("never after an unsubscribe, never two within a day", () => {
    const base = { consent: { tipsAsked: true, confirmedAt: confirmed } };
    expect(dueFollowup({ ...base, unsubscribedAt: confirmed }, at(30))).toBeNull();
    const now = at(20);
    expect(dueFollowup({ ...base, seq: { step: 1, lastSentAt: new Date(now.getTime() - 3_600_000).toISOString() } }, now)).toBeNull();
  });
});

describe("signed links", () => {
  const key = "test-secret-0123456789abcdef";
  it("verifies its own token and rejects tampering", async () => {
    const t = await signLeadToken("confirm", "lead-1", key);
    expect(await verifyLeadToken("confirm", "lead-1", t, key)).toBe(true);
    expect(await verifyLeadToken("confirm", "lead-2", t, key)).toBe(false);
    expect(await verifyLeadToken("unsub", "lead-1", t, key)).toBe(false);
    expect(await verifyLeadToken("confirm", "lead-1", t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"), key)).toBe(false);
    expect(await verifyLeadToken("confirm", "lead-1", t, "")).toBe(false);
  });
});

describe("content + emails", () => {
  it("has every level and climb plan in all three languages", () => {
    for (const l of LANGS) {
      for (const lv of [1, 2, 3, 4, 5] as const) {
        expect(LEVELS[lv].name[l]).toBeTruthy();
        expect(CLIMB[lv].steps.length).toBeGreaterThan(0);
      }
      expect(Object.keys(UI[l]).sort()).toEqual(Object.keys(UI.de).sort());
      expect(Object.keys(STAGE_UI[l]).sort()).toEqual(Object.keys(STAGE_UI.de).sort());
      for (const lv of [1, 2, 3, 4, 5] as const) {
        for (const a of AREAS) {
          expect(STAGES[lv].rows[a.key].c[l]).toBeTruthy();
          expect(STAGES[lv].rows[a.key].g[l]).toBeTruthy();
        }
        expect(STAGES[lv].story[l] && STAGES[lv].bottom[l] && STAGES[lv].gradBy[l]).toBeTruthy();
      }
    }
  });
  it("delivery mail: level in subject, fit P.S., confirm button only when asked", () => {
    const m = deliveryMail({ lang: "de", firstName: "Anna", facility: "Haus", result: scoreRoadmap(struggling) });
    expect(m.subject).toContain("Stufe 1");
    expect(m.html).toContain("Prüfen Sie hier, ob Ihr Haus passt");
    expect(m.text).not.toMatch(/<[a-z]/);
    const r = scoreRoadmap(struggling);
    expect(deliveryMail({ lang: "de", firstName: "Anna", facility: "Haus", result: r }).html).not.toContain("Tipps senden");
    expect(deliveryMail({ lang: "de", firstName: "Anna", facility: "Haus", result: r, confirmUrl: "https://x/c" }).html).toContain("https://x/c");
  });
  it("has exactly one follow-up per scheduled day, each with an unsubscribe link", () => {
    const r = scoreRoadmap(struggling);
    for (const l of LANGS) {
      for (let n = 0; n < FOLLOWUP_DAYS.length; n++) {
        const m = followupMail(n, { lang: l, firstName: "A", result: r, unsubscribeUrl: "https://x/u" });
        expect(m?.html).toContain("https://x/u");
      }
      expect(followupMail(FOLLOWUP_DAYS.length, { lang: l, firstName: "A", result: r, unsubscribeUrl: "u" })).toBeNull();
    }
  });
  it("formats euros per language", () => {
    expect(formatEuro(18400, "de")).toBe("18.400 €");
    expect(formatEuro(18400, "en")).toBe("€18,400");
    expect(formatEuro(18400, "fr")).toBe("18 400 €");
  });
});

describe("the PDF", () => {
  for (const lang of LANGS) {
    it(`renders 10 A4 pages in ${lang}`, async () => {
      const bytes = await renderRoadmapPdf({ result: scoreRoadmap(struggling), lang, firstName: "Anna", facility: "Seniorenzentrum Am Park", date: new Date("2026-10-21") });
      expect(bytes.length).toBeGreaterThan(20_000);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(10);
    }, 30_000);
  }
});

describe("level copy", () => {
  it("never repeats the level tagline as its bottom line", () => {
    for (const l of LANGS) for (const lv of [1, 2, 3, 4, 5] as const) {
      expect(STAGES[lv].bottom[l]).not.toBe(LEVELS[lv].line[l]);
    }
  });
});

describe("pictograms", () => {
  it("every icon renders as inline SVG for the page, one per reason", async () => {
    const { ICONS, iconSvg, REASON_ICONS } = await import("../lib/roadmap/icons");
    for (const n of Object.keys(ICONS) as (keyof typeof ICONS)[]) {
      const svg = iconSvg(n);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain("<path");
    }
    const { REASONS } = await import("../lib/roadmap/content");
    expect(REASON_ICONS.length).toBe(REASONS.length);
  });
});
