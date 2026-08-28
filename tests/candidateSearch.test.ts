import { describe, it, expect } from "vitest";
import {
  sanitizeQuery,
  isEmptyQuery,
  keywordParseQuery,
  compileCandidateQuery,
  describeQuery,
  norm,
  extractFilterJson,
  type SearchableCandidate,
  type CandidateQuery,
} from "@/lib/candidateSearch";

// A fixed "now" so every date window is deterministic.
const NOW = Date.parse("2026-08-28T12:00:00Z");
const D = 86_400_000;
const iso = (s: string) => Date.parse(s);

function mk(partial: Partial<SearchableCandidate> & { uid: string; name: string }): SearchableCandidate {
  return {
    email: `${partial.uid}@example.com`,
    photo: null,
    createdAtMs: null,
    lastSignInMs: null,
    b2Stage: "studying",
    b2Failed: false,
    nationality: null,
    cityOfBirth: null,
    cityOfResidence: null,
    sex: null,
    maritalStatus: null,
    specialty: null,
    yearsExperience: null,
    workplacePref: null,
    placementReady: false,
    verified: false,
    passportStatus: null,
    passportExpiryMs: null,
    availableFromMs: null,
    hasEmployer: false,
    orgNames: [],
    b2Complete: null,
    b2CertDateMs: null,
    b2ExamMs: null,
    funnelStage: null,
    interview1Ms: null,
    interview2Ms: null,
    interview1Status: null,
    interview2Status: null,
    visaApptMs: null,
    flightMs: null,
    lastTouchMs: null,
    pendingDocCount: 0,
    hasApprovedB2Cert: false,
    docTotal: 0,
    rejectedDocs: 0,
    missingRequired: 0,
    checklistPct: 0,
    ...partial,
  };
}

const uids = (r: { hits: { uid: string }[] }) => r.hits.map((h) => h.uid).sort();

describe("sanitizeQuery", () => {
  it("coerces string numbers and clamps windows", () => {
    const q = sanitizeQuery({ b2CertifiedWithinDays: "365", minYearsExperience: "3", limit: "9999" });
    expect(q.b2CertifiedWithinDays).toBe(365);
    expect(q.minYearsExperience).toBe(3);
    expect(q.limit).toBe(200); // clamped to SEARCH_LIMIT_MAX
  });

  it("drops unknown keys and invalid enums", () => {
    const q = sanitizeQuery({ hackerField: "DROP TABLE", b2Stage: "not_a_stage", specialty: "intensive" });
    expect((q as Record<string, unknown>).hackerField).toBeUndefined();
    expect(q.b2Stage).toBeUndefined(); // invalid stage rejected
    expect(q.specialty).toBe("intensive");
  });

  it("normalizes sex to a single m/f char", () => {
    expect(sanitizeQuery({ sex: "Female" }).sex).toBe("f");
    expect(sanitizeQuery({ sex: "M" }).sex).toBe("m");
    expect(sanitizeQuery({ sex: "other" }).sex).toBeUndefined();
  });

  it("coerces booleans and ignores garbage", () => {
    expect(sanitizeQuery({ b2Certified: "true" }).b2Certified).toBe(true);
    expect(sanitizeQuery({ verified: false }).verified).toBe(false);
    expect(sanitizeQuery({ placementReady: "maybe" }).placementReady).toBeUndefined();
  });
});

describe("isEmptyQuery", () => {
  it("treats sortBy/limit-only as empty", () => {
    expect(isEmptyQuery({})).toBe(true);
    expect(isEmptyQuery({ sortBy: "name", limit: 10 })).toBe(true);
    expect(isEmptyQuery({ text: "x" })).toBe(false);
    expect(isEmptyQuery({ b2Certified: true })).toBe(false);
  });
});

describe("keywordParseQuery — the graceful-degradation fallback", () => {
  it("B2 certificate in the last year (EN)", () => {
    const q = keywordParseQuery("candidates who got the B2 certificate in the last year");
    expect(q.b2Certified).toBe(true);
    expect(q.b2CertifiedWithinDays).toBe(365);
  });

  it("interview next week (EN)", () => {
    const q = keywordParseQuery("who has an interview scheduled next week");
    expect(q.interviewWithinDays).toBe(7);
  });

  it("interview next week (DE)", () => {
    const q = keywordParseQuery("wer hat nächste woche ein Gespräch");
    expect(q.interviewWithinDays).toBe(7);
  });

  it("B2 certificate this year (FR)", () => {
    const q = keywordParseQuery("candidats avec le certificat B2 cette année");
    expect(q.b2Certified).toBe(true);
    expect(q.b2CertifiedWithinDays).toBe(365);
  });

  it("experience + nationality + specialty", () => {
    const q = keywordParseQuery("moroccan ICU nurses with 3 years experience");
    expect(q.nationality).toBe("maroc");
    expect(q.specialty).toBe("intensive");
    expect(q.minYearsExperience).toBe(3);
  });

  it("passport review", () => {
    expect(keywordParseQuery("everyone stuck at passport review").passportPending).toBe(true);
  });

  it("falls back to free text for a bare name", () => {
    const q = keywordParseQuery("Hajar");
    expect(q.text).toBe("Hajar");
  });

  it("returns empty for empty input", () => {
    expect(isEmptyQuery(keywordParseQuery(""))).toBe(true);
  });
});

