import { describe, it, expect } from "vitest";
import { computeNeeds } from "@/lib/needsPanel";
import type { SearchableCandidate } from "@/lib/candidateSearch";

const NOW = Date.parse("2026-08-28T12:00:00Z");
const D = 86_400_000;
const iso = (s: string) => Date.parse(s);

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
const group = (r: ReturnType<typeof computeNeeds>, key: string) => r.groups.find((g) => g.key === key);

describe("computeNeeds", () => {
  it("is all-clear for a healthy set", () => {
    const r = computeNeeds([mk({ uid: "ok", name: "Ok", funnelStage: "interview1", lastSignInMs: NOW - D })], NOW, "en");
    expect(r.total).toBe(0);
    expect(r.groups).toEqual([]);
  });

  it("surfaces pending document reviews", () => {
    const r = computeNeeds([mk({ uid: "a", name: "A", pendingDocCount: 3 })], NOW, "en");
    const g = group(r, "review");
    expect(g?.items[0]).toMatchObject({ uid: "a" });
    expect(g?.items[0].detail).toMatch(/3/);
  });

  it("flags expired and expiring passports, not far-future ones", () => {
    const r = computeNeeds([
      mk({ uid: "exp", name: "Expired", passportExpiryMs: iso("2026-06-01") }),
      mk({ uid: "soon", name: "Soon", passportExpiryMs: NOW + 90 * D }),
      mk({ uid: "far", name: "Far", passportExpiryMs: NOW + 400 * D }),
    ], NOW, "en");
    const g = group(r, "passport");
    expect(g?.items.map((i) => i.uid).sort()).toEqual(["exp", "soon"].sort());
    // expired sorts first (smallest ms)
    expect(g?.items[0].uid).toBe("exp");
  });

  it("flags near interviews/visa within 14 days, not later", () => {
    const r = computeNeeds([
      mk({ uid: "iv", name: "IV", interview1Ms: NOW + 5 * D }),
      mk({ uid: "visa", name: "Visa", visaApptMs: NOW + 3 * D }),
      mk({ uid: "late", name: "Late", interview1Ms: NOW + 40 * D }),
    ], NOW, "en");
    const g = group(r, "dates");
    expect(g?.items.map((i) => i.uid).sort()).toEqual(["iv", "visa"].sort());
    expect(g?.items[0].uid).toBe("visa"); // soonest first
  });

  it("flags B2 exam soon and awaiting-results", () => {
    const r = computeNeeds([
      mk({ uid: "exam", name: "Exam", b2ExamMs: NOW + 10 * D }),
      mk({ uid: "await", name: "Await", b2Stage: "awaiting_results" }),
    ], NOW, "en");
    expect(group(r, "b2")?.items.map((i) => i.uid).sort()).toEqual(["await", "exam"].sort());
  });

  it("flags cold waiting candidates (quiet + not touched)", () => {
    const r = computeNeeds([
      mk({ uid: "cold", name: "Cold", funnelStage: "waiting_2nd", lastSignInMs: NOW - 30 * D, lastTouchMs: NOW - 30 * D }),
      mk({ uid: "warm", name: "Warm", funnelStage: "waiting_2nd", lastSignInMs: NOW - 2 * D }),
    ], NOW, "en");
    const g = group(r, "cold");
    expect(g?.items.map((i) => i.uid)).toEqual(["cold"]);
  });

  it("flags signed-up-but-never-started, but not an active newcomer", () => {
    const r = computeNeeds([
      mk({ uid: "ghost", name: "Ghost", createdAtMs: NOW - 20 * D, lastSignInMs: NOW - 20 * D }),
      mk({ uid: "fresh", name: "Fresh", createdAtMs: NOW - 1 * D, lastSignInMs: NOW - 1 * D }), // too new
      mk({ uid: "busy", name: "Busy", createdAtMs: NOW - 20 * D, pendingDocCount: 1 }), // has pending → not a ghost
    ], NOW, "en");
    const g = group(r, "newstuck");
    expect(g?.items.map((i) => i.uid)).toEqual(["ghost"]);
  });

  it("counts overflow beyond the per-group cap", () => {
    const many = Array.from({ length: 30 }, (_, i) => mk({ uid: `p${i}`, name: `P${i}`, pendingDocCount: 1 }));
    const g = group(computeNeeds(many, NOW, "en"), "review");
    expect(g?.items.length).toBe(25);
    expect(g?.overflow).toBe(5);
  });

  it("only ever references candidates from the input set", () => {
    const pool = [mk({ uid: "a", name: "A", pendingDocCount: 1, passportExpiryMs: iso("2026-06-01") })];
    const ids = new Set(pool.map((c) => c.uid));
    for (const g of computeNeeds(pool, NOW, "en").groups) for (const it of g.items) expect(ids.has(it.uid)).toBe(true);
  });
});
