/** The arrival plan in the portal: a nurse only reaches her own; an admin only whom canActOnCandidate allows. */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const NURSE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
vi.mock("@/lib/admin-auth", () => ({
  requireAdminRole: async (req: Request) => (req.headers.get("x-role") === "admin" ? { ok: true, role: "sub_admin", email: "leitung@sonne.de", userId: "a", agencyId: null, isAgencyAdmin: true } : { ok: false, status: 403, error: "no" }),
  requireUser: async (req: Request) => (req.headers.get("x-user") ? { ok: true, userId: req.headers.get("x-user"), email: "n@x.de", jwt: "j" } : { ok: false, status: 401, error: "no" }),
  canActOnCandidate: async (_r: string, _e: string, id: string) => id === NURSE,
}));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimitDistributed: async () => ({ ok: true }) }));

describe("arrival plan API", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { setD1Runner } = await import("../lib/d1/client");
  const { NextRequest } = await import("next/server");
  beforeEach(() => {
    const sqlite = new DatabaseSync(":memory:");
    setD1Runner({
      async run(sql: string, params: unknown[] = []) {
        const st = sqlite.prepare(sql);
        const p = params as (string | number | null)[];
        if (/^\s*select/i.test(sql)) return { results: st.all(...p) as Record<string, unknown>[], meta: {} };
        const r = st.run(...p);
        return { results: [], meta: { changes: Number(r.changes) } };
      },
    });
  });
  afterAll(() => setD1Runner(null));
  const req = (method: string, headers: Record<string, string>, body?: unknown, q = "") =>
    new NextRequest(`https://borivon.com/api/portal/arrival${q}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("the facility sets her place, she ticks, both see the same plan", async () => {
    const api = await import("../app/api/portal/arrival/route");
    const put = await api.PUT(req("PUT", { "x-role": "admin" }, { userId: NURSE, arrival: "2026-12-01", start: "2026-12-15", plz: "83022", city: "Rosenheim" }));
    expect(put.status).toBe(200);
    const tick = await api.PATCH(req("PATCH", { "x-user": NURSE }, { step: "anmeldung", done: true }));
    expect((await tick.json()).steps.anmeldung).toBeTruthy();
    const seen = await (await api.GET(req("GET", { "x-role": "admin" }, undefined, `?userId=${NURSE}`))).json();
    expect(seen).toMatchObject({ plz: "83022", city: "Rosenheim", arrival: "2026-12-01" });
    expect(seen.steps.anmeldung).toBeTruthy();
  });

  it("an admin cannot reach a nurse outside their scope; a nurse never reaches another's plan", async () => {
    const api = await import("../app/api/portal/arrival/route");
    expect((await api.GET(req("GET", { "x-role": "admin" }, undefined, `?userId=${OTHER}`))).status).toBe(403);
    await api.PUT(req("PUT", { "x-role": "admin" }, { userId: NURSE, plz: "80331" }));
    // the other nurse asks for NURSE's plan: she gets her own (empty) one
    const mine = await (await api.GET(req("GET", { "x-user": OTHER }, undefined, `?userId=${NURSE}`))).json();
    expect(mine.plz).toBe("");
    expect((await api.GET(req("GET", {}))).status).toBe(401);
    expect((await api.PATCH(req("PATCH", { "x-user": NURSE }, { step: "nope", done: true }))).status).toBe(400);
  });
});
