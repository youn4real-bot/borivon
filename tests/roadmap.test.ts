import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { scoreRoadmap, normalizeAnswers, COST_PER_OPEN_POST_MONTH, COST_PER_DEPARTURE, type RoadmapAnswers } from "../lib/roadmap/score";
import { dueFollowup } from "../lib/roadmap/leadState";
import { signLeadToken, verifyLeadToken } from "../lib/roadmap/token";
import { renderRoadmapPdf, formatEuro } from "../lib/roadmap/pdf";
import { deliveryMail, followupMail, confirmMail, FOLLOWUP_DAYS, BOOK_URL } from "../lib/roadmap/emails";
import { LEVELS, CLIMB, UI, LANGS } from "../lib/roadmap/content";
import { STAGES, AREAS, STAGE_UI } from "../lib/roadmap/stages";

const healthy: RoadmapAnswers = { facilityType: "hospital", staff: 200, openPosts: 1, leftLastYear: 4, agency: "none", foreign: "most_stayed", onboarding: ["mentor", "german", "housing", "plan", "checkins"], pain: "open_posts" };
const struggling: RoadmapAnswers = { facilityType: "care_home", staff: 30, openPosts: 9, leftLastYear: 12, agency: "very_high", foreign: "tried_left", onboarding: [], pain: "leaving" };

