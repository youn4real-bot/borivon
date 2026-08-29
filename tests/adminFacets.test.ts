import { describe, it, expect } from "vitest";
import { buildFacets, sanitizeSelection } from "@/lib/adminFacets";
import type { SearchableCandidate } from "@/lib/candidateSearch";

const NOW = Date.parse("2026-08-28T12:00:00Z");
const D = 86_400_000;

function mk(p: Partial<SearchableCandidate> & { uid: string; name: string }): SearchableCandidate {
  return {
    email: `${p.uid}@x.com`, phone: null, photo: null, createdAtMs: null, lastSignInMs: null,
    b2Stage: "studying", b2Failed: false, nationality: null, cityOfBirth: null, cityOfResidence: null,
    sex: null, maritalStatus: null, specialty: null, yearsExperience: null, workplacePref: null,
    placementReady: false, verified: false, passportStatus: null, passportExpiryMs: null,
    availableFromMs: null, hasEmployer: false, orgNames: [], b2Complete: null, b2CertDateMs: null,
    b2ExamMs: null, germanLevel: null, b2Result: null, b2ExamType: null, b2CertStatus: null, b2Planned: false, b2PlannedMs: null,
    funnelStage: null, batchId: null, batchName: null, interview1Ms: null, interview2Ms: null, interview1Status: null,
    interview2Status: null, visaApptMs: null, flightMs: null, lastTouchMs: null,
    pendingDocCount: 0, hasApprovedB2Cert: false, docTotal: 0, rejectedDocs: 0, missingRequired: 0, checklistPct: 0, ...p,
  };
}
const optCount = (r: ReturnType<typeof buildFacets>, gk: string, ok: string) =>
  r.groups.find((g) => g.key === gk)?.options.find((o) => o.key === ok)?.count;
const optLabel = (r: ReturnType<typeof buildFacets>, gk: string, ok: string) =>
  r.groups.find((g) => g.key === gk)?.options.find((o) => o.key === ok)?.label;
const uids = (r: ReturnType<typeof buildFacets>) => r.results.map((h) => h.uid).sort();

// The real B2 truth lives in the cv_draft German panel → b2Result/b2CertStatus/etc.
const POOL: SearchableCandidate[] = [
  mk({ uid: "full", name: "Full", b2Result: "full", b2CertStatus: "got", germanLevel: "B2", b2ExamType: "telc", specialty: "intensive", nationality: "marokkanisch" }),
  mk({ uid: "partial", name: "Partial", b2Result: "partial", germanLevel: "B2", b2ExamType: "telc", specialty: "intensive", nationality: "Marokko" }),
  mk({ uid: "await", name: "Awaiting", b2Result: "waiting", germanLevel: "B2", specialty: "geriatric", nationality: "Maroc" }),
  mk({ uid: "sched", name: "Scheduled", b2Planned: true, b2PlannedMs: NOW + 20 * D, germanLevel: "B1", specialty: "geriatric", nationality: "Tunisian" }),
  mk({ uid: "failed", name: "Failed", b2Result: "failed", germanLevel: "B2" }),
];

describe("buildFacets — B2 from the real cv_draft source (as detailed as it gets)", () => {
  it("counts each granular B2 state", () => {
    const r = buildFacets(POOL, {}, NOW, "en");
    expect(optCount(r, "b2", "full_cert")).toBe(1);   // result=full
    expect(optCount(r, "b2", "cert_got")).toBe(1);    // certificate in hand
    expect(optCount(r, "b2", "partial")).toBe(1);
    expect(optCount(r, "b2", "awaiting")).toBe(1);
    expect(optCount(r, "b2", "failed")).toBe(1);
    expect(optCount(r, "b2", "scheduled")).toBe(1);
    expect(optCount(r, "b2", "exam_soon")).toBe(1);   // planned within ~6 weeks
    expect(optCount(r, "b2", "level_b2")).toBe(4);
    expect(optCount(r, "b2", "level_b1")).toBe(1);
    expect(optCount(r, "b2", "telc")).toBe(2);
  });

  it("selecting 'has full certificate' returns only the certified candidate", () => {
    expect(uids(buildFacets(POOL, { b2: ["full_cert"] }, NOW, "en"))).toEqual(["full"]);
  });

  it("multi-select within a group is OR", () => {
    expect(uids(buildFacets(POOL, { b2: ["full_cert", "awaiting"] }, NOW, "en"))).toEqual(["await", "full"].sort());
  });

  it("across groups is AND", () => {
    expect(uids(buildFacets(POOL, { b2: ["awaiting"], specialty: ["geriatric"] }, NOW, "en"))).toEqual(["await"]);
  });
});

describe("buildFacets — Booking.com count semantics", () => {
  it("counts respect OTHER groups but not the option's own group", () => {
    const r = buildFacets(POOL, { specialty: ["intensive"], b2: ["full_cert"] }, NOW, "en");
    expect(optCount(r, "b2", "full_cert")).toBe(1); // full is intensive
    expect(optCount(r, "b2", "partial")).toBe(1);   // partial is intensive
    expect(optCount(r, "b2", "awaiting")).toBeUndefined(); // await is geriatric → 0 → hidden
    expect(uids(r)).toEqual(["full"]);              // results still honour the AND
  });

  it("hides zero-count options but keeps a selected one visible", () => {
    const r = buildFacets(POOL, { b2: ["awaiting"], specialty: ["intensive"] }, NOW, "en");
    const await0 = r.groups.find((g) => g.key === "b2")?.options.find((o) => o.key === "awaiting");
    expect(await0?.selected).toBe(true);
    expect(await0?.count).toBe(0);
    expect(uids(r)).toEqual([]); // no intensive candidate is awaiting
  });
});

describe("buildFacets — nationality merges to one localized country", () => {
  it("merges marokkanisch/Marokko/Maroc into a single Morocco option", () => {
    const r = buildFacets(POOL, {}, NOW, "en");
    expect(optCount(r, "nationality", "MA")).toBe(3);
    expect(optLabel(r, "nationality", "MA")).toBe("Morocco");
    expect(optLabel(buildFacets(POOL, {}, NOW, "fr"), "nationality", "MA")).toBe("Maroc");
    expect(optLabel(buildFacets(POOL, {}, NOW, "de"), "nationality", "MA")).toBe("Marokko");
  });

  it("selecting the merged country returns every spelling", () => {
    expect(uids(buildFacets(POOL, { nationality: ["MA"] }, NOW, "en"))).toEqual(["await", "full", "partial"].sort());
  });

  it("only ever returns candidates from the input set", () => {
    const ids = new Set(POOL.map((c) => c.uid));
    for (const h of buildFacets(POOL, { b2: ["level_b2"] }, NOW, "en").results) expect(ids.has(h.uid)).toBe(true);
  });
});

describe("sanitizeSelection", () => {
  it("keeps string arrays and drops garbage", () => {
    expect(sanitizeSelection({ b2: ["full_cert", "partial"], bad: "x", huge: [123] }))
      .toEqual({ b2: ["full_cert", "partial"] });
    expect(sanitizeSelection(null)).toEqual({});
    expect(sanitizeSelection("nope")).toEqual({});
  });
});