describe("keywordParseQuery — review-hardening fixes", () => {
  it("recognizes the PARTICIPLE 'certified' (the example chips) in EN/FR/DE", () => {
    const en = keywordParseQuery("B2 certified this year");
    expect(en.b2Certified).toBe(true);
    expect(en.b2CertifiedWithinDays).toBe(365);
    expect(keywordParseQuery("certifié B2 cette année").b2Certified).toBe(true);
    expect(keywordParseQuery("dieses Jahr B2 zertifiziert").b2Certified).toBe(true);
  });

  it("does NOT turn a PAST interview phrase into a future window", () => {
    // "interviews last week" must not silently become "interviews in the next 7 days".
    const q = keywordParseQuery("interviews last week");
    expect(q.interviewWithinDays).toBeUndefined();
  });

  it("keeps the future window for 'interview next week'", () => {
    expect(keywordParseQuery("interview next week").interviewWithinDays).toBe(7);
  });

  it("no longer lets a stray 'have' force b2Certified", () => {
    const q = keywordParseQuery("which B2 candidates have an interview next week");
    expect(q.b2Certified).toBeUndefined();
    expect(q.interviewWithinDays).toBe(7);
  });

  it("distinguishes 'expired' (past) from 'expiring' (future)", () => {
    const expired = keywordParseQuery("expired passports");
    expect(expired.passportExpired).toBe(true);
    expect(expired.passportExpiringWithinDays).toBeUndefined();
    const soon = keywordParseQuery("passports expiring in 30 days");
    expect(soon.passportExpired).toBeUndefined();
    expect(soon.passportExpiringWithinDays).toBe(30);
  });
});

describe("compiler — review-hardening fixes", () => {
  it("passportExpired matches an already-lapsed passport", () => {
    const pool: SearchableCandidate[] = [
      mk({ uid: "lapsed", name: "A", passportExpiryMs: iso("2026-06-01") }),   // before NOW
      mk({ uid: "valid", name: "B", passportExpiryMs: iso("2028-01-01") }),
      mk({ uid: "none", name: "C", passportExpiryMs: null }),
    ];
    expect(uids(compileCandidateQuery({ passportExpired: true }, pool, NOW, "en"))).toEqual(["lapsed"]);
  });

  it("availableWithinDays includes the already-available (past available_from)", () => {
    const pool: SearchableCandidate[] = [
      mk({ uid: "nowavail", name: "A", availableFromMs: iso("2026-06-01") }), // available 3 months ago
      mk({ uid: "soon", name: "B", availableFromMs: NOW + 10 * D }),          // available in 10 days
      mk({ uid: "later", name: "C", availableFromMs: NOW + 90 * D }),         // 90 days out
    ];
    // "available within the next 30 days" must include the already-available person.
    expect(uids(compileCandidateQuery({ availableWithinDays: 30 }, pool, NOW, "en")).sort())
      .toEqual(["nowavail", "soon"].sort());
  });
});

describe("describeQuery / chips — localization fixes", () => {
  it("localizes workplacePref instead of the raw enum", () => {
    expect(describeQuery({ workplacePref: "klinik" }, "fr")).toContain("clinique");
    expect(describeQuery({ workplacePref: "either" }, "de")).toContain("egal");
  });
  it("localizes the passport status value", () => {
    expect(describeQuery({ passportStatus: "pending" }, "de").some((c) => c.includes("ausstehend"))).toBe(true);
  });
  it("renders a passport-expired chip", () => {
    expect(describeQuery({ passportExpired: true }, "fr").some((c) => /expiré/i.test(c))).toBe(true);
  });
});

describe("sanitizeQuery — passportExpired", () => {
  it("coerces the new boolean facet", () => {
    expect(sanitizeQuery({ passportExpired: "true" }).passportExpired).toBe(true);
    expect(sanitizeQuery({ passportExpired: false }).passportExpired).toBe(false);
  });
});

