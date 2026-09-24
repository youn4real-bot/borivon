import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Drive is the founder's red line — "An Calmaroi senden" is how an agency
 * receives a candidate's dossier — and it is also the dependency that has
 * already failed silently for five months: after the Cloudflare migration the
 * Drive client could not run, every caller caught and logged, and the sync
 * reported success while copying nothing, with /api/health?deep=1 answering
 * google:true throughout.
 *
 * So Drive now has a row of its own, and these tests hold that split in place:
 * `google` must keep meaning what it meant before (delegation works, Gmail
 * answers) and must not be allowed to absorb a Drive failure.
 */

const h = vi.hoisted(() => ({
  testWorkspace: vi.fn(),
  r2Configured: vi.fn(() => true),
  r2List: vi.fn(async () => []),
}));

vi.mock("@/lib/googleWorkspace", () => ({ testWorkspace: h.testWorkspace }));
vi.mock("@/lib/r2", () => ({ r2Configured: h.r2Configured, r2List: h.r2List }));
vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => ({
    from: () => ({ select: () => ({ is: () => Promise.resolve({ count: 7, error: null }) }) }),
  }),
}));

import { runHealthProbes, publicSummary } from "../lib/healthProbes";

const by = (probes: Awaited<ReturnType<typeof runHealthProbes>>, name: string) =>
  probes.find((p) => p.name === name)!;

beforeEach(() => {
  vi.clearAllMocks();
  h.r2Configured.mockReturnValue(true);
  h.r2List.mockResolvedValue([]);
  process.env.RESEND_API_KEY = "re_test";
});

describe("health probes — Drive is reported separately from Google", () => {
  it("a healthy Workspace reports google AND drive true, from ONE live check", async () => {
    h.testWorkspace.mockResolvedValue({ ok: true, connectedAs: "founder@borivon.com", gmail: true, calendar: true, drive: true });
    const probes = await runHealthProbes();
    expect(publicSummary(probes)).toEqual({ google: true, drive: true, r2: true, database: true, email: true });
    // Two probes, one API round trip — a second testWorkspace() would double the
    // daily traffic to learn nothing.
    expect(h.testWorkspace).toHaveBeenCalledTimes(1);
  });

  it("Gmail up but Drive dead → google stays true, drive goes false and says why", async () => {
    // THE regression this exists for: before the split this state reported
    // google:true and nothing else, so nobody learned that dossiers had stopped
    // reaching the agencies.
    h.testWorkspace.mockResolvedValue({ ok: true, connectedAs: "founder@borivon.com", gmail: true, calendar: true, drive: false });
    const probes = await runHealthProbes();
    expect(by(probes, "google").ok).toBe(true);
    expect(by(probes, "drive").ok).toBe(false);
    expect(by(probes, "drive").detail).toMatch(/dossiers/i);
  });

  it("a dead calendar still only downgrades google's detail, never its verdict", async () => {
    h.testWorkspace.mockResolvedValue({ ok: true, gmail: true, calendar: false, drive: true });
    const probes = await runHealthProbes();
    expect(by(probes, "google")).toMatchObject({ ok: true, detail: "gmail only" });
    expect(by(probes, "drive").ok).toBe(true);
  });

  it("missing credentials fail BOTH rows — nothing Google works without them", async () => {
    h.testWorkspace.mockResolvedValue({ ok: false, error: "not_configured" });
    const probes = await runHealthProbes();
    expect(by(probes, "google")).toMatchObject({ ok: false });
    expect(by(probes, "drive")).toMatchObject({ ok: false });
    expect(by(probes, "google").detail).toMatch(/credentials missing/);
  });

  it("delegation refused fails both rows and carries Google's own message", async () => {
    h.testWorkspace.mockResolvedValue({ ok: false, error: "unauthorized_client" });
    const probes = await runHealthProbes();
    expect(by(probes, "google")).toMatchObject({ ok: false, detail: "unauthorized_client" });
    expect(by(probes, "drive")).toMatchObject({ ok: false, detail: "unauthorized_client" });
  });

  it("a THROWING workspace check still emits both rows as false", async () => {
    // A probe that dies must not shrink the result set: four rows where five are
    // expected reads downstream as "drive was fine", the exact inversion of what
    // a dead Workspace client means.
    h.testWorkspace.mockRejectedValue(new Error("boom"));
    const probes = await runHealthProbes();
    expect(probes.map((p) => p.name).sort()).toEqual(["database", "drive", "email", "google", "r2"]);
    expect(by(probes, "google")).toMatchObject({ ok: false, detail: "boom" });
    expect(by(probes, "drive")).toMatchObject({ ok: false, detail: "boom" });
  });

  it("a failing Drive never drags R2, the database or email down with it", async () => {
    h.testWorkspace.mockResolvedValue({ ok: true, gmail: true, calendar: true, drive: false });
    const probes = await runHealthProbes();
    expect(publicSummary(probes)).toEqual({ google: true, drive: false, r2: true, database: true, email: true });
  });

  it("the public body stays booleans only — no detail leaks to an unauthenticated caller", async () => {
    h.testWorkspace.mockResolvedValue({ ok: false, error: "unauthorized_client for 1234567890" });
    const probes = await runHealthProbes();
    for (const v of Object.values(publicSummary(probes))) expect(typeof v).toBe("boolean");
    expect(JSON.stringify(publicSummary(probes))).not.toContain("unauthorized_client");
  });
});
