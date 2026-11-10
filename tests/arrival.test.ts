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

  it("the visa guide: the date handed in and the ticked steps, same access rules", async () => {
    const visa = await import("../app/api/portal/visa/route");
    const vreq = (method: string, headers: Record<string, string>, body?: unknown, q = "") =>
      new NextRequest(`https://borivon.com/api/portal/visa${q}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect((await visa.PUT(vreq("PUT", { "x-user": NURSE }, { submitted: "2026-11-02" }))).status).toBe(200);
    expect((await visa.PATCH(vreq("PATCH", { "x-role": "admin" }, { userId: NURSE, step: "vorab", done: true }))).status).toBe(200);
    const g = await (await visa.GET(vreq("GET", { "x-role": "admin" }, undefined, `?userId=${NURSE}`))).json();
    expect(g.submitted).toBe("2026-11-02");
    expect(g.steps.vorab).toBeTruthy();
    expect((await visa.GET(vreq("GET", { "x-role": "admin" }, undefined, `?userId=${OTHER}`))).status).toBe(403);
    expect((await visa.PATCH(vreq("PATCH", { "x-user": NURSE }, { step: "nope", done: true }))).status).toBe(400);
  });

  it("flat + journey: the flight and who picks her up, shared", async () => {
    const mv = await import("../app/api/portal/move/route");
    const mreq = (method: string, headers: Record<string, string>, body?: unknown, q = "") =>
      new NextRequest(`https://borivon.com/api/portal/move${q}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect((await mv.PUT(mreq("PUT", { "x-role": "admin" }, { userId: NURSE, flight_from: "Casablanca", flight_to: "München", flight_date: "2027-01-12", pickup_by: "Frau Huber" }))).status).toBe(200);
    expect((await mv.PATCH(mreq("PATCH", { "x-user": NURSE }, { step: "lease", done: true }))).status).toBe(200);
    const g = await (await mv.GET(mreq("GET", { "x-user": NURSE }))).json();
    expect(g).toMatchObject({ flight_to: "München", flight_date: "2027-01-12", pickup_by: "Frau Huber" });
    expect(g.steps.lease).toBeTruthy();
    expect((await mv.GET(mreq("GET", { "x-role": "admin" }, undefined, `?userId=${OTHER}`))).status).toBe(403);
  });

  it("the first six months: ticked by both sides, probation end six months after the first day", async () => {
    const st = await import("../app/api/portal/settle/route");
    const { probationEnd, phaseDate } = await import("../lib/facility/settle");
    const sreq = (method: string, headers: Record<string, string>, body?: unknown, q = "") =>
      new NextRequest(`https://borivon.com/api/portal/settle${q}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect((await st.PATCH(sreq("PATCH", { "x-user": NURSE }, { step: "d1a", done: true }))).status).toBe(200);
    expect((await st.PATCH(sreq("PATCH", { "x-role": "admin" }, { userId: NURSE, step: "m6c", done: true }))).status).toBe(200);
    const g = await (await st.GET(sreq("GET", { "x-role": "admin" }, undefined, `?userId=${NURSE}`))).json();
    expect(Object.keys(g.steps).sort()).toEqual(["d1a", "m6c"]);
    expect((await st.PATCH(sreq("PATCH", { "x-user": NURSE }, { step: "d1a", done: false }))).status).toBe(200);
    expect(Object.keys((await (await st.GET(sreq("GET", { "x-user": NURSE }))).json()).steps)).toEqual(["m6c"]);
    expect((await st.GET(sreq("GET", { "x-role": "admin" }, undefined, `?userId=${OTHER}`))).status).toBe(403);
    expect((await st.PATCH(sreq("PATCH", { "x-user": NURSE }, { step: "nope", done: true }))).status).toBe(400);
    expect(probationEnd("2026-12-15")).toBe("2027-06-15");
    expect(probationEnd("2026-08-31")).toBe("2027-02-28");
    expect(probationEnd("")).toBe("");
    expect(phaseDate("2026-12-15", 30)).toBe("2027-01-14");
  });

  it("the way's summary: each station's progress and the one to work on now", async () => {
    const visa = await import("../app/api/portal/visa/route");
    const weg = await import("../app/api/portal/weg/route");
    const { VISA_STEPS } = await import("../lib/facility/visa");
    const r = (path: string, method: string, headers: Record<string, string>, body?: unknown, q = "") =>
      new NextRequest(`https://borivon.com/api/portal/${path}${q}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const empty = await (await weg.GET(r("weg", "GET", { "x-user": NURSE }))).json();
    expect(empty.now).toBe("visa");
    expect(empty.prog.visa).toEqual([0, VISA_STEPS.length]);
    for (const s of VISA_STEPS) await visa.PATCH(r("visa", "PATCH", { "x-user": NURSE }, { step: s.id, done: true }));
    const after = await (await weg.GET(r("weg", "GET", { "x-role": "admin" }, undefined, `?userId=${NURSE}`))).json();
    expect(after.prog.visa).toEqual([VISA_STEPS.length, VISA_STEPS.length]);
    expect(after.now).toBe("move");
    expect((await weg.GET(r("weg", "GET", { "x-role": "admin" }, undefined, `?userId=${OTHER}`))).status).toBe(403);
    expect((await weg.GET(r("weg", "GET", {}))).status).toBe(401);
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
