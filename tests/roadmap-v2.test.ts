import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { normalizeForm, toModel, facilityLine, openPostsOf, formSummaryDe, isFormV2 } from "../lib/roadmap/form";
import { buildTimeline, STEP_WEEKS } from "../lib/roadmap/timeline";
import { addressName, greeting } from "../lib/roadmap/consent";
import { dueFollowup } from "../lib/roadmap/leadState";
import { scoreRoadmap } from "../lib/roadmap/score";
import type { Level } from "../lib/roadmap/score";

const TOTAL = Object.values(STEP_WEEKS).reduce((a, b) => a + b, 0);
const today = new Date("2026-11-08T10:00:00Z");

describe("v2 form → model", () => {
  it("keeps only known codes, drops grund unless it failed, drops a date without start=date", () => {
    const f = normalizeForm({ art: "x", land: "ZZ", bedarf: "6-10", erfahrung: "never", grund: ["papers"], start: "6m", datum: "2027-01-01", haben: ["flat", "evil"] });
    expect(f.art).toBe("care_home");
    expect(f.land).toBe("");
    expect(f.grund).toEqual([]);
    expect(f.datum).toBe("");
    expect(f.haben).toEqual(["flat"]);
    expect(normalizeForm({ start: "date", datum: "nope" }).start).toBe("asap");
  });
  it("maps to the money model honestly", () => {
    const f = normalizeForm({ art: "rehab", plaetze: "100-200", bedarf: "11-25", leasing: "6+", erfahrung: "failed", grund: ["german"] });
    const m = toModel(f);
    expect(m.facilityType).toBe("hospital");
    expect(m.openPosts).toBe(openPostsOf(f));
    expect(m.openPosts).toBe(9); // 18 over the year, about half open at once
    expect(m.leftLastYear).toBe(0); // not asked any more
    expect(m.agency).toBe("very_high");
    expect(m.foreign).toBe("tried_left");
    expect(m.pain).toBe("german");
    expect(scoreRoadmap(m).turnoverCostYear).toBe(0);
  });
  it("cover line + admin summary", () => {
    const f = normalizeForm({ v: 2, art: "care_home", land: "BY", erfahrung: "failed", grund: ["papers"] });
    expect(facilityLine(f, "de")).toBe("Pflegeheim · Bayern");
    expect(isFormV2({ v: 2 })).toBe(true);
    expect(formSummaryDe(f).find(([k]) => k === "Schiefgelaufen")?.[1]).toBe("Die Papiere dauerten zu lange");
  });
});

describe("personal deadline", () => {
  it("fixed date: latest start = date − all steps", () => {
    const tl = buildTimeline({ start: "date", datum: "2027-09-01" }, today);
    expect(tl.status).toBe("ok");
    expect(tl.latestStart!.toISOString().slice(0, 10)).toBe(new Date(Date.parse("2027-09-01T00:00:00Z") - TOTAL * 7 * 86_400_000).toISOString().slice(0, 10));
    expect(tl.steps.at(-1)!.to.toISOString().slice(0, 10)).toBe("2027-09-01");
    expect(tl.weeksLeft).toBe(11);
  });
  it("too soon → late, plan starts today", () => {
    const tl = buildTimeline({ start: "6m", datum: "" }, today);
    expect(tl.status).toBe("late");
    expect(tl.steps[0].from.toISOString().slice(0, 10)).toBe("2026-11-08");
  });
  it("as soon as possible → no deadline, just the first day", () => {
    const a = buildTimeline({ start: "asap", datum: "" }, today);
    expect(a.status).toBe("asap");
    expect(a.totalWeeks).toBe(TOTAL);
  });
});

describe("names + repeat requests", () => {
  it("Keine Angabe uses first + last name, never a guessed title", () => {
    expect(addressName("de", "none", "Müller", "Anna")).toBe("Anna Müller");
    expect(greeting("de", "none", "Müller", "Anna")).toBe("Hallo Anna Müller,");
    expect(greeting("de", "none", "Müller")).toBe("Hallo,");
    expect(addressName("de", "frau", "Müller", "Anna")).toBe("Frau Müller");
  });
  it("an older request stops its tips once a newer one exists", () => {
    const d = { consent: { confirmedAt: "2026-10-01T00:00:00Z" }, delivery: { sentAt: "2026-10-01T00:00:00Z" }, seq: { step: 0 } };
    const now = new Date("2026-10-10T00:00:00Z");
    expect(dueFollowup(d, now)).toBe(0);
    expect(dueFollowup({ ...d, supersededBy: "new" }, now)).toBeNull();
  });
});

describe("the page", () => {
  const page = readFileSync("content/pflege/fahrplan.html", "utf8");
  it("matches the spec: no phone, no facility name, no preview label, Vorname + Nachname", () => {
    expect(page).not.toContain("Vorschau · nichts wird gesendet");
    expect(page).not.toMatch(/type="tel"/);
    expect(page).toContain("c-vor");
    expect(page).toContain("c-nach");
    expect(page).toContain("Was ist beim letzten Mal schiefgelaufen?");
    expect(page).toContain("Teil {n} von 4 erledigt.");
    expect(page).not.toContain("Welches Deutsch");
  });
  it("sends only codes lib/roadmap/form.ts knows", () => {
    for (const code of ["care_home", "home_care", "disability", "never_came", "me_board", "asap", "12m"]) expect(page).toContain(code);
  });
});

describe("PDF with the v2 form", () => {
  it("has the timeline page, every link on the page", async () => {
    const { renderRoadmapPdf, roadmapPageCount } = await import("../lib/roadmap/pdf");
    const { pdfLinks } = await import("../lib/roadmap/hosted");
    const { PDFDocument } = await import("pdf-lib");
    for (const lang of ["de", "en", "fr"] as const) {
      const form = normalizeForm({ art: "home_care", land: "NW", bedarf: "26-50", leasing: "1-2", start: "date", datum: "2027-03-01" });
      const result = scoreRoadmap(toModel(form));
      const bytes = await renderRoadmapPdf({ result, lang, form, name: "Anna Müller", facility: facilityLine(form, lang), date: today });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(roadmapPageCount(result.level as Level, true));
      for (const l of await pdfLinks(bytes)) expect(l.y + l.h).toBeLessThan(0.93);
    }
  }, 120_000);
});
