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

describe("admin lead summary", () => {
  it("turns a roadmap lead's nested details into plain text chips", async () => {
    const { roadmapLeadChips, plainDetailChips } = await import("../lib/roadmap/leadSummary");
    const details = {
      source: "roadmap", lang: "de", facility: "Haus", city: "Köln", role: "PDL", heardFrom: "linkedin",
      answers: { facilityType: "care_home", staff: 60, openPosts: 6, leftLastYear: 9, agency: "high", foreign: "never", onboarding: ["mentor", "german"], pain: "agency" },
      result: { level: 2, score: 41, bottleneck: "agency", totalYear: 1683000 },
      consent: { tipsAsked: true, confirmedAt: "2026-10-22T10:00:00Z" }, seq: { step: 1 }, unsubscribedAt: null,
    };
    const chips = roadmapLeadChips(details, "de");
    for (const c of chips) { expect(typeof c.k).toBe("string"); expect(typeof c.v).toBe("string"); }
    const v = Object.fromEntries(chips.map((c) => [c.k, c.v]));
    expect(v.Stufe).toBe("2 · Lückenfüller");
    expect(v["Verlust/Jahr"]).toBe("1.683.000 €");
    expect(v.Personal).toBe("60 · 6 offen · 9 gegangen");
    expect(v.Tipps).toBe("bestätigt · 1/4 Mails");
    expect(roadmapLeadChips(null, "en").length).toBeGreaterThan(0);
    expect(roadmapLeadChips(JSON.stringify(details), "de")).toEqual(chips);
    expect(roadmapLeadChips({ answers: "garbage", result: 5 }, "fr").every((c) => typeof c.v === "string")).toBe(true);
    // generic leads never pass an object through to React
    expect(plainDetailChips({ a: "x", b: { c: 1 }, d: "", e: 3 })).toEqual([{ k: "a", v: "x" }, { k: "e", v: "3" }]);
  });
});

describe("business email only", () => {
  it("refuses free mailbox providers, accepts company domains", async () => {
    const { isFreeMail } = await import("../lib/roadmap/freeMail");
    for (const m of ["youness@gmail.com", "A@GMX.DE", "x@web.de", "x@t-online.de", "x@outlook.fr", "x@orange.fr", "x@icloud.com", " x@yahoo.com "]) expect(isFreeMail(m)).toBe(true);
    for (const m of ["pdl@seniorenzentrum-am-park.de", "hr@charite.de", "contact@borivon.com", "not-an-email"]) expect(isFreeMail(m)).toBe(false);
  });
  it("the page uses the very same list as the server", async () => {
    const { readFileSync } = await import("fs");
    const { FREE_MAIL_DOMAINS } = await import("../lib/roadmap/freeMail");
    const page = readFileSync("content/pflege/fahrplan.html", "utf8");
    const m = page.match(/var FREE = (\[[^\]]*\]);/);
    expect(m).toBeTruthy();
    expect(JSON.parse(m![1])).toEqual([...FREE_MAIL_DOMAINS]);
  });
});

describe("email list (Resend contacts)", () => {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const fake = (statuses: number[]) => (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
    return new Response("{}", { status: statuses.shift() ?? 200 });
  }) as unknown as typeof fetch;
  it("adds every lead as NOT subscribed and never re-unsubscribes an existing contact", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const { addLeadToList } = await import("../lib/roadmap/resendList");
    calls.length = 0;
    expect((await addLeadToList({ email: "pdl@haus.de", firstName: "Anna" }, fake([200]))).ok).toBe(true);
    expect(calls[0]).toMatchObject({ url: "https://api.resend.com/contacts", method: "POST", body: { email: "pdl@haus.de", first_name: "Anna", unsubscribed: true } });
    calls.length = 0;
    await addLeadToList({ email: "pdl@haus.de", firstName: "Anna" }, fake([409, 200]));
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].body).toEqual({ first_name: "Anna" }); // subscription untouched
  });
  it("confirm subscribes, unsubscribe unsubscribes, a missing contact is created in the right state", async () => {
    const { setListSubscribed } = await import("../lib/roadmap/resendList");
    calls.length = 0;
    await setListSubscribed("pdl@haus.de", true, fake([200]));
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "https://api.resend.com/contacts/pdl%40haus.de", body: { unsubscribed: false } });
    calls.length = 0;
    await setListSubscribed("pdl@haus.de", false, fake([404, 200]));
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
    expect(calls[1].body).toEqual({ email: "pdl@haus.de", unsubscribed: true });
  });
  it("does nothing without a key and never throws", async () => {
    delete process.env.RESEND_API_KEY;
    const { addLeadToList } = await import("../lib/roadmap/resendList");
    expect((await addLeadToList({ email: "x@haus.de" }, fake([500]))).ok).toBe(false);
  });
});

describe("list sync + 12-month retention", () => {
  it("subscribes only after ticked tips + confirm, and never after an unsubscribe", async () => {
    const { wantedListState, needsListSync } = await import("../lib/roadmap/leadState");
    expect(wantedListState({})).toBe("unsubscribed");
    expect(wantedListState({ consent: { tipsAsked: true, confirmedAt: null } })).toBe("unsubscribed");
    expect(wantedListState({ consent: { tipsAsked: true, confirmedAt: "2026-10-01T00:00:00Z" } })).toBe("subscribed");
    expect(wantedListState({ consent: { tipsAsked: true, confirmedAt: "2026-10-01T00:00:00Z" }, unsubscribedAt: "2026-10-05T00:00:00Z" })).toBe("unsubscribed");
    expect(needsListSync({})).toBe(true);
    expect(needsListSync({ list: { state: "unsubscribed" } })).toBe(false);
    expect(needsListSync({ list: { state: "unsubscribed" }, consent: { tipsAsked: true, confirmedAt: "2026-10-01T00:00:00Z" } })).toBe(true);
    expect(needsListSync({ anonymizedAt: "2027-11-01T00:00:00Z" })).toBe(false);
  });
  it("anonymizes only after 12 months without ANY activity, and keeps just the numbers", async () => {
    const { isExpired, anonymizedDetails } = await import("../lib/roadmap/leadState");
    const created = "2026-10-26T10:00:00Z";
    const d = { source: "roadmap", lang: "de", firstName: "Anna", facility: "Haus", answers: { staff: 40 }, result: { level: 2 }, consent: { tipsAsked: true, confirmedAt: "2026-10-27T10:00:00Z" }, seq: { step: 4, lastSentAt: "2026-11-10T10:00:00Z" } };
    expect(isExpired(d, created, new Date("2027-10-01T00:00:00Z"))).toBe(false);
    expect(isExpired(d, created, new Date("2027-11-09T00:00:00Z"))).toBe(false); // last mail 2026-11-10
    expect(isExpired(d, created, new Date("2027-11-12T00:00:00Z"))).toBe(true);
    expect(isExpired({ ...d, anonymizedAt: "2027-11-12T00:00:00Z" }, created, new Date("2028-01-01T00:00:00Z"))).toBe(false);
    const a = anonymizedDetails(d, new Date("2027-11-12T00:00:00Z"));
    expect(a).toEqual({ source: "roadmap", lang: "de", answers: { staff: 40 }, result: { level: 2 }, anonymizedAt: "2027-11-12T00:00:00.000Z" });
    expect(JSON.stringify(a)).not.toMatch(/Anna|Haus/);
  });
});