describe("compileCandidateQuery — deterministic matching", () => {
  const pool: SearchableCandidate[] = [
    mk({ uid: "certd", name: "Amina Certd", b2Complete: true, b2CertDateMs: iso("2026-03-01"), b2Stage: "passed", nationality: "Maroc", specialty: "intensive", yearsExperience: 5 }),
    mk({ uid: "oldcert", name: "Bilal Oldcert", b2Complete: true, b2CertDateMs: iso("2024-01-01"), b2Stage: "passed" }),
    mk({ uid: "certnodate", name: "Chaima Nodate", b2Complete: true, b2CertDateMs: null, b2Stage: "passed" }),
    mk({ uid: "studying", name: "Driss Studying", b2Stage: "studying", nationality: "Maroc", specialty: "geriatric", yearsExperience: 2 }),
    mk({ uid: "interviewsoon", name: "Ellen Soon", interview1Ms: iso("2026-09-02"), funnelStage: "interview1" }),
    mk({ uid: "interviewlate", name: "Farah Late", interview1Ms: iso("2026-10-20") }),
    mk({ uid: "passport", name: "Ghita Passport", passportStatus: "pending" }),
    mk({ uid: "inactive", name: "Hamza Inactive", lastSignInMs: iso("2026-06-01") }),
  ];
  const run = (q: CandidateQuery) => compileCandidateQuery(q, pool, NOW, "en");

  it("b2Certified matches certified only", () => {
    expect(uids(run({ b2Certified: true }))).toEqual(["certd", "certnodate", "oldcert"].sort());
  });

  it("b2CertifiedWithinDays needs a cert date inside the window", () => {
    const r = run({ b2Certified: true, b2CertifiedWithinDays: 365 });
    // certd (2026-03) in window; oldcert (2024) out; certnodate has no provable date
    expect(uids(r)).toEqual(["certd"]);
  });

  it("interviewWithinDays 7 catches the soon interview, not the late one", () => {
    expect(uids(run({ interviewWithinDays: 7 }))).toEqual(["interviewsoon"]);
  });

  it("minYearsExperience filters correctly", () => {
    expect(uids(run({ minYearsExperience: 3 }))).toEqual(["certd"]);
  });

  it("specialty exact key match", () => {
    expect(uids(run({ specialty: "geriatric" }))).toEqual(["studying"]);
  });

  it("nationality substring, accent-insensitive", () => {
    expect(uids(run({ nationality: "maroc" })).sort()).toEqual(["certd", "studying"].sort());
  });

  it("passportPending", () => {
    expect(uids(run({ passportPending: true }))).toEqual(["passport"]);
  });

  it("inactiveForDays flags the quiet + never-logged-in, excludes the recently-active", () => {
    // NOW - 30d = 2026-07-29. Quiet (last-seen 2026-06-01) and never-logged-in (null)
    // both qualify; someone who logged in yesterday must NOT.
    const active = mk({ uid: "active", name: "Ilyas Active", lastSignInMs: NOW - D });
    const r = compileCandidateQuery({ inactiveForDays: 30 }, [...pool, active], NOW, "en");
    const got = r.hits.map((h) => h.uid);
    expect(got).toContain("inactive");       // quiet since June
    expect(got).toContain("interviewsoon");  // null login = never logged in = inactive
    expect(got).not.toContain("active");     // logged in yesterday
  });

  it("free-text AND across terms", () => {
    expect(uids(run({ text: "amina intensive" }))).toEqual(["certd"]);
    expect(uids(run({ text: "amina geriatric" }))).toEqual([]);
  });

  it("empty query returns everyone", () => {
    const r = run({});
    expect(r.matched).toBe(pool.length);
    expect(r.hits.length).toBe(pool.length);
  });

  it("only ever returns candidates from the input set (grounding invariant)", () => {
    const inputUids = new Set(pool.map((c) => c.uid));
    for (const q of [{ b2Certified: true }, { interviewWithinDays: 7 }, { text: "x" }, {}] as CandidateQuery[]) {
      for (const h of run(q).hits) expect(inputUids.has(h.uid)).toBe(true);
    }
  });

  it("respects the limit", () => {
    expect(run({ limit: 2 }).hits.length).toBe(2);
    expect(run({}).matched).toBe(pool.length); // matched is the true count, not the page
  });

  it("produces a localized 'why' for matched filters", () => {
    const r = compileCandidateQuery({ interviewWithinDays: 7 }, pool, NOW, "de");
    expect(r.hits[0].why).toContain("2026-09-02");
  });
});

describe("describeQuery — the trust chips", () => {
  it("renders human chips for a compound query", () => {
    const chips = describeQuery({ b2Certified: true, b2CertifiedWithinDays: 365, specialty: "intensive" }, "en");
    expect(chips.some((c) => /B2 certified/i.test(c))).toBe(true);
    expect(chips.some((c) => /last year/i.test(c))).toBe(true);
  });
});

describe("norm", () => {
  it("strips accents and lowercases", () => {
    expect(norm("Gériatrie")).toBe("geriatrie");
    expect(norm("CASABLANCA")).toBe("casablanca");
  });
});

describe("extractFilterJson", () => {
  it("parses clean JSON", () => {
    expect(extractFilterJson('{"b2Certified":true}')).toEqual({ b2Certified: true });
  });
  it("parses fenced JSON", () => {
    expect(extractFilterJson('```json\n{"interviewWithinDays":7}\n```')).toEqual({ interviewWithinDays: 7 });
  });
  it("parses JSON embedded in prose", () => {
    expect(extractFilterJson('Here is the filter: {"text":"hajar"} — hope that helps'))
      .toEqual({ text: "hajar" });
  });
  it("returns null for arrays and garbage", () => {
    expect(extractFilterJson("[1,2,3]")).toBeNull();
    expect(extractFilterJson("no json here")).toBeNull();
    expect(extractFilterJson("")).toBeNull();
  });
});
