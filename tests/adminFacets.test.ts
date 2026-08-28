import { describe, it, expect } from "vitest";
import { buildFacets, sanitizeSelection } from "@/lib/adminFacets";
import type { SearchableCandidate } from "@/lib/candidateSearch";

const NOW = Date.parse("2026-08-28T12:00:00Z");
const D = 86_400_000;

function mk(p: Partial<SearchableCandidate> & { uid: string; name: string }): SearchableCandidate {
  return {
    email: `${p.uid}@x.com`, photo: null, createdAtMs: null, lastSignInMs: null,
    b2Stage: "studying", b2Failed: false, nationality: null, cityOfBirth: null, cityOfResidence: null,
    sex: null, maritalStatus: null, specialty: null, yearsExperience: null, workplacePref: null,
    placementReady: false, verified: false, passportStatus: null, passportExpiryMs: null,
    availableFromMs: null, hasEmployer: false, orgNames: [], b2Complete: null, b2CertDateMs: null,
    b2ExamMs: null, funnelStage: null, interview1Ms: null, interview2Ms: null, interview1Status: null,
    interview2Status: null, visaApptMs: null, flightMs: null, lastTouchMs: null,
    pendingDocCount: 0, hasApprovedB2Cert: false, docTotal: 0, rejectedDocs: 0, missingRequired: 0, checklistPct: 0, ...p,
  };
}
const optCount = (r: ReturnType<typeof buildFacets>, gk: string, ok: string) =>
  r.groups.find((g) => g.key === gk)?.options.find((o) => o.key === ok)?.count;
const uids = (r: ReturnType<typeof buildFacets>) => r.results.map((h) => h.uid).sort();

const POOL: SearchableCandidate[] = [
  mk({ uid: "full", name: "Full Cert", b2Complete: true, b2Stage: "passed", specialty: "intensive", nationality: "Maroc" }),
  mk({ uid: "partial", name: "Partial", b2Failed: true, b2Stage: "exam_booked", specialty: "intensive", nationality: "Maroc" }),
  mk({ uid: "await", name: "Awaiting", b2Stage: "awaiting_results", specialty: "geriatric", nationality: "Maroc" }),
  mk({ uid: "examsoon", name: "Exam Soon", b2Stage: "exam_booked", b2ExamMs: NOW + 10 * D, specialty: "geriatric" }),
  mk({ uid: "study", name: "Studying", b2Stage: "studying", specialty: "surgical" }),
];

describe("buildFacets — B2 facet the founder asked for", () => {
  it("counts each B2 state deterministically", () => {
    const r = buildFacets(POOL, {}, NOW, "en");
    expect(optCount(r, "b2", "full_cert")).toBe(1);   // full
    expect(optCount(r, "b2", "partial")).toBe(1);     // partial (failed + not full)
    expect(optCount(r, "b2", "awaiting")).toBe(1);
    expect(optCount(r, "b2", "booked")).toBe(2);      // partial + examsoon are exam_booked
    expect(optCount(r, "b2", "exam_30d")).toBe(1);    // examsoon
    expect(optCount(r, "b2", "studying")).toBe(1);
    expect(optCount(r, "b2", "failed")).toBe(1);
  });

  it("selecting 'full certificate' returns only the full-cert candidate", () => {
    const r = buildFacets(POOL, { b2: ["full_cert"] }, NOW, "en");
    expect(uids(r)).toEqual(["full"]);
    expect(r.total).toBe(1);
  });

  it("multi-select within a group is OR", () => {
    const r = buildFacets(POOL, { b2: ["full_cert", "awaiting"] }, NOW, "en");
    expect(uids(r)).toEqual(["await", "full"].sort());
  });

  it("across groups is AND", () => {
    // B2 awaiting AND geriatric specialty → only "await"
    const r = buildFacets(POOL, { b2: ["awaiting"], specialty: ["geriatric"] }, NOW, "en");
    expect(uids(r)).toEqual(["await"]);
  });
});

describe("buildFacets — Booking.com count semantics", () => {
  it("counts respect OTHER groups but not the option's own group", () => {
    // Pin specialty=intensive (full + partial). Within B2, counts reflect only the
    // 2 intensive candidates, but B2's own selection doesn't shrink its own counts.
    const r = buildFacets(POOL, { specialty: ["intensive"], b2: ["full_cert"] }, NOW, "en");
    // full_cert among intensive = 1 (full); partial among intensive = 1 (partial)
    expect(optCount(r, "b2", "full_cert")).toBe(1);
    expect(optCount(r, "b2", "partial")).toBe(1);
    // awaiting among intensive = 0 → option hidden
    expect(optCount(r, "b2", "awaiting")).toBeUndefined();
    // results still honour the B2 selection (AND) → only full
    expect(uids(r)).toEqual(["full"]);
  });

  it("hides options nothing matches but keeps a selected option visible", () => {
    const r = buildFacets(POOL, { b2: ["studying"], specialty: ["intensive"] }, NOW, "en");
    // studying among intensive = 0, but it's selected → stays visible with count 0
    const studying = r.groups.find((g) => g.key === "b2")?.options.find((o) => o.key === "studying");
    expect(studying?.selected).toBe(true);
    expect(studying?.count).toBe(0);
  });
});

describe("buildFacets — dynamic groups + safety", () => {
  it("builds nationality options from the data with counts", () => {
    const r = buildFacets(POOL, {}, NOW, "en");
    expect(optCount(r, "nationality", "Maroc")).toBe(3);
  });

  it("only ever returns candidates from the input set", () => {
    const ids = new Set(POOL.map((c) => c.uid));
    const r = buildFacets(POOL, { b2: ["booked"] }, NOW, "en");
    for (const h of r.results) expect(ids.has(h.uid)).toBe(true);
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