describe("Pflege-Fahrplan scoring", () => {
  it("puts a healthy house on level 5 and a struggling one on level 1", () => {
    expect(scoreRoadmap(healthy).level).toBe(5);
    expect(scoreRoadmap(struggling).level).toBe(1);
  });

  it("keeps the generic calculator model for borivon.com", () => {
    expect(COST_PER_OPEN_POST_MONTH).toBe(18_400);
    expect(COST_PER_DEPARTURE).toBe(39_800);
  });

  it("counts money per kind of Einrichtung (beds / places / patients)", async () => {
    const { costPerOpenPost, costPerDeparture } = await import("../lib/roadmap/score");
    expect(costPerOpenPost("hospital")).toBe(20_000);
    expect(costPerOpenPost("care_home")).toBe(13_600);
    expect(costPerOpenPost("home_care")).toBe(9_600);
    expect(costPerDeparture("hospital")).toBe(73_400);
    expect(costPerDeparture("care_home")).toBe(54_200);
    expect(costPerDeparture("home_care")).toBe(42_200);
    const r = scoreRoadmap(struggling); // care_home
    expect(r.facilityType).toBe("care_home");
    expect(r.openCostMonth).toBe(9 * 13_600);
    expect(r.openCostYear).toBe(9 * 13_600 * 12);
    expect(r.turnoverCostYear).toBe(12 * 54_200);
    expect(r.totalYear).toBe(r.openCostYear + r.turnoverCostYear);
    expect(r.perNurseMonth).toBe(13_600);
  });

  it("only knows Krankenhaus/Klinik, Altenheim and ambulanter Pflegedienst", () => {
    expect(normalizeAnswers({ facilityType: "rehab" as never }).facilityType).toBe("hospital");
    expect(normalizeAnswers({ facilityType: "other" as never }).facilityType).toBe("care_home");
    expect(normalizeAnswers({ facilityType: "home_care" }).facilityType).toBe("home_care");
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
  const sentAt = "2026-10-01T09:01:00.000Z";
  const at = (days: number) => new Date(Date.parse(confirmed) + days * 86_400_000 + 3_600_000);
  it("sends nothing without the confirm click AND the PDF out", () => {
    expect(dueFollowup({ consent: { confirmedAt: null }, delivery: { sentAt } }, at(30))).toBeNull();
    expect(dueFollowup({ consent: { confirmedAt: confirmed }, delivery: { sentAt: null } }, at(30))).toBeNull();
    expect(dueFollowup({ consent: { confirmedAt: confirmed }, delivery: { sentAt } }, at(30))).toBe(0);
  });
  it("follows FOLLOWUP_DAYS and stops after the last one", () => {
    const base = { consent: { confirmedAt: confirmed }, delivery: { sentAt } };
    expect(dueFollowup({ ...base, seq: { step: 0 } }, at(FOLLOWUP_DAYS[0] - 1))).toBeNull();
    expect(dueFollowup({ ...base, seq: { step: 0 } }, at(FOLLOWUP_DAYS[0]))).toBe(0);
    expect(dueFollowup({ ...base, seq: { step: 2 } }, at(FOLLOWUP_DAYS[2]))).toBe(2);
    expect(dueFollowup({ ...base, seq: { step: FOLLOWUP_DAYS.length } }, at(60))).toBeNull();
  });
  it("never after an unsubscribe, never two within a day", () => {
    const base = { consent: { confirmedAt: confirmed }, delivery: { sentAt } };
    expect(dueFollowup({ ...base, unsubscribedAt: confirmed }, at(30))).toBeNull();
    const now = at(20);
    expect(dueFollowup({ ...base, seq: { step: 1, lastSentAt: new Date(now.getTime() - 3_600_000).toISOString() } }, now)).toBeNull();
  });
});

describe("the PDF goes out only after the confirm click", () => {
  it("is due once confirmed, retried at most 3 times, never twice within 30 minutes", async () => {
    const { deliveryDue, MAX_DELIVERY_ATTEMPTS } = await import("../lib/roadmap/leadState");
    const now = new Date("2026-11-07T10:00:00Z");
    const c = { consent: { confirmedAt: "2026-11-07T09:00:00Z" } };
    expect(deliveryDue({}, now)).toBe(false);
    expect(deliveryDue({ consent: { confirmedAt: null } }, now)).toBe(false);
    expect(deliveryDue(c, now)).toBe(true);
    expect(deliveryDue({ ...c, delivery: { sentAt: "2026-11-07T09:01:00Z" } }, now)).toBe(false);
    expect(deliveryDue({ ...c, delivery: { attempts: 1, lastAttemptAt: "2026-11-07T09:50:00Z" } }, now)).toBe(false);
    expect(deliveryDue({ ...c, delivery: { attempts: 1, lastAttemptAt: "2026-11-07T09:00:00Z" } }, now)).toBe(true);
    expect(deliveryDue({ ...c, delivery: { attempts: MAX_DELIVERY_ATTEMPTS } }, now)).toBe(false);
    expect(deliveryDue({ ...c, unsubscribedAt: "2026-11-07T09:30:00Z" }, now)).toBe(false);
  });
});

describe("consent box + Anrede", () => {
  it("the page shows exactly the stored consent text, in every language", async () => {
    const { readFileSync } = await import("fs");
    const { CONSENT_TEXT } = await import("../lib/roadmap/consent");
    const page = readFileSync("content/pflege/fahrplan.html", "utf8");
    const shown = [...page.matchAll(/consent: "([^"]+)", privacyLink: "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(shown).toEqual([CONSENT_TEXT.de, CONSENT_TEXT.en, CONSENT_TEXT.fr]);
    expect(CONSENT_TEXT.de).toBe("Ich möchte meinen Fahrplan sowie Tipps und Angebote von Borivon per E-Mail erhalten. Abmeldung jederzeit möglich. Datenschutzerklärung");
  });
  it("the box is never pre-ticked and links to /datenschutz", async () => {
    const { readFileSync } = await import("fs");
    const page = readFileSync("content/pflege/fahrplan.html", "utf8");
    expect(page).toMatch(/consent: false/);
    expect(page).not.toContain("/privacy-policy");
    expect(page).toContain('href="/datenschutz"');
    expect(page).toContain("Ihre Angaben nutzen wir nur, um Ihren Fahrplan zu erstellen. Kein Verkauf, keine Weitergabe an Dritte. Verantwortlich: Borivon LLC.");
    for (const gone of ["fPhone", "fCity", "fFirst", "fTips"]) expect(page).not.toContain(gone);
  });
  it("addresses people by Anrede + Nachname", async () => {
    const { greeting, addressName, leadName, asSalutation } = await import("../lib/roadmap/consent");
    expect(greeting("de", "frau", "Müller")).toBe("Hallo Frau Müller,");
    expect(greeting("de", "herr", "Kaya")).toBe("Hallo Herr Kaya,");
    expect(greeting("de", "none", "Kaya")).toBe("Hallo,");
    expect(greeting("en", "frau", "Smith")).toBe("Hello Ms Smith,");
    expect(greeting("fr", "herr", "Martin")).toBe("Bonjour Monsieur Martin,");
    expect(addressName("de", "none", "X")).toBe("");
    expect(leadName("none", "Kaya")).toBe("Kaya");
    expect(leadName("frau", "Müller")).toBe("Frau Müller");
    expect(asSalutation("hack")).toBe("none");
  });
  it("German browsers go to /datenschutz", async () => {
    const { prefersGerman } = await import("../lib/prefersGerman");
    expect(prefersGerman("de-DE,de;q=0.9,en;q=0.8")).toBe(true);
    expect(prefersGerman("de")).toBe(true);
    expect(prefersGerman("en-US,de;q=0.9")).toBe(false);
    expect(prefersGerman(null)).toBe(false);
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
  it("confirm mail: only the confirm link, no offer", () => {
    for (const l of LANGS) {
      const m = confirmMail({ lang: l, salutation: "frau", lastName: "Müller", facility: "Haus", confirmUrl: "https://x/c" });
      expect(m.html).toContain("https://x/c");
      expect(m.text).toContain("https://x/c");
      expect(m.html).not.toContain(BOOK_URL);
      expect(m.text).not.toMatch(/<[a-z]/);
    }
    expect(confirmMail({ lang: "de", salutation: "frau", lastName: "Müller", facility: "Haus", confirmUrl: "u" }).html).toContain("Hallo Frau Müller,");
  });
  it("delivery mail: level in subject, fit P.S., unsubscribe link, Anrede", () => {
    const r = scoreRoadmap(struggling);
    for (const l of LANGS) {
      const m = deliveryMail({ lang: l, salutation: "herr", lastName: "Kaya", facility: "Haus", result: r, unsubscribeUrl: "https://x/u" });
      expect(m.html).toContain("https://x/u");
      expect(m.text).toContain("https://x/u");
      expect(m.text).not.toMatch(/<[a-z]/);
    }
    const m = deliveryMail({ lang: "de", salutation: "herr", lastName: "Kaya", facility: "Haus", result: r, unsubscribeUrl: "https://x/u" });
    expect(m.subject).toContain("Stufe 1");
    expect(m.html).toContain("Prüfen Sie hier, ob Ihre Einrichtung passt");
    expect(m.html).toContain("Hallo Herr Kaya,");
    expect(m.html).not.toContain("Tipps senden");
  });
  it("has exactly one follow-up per scheduled day, each with an unsubscribe link", () => {
    const r = scoreRoadmap(struggling);
    for (const l of LANGS) {
      for (let n = 0; n < FOLLOWUP_DAYS.length; n++) {
        const m = followupMail(n, { lang: l, salutation: "frau", lastName: "A", result: r, unsubscribeUrl: "https://x/u" });
        expect(m?.html).toContain("https://x/u");
        expect(m?.text).toContain("https://x/u");
      }
      expect(followupMail(FOLLOWUP_DAYS.length, { lang: l, salutation: "none", lastName: "", result: r, unsubscribeUrl: "u" })).toBeNull();
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
    it(`renders 11 A4 pages in ${lang}`, async () => {
      const bytes = await renderRoadmapPdf({ result: scoreRoadmap(struggling), lang, name: "Frau Müller", facility: "Seniorenzentrum Am Park", date: new Date("2026-10-21") });
      expect(bytes.length).toBeGreaterThan(20_000);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(11);
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
      source: "roadmap", lang: "de", facility: "Haus", salutation: "frau", lastName: "Müller", heardFrom: "linkedin",
      answers: { facilityType: "care_home", staff: 60, openPosts: 6, leftLastYear: 9, agency: "high", foreign: "never", onboarding: ["mentor", "german"], pain: "agency" },
      result: { level: 2, score: 41, bottleneck: "agency", totalYear: 1683000 },
      consent: { text: "x", givenAt: "2026-10-22T09:59:00Z", ip: "1.2.3.4", confirmedAt: "2026-10-22T10:00:00Z" },
      delivery: { sentAt: "2026-10-22T10:00:09Z", attempts: 1 }, seq: { step: 1 }, unsubscribedAt: null,
    };
    const chips = roadmapLeadChips(details, "de");
    for (const c of chips) { expect(typeof c.k).toBe("string"); expect(typeof c.v).toBe("string"); }
    const v = Object.fromEntries(chips.map((c) => [c.k, c.v]));
    expect(v.Stufe).toBe("2 · Lückenfüller");
    expect(v["Verlust/Jahr"]).toBe("1.683.000 €");
    expect(v.Personal).toBe("60 · 6 offen · 9 gegangen");
    expect(v.Status).toBe("bestätigt · PDF gesendet · 1/4 Mails");
    expect(Object.fromEntries(roadmapLeadChips({ consent: { confirmedAt: null } }, "de").map((c) => [c.k, c.v])).Status).toBe("nicht bestätigt");
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
  it("confirm creates the contact SUBSCRIBED (with the last name), unsubscribe flips it", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const { setListSubscribed } = await import("../lib/roadmap/resendList");
    calls.length = 0;
    await setListSubscribed("pdl@haus.de", true, fake([404, 200]), { lastName: "Müller" });
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
    expect(calls[1]).toMatchObject({ url: "https://api.resend.com/contacts", body: { email: "pdl@haus.de", last_name: "Müller", unsubscribed: false } });
    calls.length = 0;
    await setListSubscribed("pdl@haus.de", true, fake([200]));
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "https://api.resend.com/contacts/pdl%40haus.de", body: { unsubscribed: false } });
    calls.length = 0;
    await setListSubscribed("pdl@haus.de", false, fake([200]));
    expect(calls[0].body).toEqual({ unsubscribed: true });
  });
  it("does nothing without a key and never throws", async () => {
    delete process.env.RESEND_API_KEY;
    const { setListSubscribed } = await import("../lib/roadmap/resendList");
    expect((await setListSubscribed("x@haus.de", true, fake([500]))).ok).toBe(false);
  });
});

describe("list sync + retention", () => {
  it("nobody is on the list before the confirm click; after it, subscribed until they unsubscribe", async () => {
    const { wantedListState, needsListSync } = await import("../lib/roadmap/leadState");
    const c = { confirmedAt: "2026-10-01T00:00:00Z" };
    expect(wantedListState({})).toBeNull();
    expect(wantedListState({ consent: { confirmedAt: null } })).toBeNull();
    expect(wantedListState({ consent: c })).toBe("subscribed");
    expect(wantedListState({ consent: c, unsubscribedAt: "2026-10-05T00:00:00Z" })).toBe("unsubscribed");
    expect(needsListSync({})).toBe(false);
    expect(needsListSync({ consent: c })).toBe(true);
    expect(needsListSync({ consent: c, list: { state: "subscribed" } })).toBe(false);
    expect(needsListSync({ consent: c, list: { state: "subscribed" }, unsubscribedAt: "2026-10-05T00:00:00Z" })).toBe(true);
    expect(needsListSync({ consent: c, anonymizedAt: "2027-11-01T00:00:00Z" })).toBe(false);
  });
  it("wipes a never-confirmed request after 30 days", async () => {
    const { isExpired } = await import("../lib/roadmap/leadState");
    const created = "2026-11-07T10:00:00Z";
    const d = { lastName: "Müller", consent: { givenAt: created, ip: "1.2.3.4", confirmedAt: null } };
    expect(isExpired(d, created, new Date("2026-12-06T00:00:00Z"))).toBe(false);
    expect(isExpired(d, created, new Date("2026-12-08T00:00:00Z"))).toBe(true);
  });
  it("anonymizes only after 12 months without ANY activity, and keeps just the numbers", async () => {
    const { isExpired, anonymizedDetails } = await import("../lib/roadmap/leadState");
    const created = "2026-10-26T10:00:00Z";
    const d = { source: "roadmap", lang: "de", salutation: "frau", lastName: "Anna", facility: "Haus", answers: { staff: 40 }, result: { level: 2 }, consent: { text: "x", ip: "9.9.9.9", confirmedAt: "2026-10-27T10:00:00Z" }, delivery: { sentAt: "2026-10-27T10:00:05Z" }, seq: { step: 4, lastSentAt: "2026-11-10T10:00:00Z" } };
    expect(isExpired(d, created, new Date("2027-10-01T00:00:00Z"))).toBe(false);
    expect(isExpired(d, created, new Date("2027-11-09T00:00:00Z"))).toBe(false); // last mail 2026-11-10
    expect(isExpired(d, created, new Date("2027-11-12T00:00:00Z"))).toBe(true);
    expect(isExpired({ ...d, anonymizedAt: "2027-11-12T00:00:00Z" }, created, new Date("2028-01-01T00:00:00Z"))).toBe(false);
    const a = anonymizedDetails(d, new Date("2027-11-12T00:00:00Z"));
    expect(a).toEqual({ source: "roadmap", lang: "de", answers: { staff: 40 }, result: { level: 2 }, anonymizedAt: "2027-11-12T00:00:00.000Z" });
    expect(JSON.stringify(a)).not.toMatch(/Anna|Haus|9\.9\.9\.9/);
  });
});

describe("per type + bonus", () => {
  it("has a full set of type texts in every language", async () => {
    const { FACILITY } = await import("../lib/roadmap/types");
    for (const t of ["hospital", "care_home", "home_care"] as const) {
      const F = FACILITY[t];
      for (const l of LANGS) {
        for (const k of ["name", "forTitle", "openModel", "source", "firstWeek"] as const) expect(F[k][l]).toBeTruthy();
        expect(F.tips.length).toBe(5);
        for (const tip of F.tips) { expect(tip.t[l]).toBeTruthy(); expect(tip.d[l]).toBeTruthy(); }
      }
    }
  });
  it("the 'So rechnen wir' line matches the numbers", async () => {
    const { FACILITY } = await import("../lib/roadmap/types");
    expect(FACILITY.hospital.openModel.de).toContain("20.000 €");
    expect(FACILITY.care_home.openModel.de).toContain("13.600 €");
    expect(FACILITY.home_care.openModel.de).toContain("9.600 €");
  });
  it("renders the 2-page agency check in every language", async () => {
    const { renderAgencyCheckPdf, AGENCY_CHECK } = await import("../lib/roadmap/bonusPdf");
    expect(AGENCY_CHECK.length).toBe(10);
    for (const l of LANGS) {
      const doc = await PDFDocument.load(await renderAgencyCheckPdf(l));
      expect(doc.getPageCount()).toBe(2);
    }
  }, 30_000);
  it("follow-up #2 speaks to the kind of Einrichtung", () => {
    const r = scoreRoadmap(struggling);
    const m = followupMail(1, { lang: "de", salutation: "frau", lastName: "A", result: r, unsubscribeUrl: "u", facilityType: "home_care" });
    expect(m?.html).toContain("Touren");
    const d = deliveryMail({ lang: "de", salutation: "frau", lastName: "A", facility: "Haus", result: r, unsubscribeUrl: "u" });
    expect(d.html).toContain("Agentur-Check");
    expect(d.text).not.toMatch(/<[a-z]/);
  });
});

describe("calculator (PDF page 4 button)", () => {
  it("the page uses the same money model and minimum salary as the server", async () => {
    const { readFileSync } = await import("fs");
    const { COST_MODEL, AGENCY_RATE, ONBOARDING_HOURS, ONBOARDING_RATE, REPLACEMENT_COST } = await import("../lib/roadmap/score");
    const { MIN_SALARY_MONTH } = await import("../lib/roadmap/calc");
    const page = readFileSync("content/pflege/rechner.html", "utf8");
    for (const [k, m] of Object.entries(COST_MODEL)) {
      expect(page).toContain(`${k}: { agency: ${m.agencyHours * AGENCY_RATE}, units: ${m.lossUnits}, perUnit: ${m.lossPerUnit} }`);
    }
    expect(page).toContain("var MIN_RATE = 21.03;");
    expect(page).toContain("var EMPLOYER_SHARE = 21;");
    expect(Math.round(21.03 * 40 * 52 / 12 * 1.21)).toBe(MIN_SALARY_MONTH);
    expect(page).toContain(`var DEP_FIXED = ${ONBOARDING_HOURS} * ${ONBOARDING_RATE} + ${REPLACEMENT_COST};`);
  });
  it("the personal link carries the answers and a signed token", async () => {
    process.env.DL_TOKEN_SECRET = "test-secret-0123456789abcdef";
    const { calcUrl } = await import("../lib/roadmap/calc");
    const u = new URL(await calcUrl({ lang: "de", facilityType: "care_home", openPosts: 4, leftLastYear: 6, leadId: "lead-1" }));
    expect(u.pathname).toBe("/fahrplan/rechner");
    expect(u.searchParams.get("o")).toBe("4");
    expect(await verifyLeadToken("calc", "lead-1", u.searchParams.get("t")!)).toBe(true);
    expect(new URL(await calcUrl({ lang: "en", facilityType: "care_home", openPosts: 1, leftLastYear: 0 })).searchParams.get("t")).toBeNull();
  });
  it("saves only known, clamped numbers", async () => {
    const { cleanCalc } = await import("../lib/roadmap/calc");
    expect(cleanCalc({ salary: 5000, units: 99, open: -3, evil: "<script>", perUnit: "4600" })).toEqual({ salary: 5000, units: 20, open: 0 });
    expect(cleanCalc(null)).toEqual({});
  });
  it("the admin sees what they set", async () => {
    const { roadmapLeadChips } = await import("../lib/roadmap/leadSummary");
    const v = Object.fromEntries(roadmapLeadChips({ calc: { salary: 5200, agency: 4400, units: 2, perUnit: 4800, growth: 3 } }, "de").map((c) => [c.k, c.v]));
    expect(v.Rechner).toBe("Gehalt 5.200 € · Leihkräfte 4.400 € · 2 Plätze/Stelle · 4.800 € pro Platz · +3 Wachstum");
  });
});
