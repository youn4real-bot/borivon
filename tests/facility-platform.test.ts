/**
 * The facility platform (founder 2026-11-10): the gift page at the end of the Fahrplan, the place
 * finder, the free scope in the terms, and the account flow on a real SQLite database.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { normalizeForm, toModel, facilityLine } from "../lib/roadmap/form";
import { scoreRoadmap, type Level } from "../lib/roadmap/score";

const today = new Date("2026-11-10T10:00:00Z");

describe("the gift page", () => {
  it("is the last page, with the personal link, in every language", async () => {
    const { renderRoadmapPdf, roadmapPageCount } = await import("../lib/roadmap/pdf");
    const { pdfLinks } = await import("../lib/roadmap/hosted");
    const { PDFDocument } = await import("pdf-lib");
    for (const lang of ["de", "en", "fr"] as const) {
      const form = normalizeForm({ art: "care_home", land: "BY", bedarf: "6-10", leasing: "1-2", start: "asap" });
      const result = scoreRoadmap(toModel(form));
      const url = "https://borivon.com/einrichtung/start?id=abc&t=xyz";
      const bytes = await renderRoadmapPdf({ result, lang, form, name: "Frau Müller", facility: facilityLine(form, lang), date: today, platformUrl: url });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(roadmapPageCount(result.level as Level, true, true));
      const links = await pdfLinks(bytes);
      const gift = links.filter((l) => l.url === url);
      expect(gift).toHaveLength(1);
      expect(gift[0].page).toBe(doc.getPageCount()); // on the very last page
      if (process.env.FX_PDF_OUT && lang === "de") writeFileSync(process.env.FX_PDF_OUT, bytes);
    }
  }, 120_000);

  it("is absent without a lead (the sample PDF)", async () => {
    const { renderRoadmapPdf, roadmapPageCount } = await import("../lib/roadmap/pdf");
    const form = normalizeForm({ art: "care_home", land: "BY", bedarf: "6-10", leasing: "1-2", start: "asap" });
    const result = scoreRoadmap(toModel(form));
    const { PDFDocument } = await import("pdf-lib");
    const bytes = await renderRoadmapPdf({ result, lang: "de", form, name: "", facility: "", date: today });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(roadmapPageCount(result.level as Level, true, false));
  }, 60_000);
});

describe("the place finder", () => {
  it("classifies OSM objects and skips an MP's 'Bürgerbüro'", async () => {
    const { classify } = await import("../scripts/fx-places-pack.mjs");
    expect(classify({ name: "Finanzamt Rosenheim", office: "government" })!.kind).toBe("finanzamt");
    expect(classify({ name: "Landratsamt Rosenheim", office: "government" })!.kind).toBe("auslaender");
    expect(classify({ name: "Ausländerbehörde", office: "government" })!.w).toBeLessThan(1);
    expect(classify({ name: "Bürgerbüro Lausch, Josef, MdL", office: "government" })).toBeNull();
    expect(classify({ name: "Bürgerbüro", office: "government" })!.kind).toBe("anmeldung");
    expect(classify({ name: "Rathaus", amenity: "townhall" })!.kind).toBe("anmeldung");
    expect(classify({ name: "Sparkasse Rosenheim-Bad Aibling", amenity: "bank" })!.w).toBeLessThan(1);
    expect(classify({ name: "AOK Bayern", office: "insurance" })!.kind).toBe("kasse");
    expect(classify({ name: "Dr. med. Huber", amenity: "doctors" })!.kind).toBe("arzt");
    expect(classify({ name: "Bäckerei", shop: "bakery" })).toBeNull();
  });

  it("prefers the Landratsamt of her own Landkreis over a nearer one", async () => {
    const { nearest } = await import("../lib/facility/places");
    const geo = { lat: 47.85, lon: 12.12, label: "83022 Rosenheim", county: "Landkreis Rosenheim", town: "Kolbermoor" };
    const rows = [
      { kind: "auslaender", name: "Landratsamt Traunstein", lat: 47.87, lon: 12.2, w: 1, address: "" },
      { kind: "auslaender", name: "Landratsamt Rosenheim", lat: 47.86, lon: 12.25, w: 1, address: "" },
    ];
    expect(nearest(rows, geo)?.name).toBe("Landratsamt Rosenheim");
  });

  it("picks the nearest when nothing else differs", async () => {
    const { nearest } = await import("../lib/facility/places");
    const geo = { lat: 48.1, lon: 11.5, label: "", county: "", town: "" };
    const rows = [
      { kind: "bank", name: "Far", lat: 48.2, lon: 11.5, w: 1 },
      { kind: "bank", name: "Near", lat: 48.101, lon: 11.5, w: 1 },
    ];
    const p = nearest(rows, geo)!;
    expect(p.name).toBe("Near");
    expect(p.dist).toBeGreaterThan(80);
    expect(p.dist).toBeLessThan(130);
  });
});

describe("the terms", () => {
  it("state the free scope with its numbers; the marketing words never do", async () => {
    const { TERMS } = await import("../lib/facility/legal");
    const s3 = TERMS.sections.find((s) => s.h.startsWith("§ 3"))!;
    expect(s3.p[0]).toContain("bis zu 5 (fünf)");
    expect(s3.p[0]).toContain("bis zu 2 (zwei) Nutzer");
    expect(s3.p[0]).toContain("unbefristet");
    const { V } = await import("../lib/roadmap/visual");
    const { FX_T } = await import("../components/fx/i18n");
    for (const lang of ["de", "en", "fr"] as const) {
      const words = JSON.stringify([V[lang].giftH, V[lang].giftP, V[lang].giftItems, FX_T[lang].startH, FX_T[lang].startP, FX_T[lang].f1, FX_T[lang].f2, FX_T[lang].f3]);
      expect(words).not.toMatch(/\b5\b|\b2\b|fünf|zwei|unbegrenzt|unlimited|illimité/i);
    }
  });
});

// ── the account flow on a real SQLite database (node:sqlite), Supabase leads mocked ──────────
const lead = { id: "lead-1", email: "Leitung@Pflegeheim-Sonne.de", details: { salutation: "frau", lastName: "Müller", facility: "", consent: { confirmedAt: "2026-11-10T09:00:00Z" } } };
vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => ({
    from: () => {
      const q = { select: () => q, eq: (_k: string, v: string) => { (q as { _id?: string })._id ??= v; return q; }, maybeSingle: async () => ({ data: (q as { _id?: string })._id === lead.id ? lead : null }) };
      return q;
    },
  }),
}));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimitDistributed: async () => ({ ok: true }) }));
vi.mock("@/lib/track/server", () => ({ trackServer: async () => {} }));
vi.mock("@/lib/keepAlive", () => ({ keepAlive: () => {} }));
const mails: { to: string; subject: string; html: string }[] = [];
vi.mock("@/lib/email", () => ({ sendAdminAlertEmail: async () => true, sendFacilityEmail: async (m: { to: string; subject: string; html: string }) => { mails.push(m); return true; } }));

describe("the account flow", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { setD1Runner } = await import("../lib/d1/client");
  const { NextRequest } = await import("next/server");
  const { signLeadToken } = await import("../lib/roadmap/token");
  let sqlite: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    process.env.DL_TOKEN_SECRET = "test-secret-0123456789abcdef";
    sqlite = new DatabaseSync(":memory:");
    setD1Runner({
      async run(sql: string, params: unknown[] = []) {
        const st = sqlite.prepare(sql);
        const p = params.map((v) => (typeof v === "boolean" ? Number(v) : v)) as (string | number | null)[];
        if (/^\s*(select|with)/i.test(sql) || /returning/i.test(sql)) return { results: st.all(...p) as Record<string, unknown>[], meta: {} };
        const r = st.run(...p);
        return { results: [], meta: { changes: Number(r.changes) } };
      },
    });
    mails.length = 0;
  });
  afterAll(() => setD1Runner(null));

  const req = (url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
    new NextRequest(new URL(url, "https://borivon.com"), {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", origin: "https://borivon.com", ...(init.cookie ? { cookie: init.cookie } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

  it("opens only with the signed link, needs both boxes, then signs in", async () => {
    const start = await import("../app/api/einrichtung/start/route");
    const t = await signLeadToken("platform", lead.id);
    expect((await start.GET(req(`/api/einrichtung/start?id=${lead.id}&t=wrong`))).status).toBe(403);
    const g = await start.GET(req(`/api/einrichtung/start?id=${lead.id}&t=${t}`));
    expect(g.status).toBe(200);
    expect(await g.json()).toMatchObject({ email: "leitung@pflegeheim-sonne.de", lastName: "Müller", existing: false });

    const body = { id: lead.id, t, name: "Pflegeheim Sonne", plz: "83022", city: "Rosenheim", kind: "care_home" };
    expect((await start.POST(req("/api/einrichtung/start", { method: "POST", body: { ...body, terms: true } }))).status).toBe(400);
    const ok = await start.POST(req("/api/einrichtung/start", { method: "POST", body: { ...body, terms: true, avv: true } }));
    expect(ok.status).toBe(200);
    const cookie = cookieOf(ok);
    expect(cookie).toMatch(/^bv_fx=.{30,}/);
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    // the acceptance is on record, with the version
    const f = sqlite.prepare("SELECT terms_version, terms_at, avv_at FROM fx_facilities").get() as Record<string, string>;
    expect(f.terms_version).toBe("2026-11-10");
    expect(f.terms_at && f.avv_at).toBeTruthy();
    // a second time: "exists"
    expect((await start.POST(req("/api/einrichtung/start", { method: "POST", body: { ...body, terms: true, avv: true } }))).status).toBe(409);

    const me = await import("../app/api/einrichtung/me/route");
    const m = await me.GET(req("/api/einrichtung/me", { cookie }));
    const j = await m.json();
    expect(j.facility.name).toBe("Pflegeheim Sonne");
    expect(j.nurses).toHaveLength(1);
    expect(j.nurses[0].sample).toBe(true);
    expect((await me.GET(req("/api/einrichtung/me"))).status).toBe(401);
  });

  it("keeps the free scope: 5 nurses (the example does not count), 2 users", async () => {
    const start = await import("../app/api/einrichtung/start/route");
    const t = await signLeadToken("platform", lead.id);
    const ok = await start.POST(req("/api/einrichtung/start", { method: "POST", body: { id: lead.id, t, name: "Haus", plz: "80331", city: "München", terms: true, avv: true } }));
    const cookie = cookieOf(ok);
    const nurses = await import("../app/api/einrichtung/nurses/route");
    for (let i = 0; i < 5; i++) {
      const r = await nurses.POST(req("/api/einrichtung/nurses", { method: "POST", cookie, body: { first_name: `N${i}`, arrival: "2026-12-01" } }));
      expect(r.status).toBe(200);
    }
    const sixth = await nurses.POST(req("/api/einrichtung/nurses", { method: "POST", cookie, body: { first_name: "N6" } }));
    expect(sixth.status).toBe(403);
    expect(await sixth.json()).toMatchObject({ error: "limit", limit: 5 });

    const team = await import("../app/api/einrichtung/team/route");
    expect((await team.POST(req("/api/einrichtung/team", { method: "POST", cookie, body: { email: "pdl@pflegeheim-sonne.de" } }))).status).toBe(200);
    expect(mails).toHaveLength(1);
    const k = decodeURIComponent(mails[0].html.match(/anmelden\?k=([^"&]+)/)![1]);
    const verify = await import("../app/api/einrichtung/login/verify/route");
    const v = await verify.POST(req("/api/einrichtung/login/verify", { method: "POST", body: { k } }));
    expect(v.status).toBe(200);
    // the link works once
    expect((await verify.POST(req("/api/einrichtung/login/verify", { method: "POST", body: { k } }))).status).toBe(400);
    // the team is full now
    const third = await team.POST(req("/api/einrichtung/team", { method: "POST", cookie, body: { email: "third@pflegeheim-sonne.de" } }));
    expect(third.status).toBe(403);
  });

  it("never tells a stranger whether an email has access; links are single-use", async () => {
    const login = await import("../app/api/einrichtung/login/route");
    const r = await login.POST(req("/api/einrichtung/login", { method: "POST", body: { email: "nobody@example.org" } }));
    expect(r.status).toBe(200);
    expect(mails).toHaveLength(0);
    const bad = await login.POST(new (await import("next/server")).NextRequest("https://borivon.com/api/einrichtung/login", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" }));
    expect(bad.status).toBe(403);
  });

  it("the nurse's link shows her plan and nothing of the facility's other data", async () => {
    const start = await import("../app/api/einrichtung/start/route");
    const t = await signLeadToken("platform", lead.id);
    const cookie = cookieOf(await start.POST(req("/api/einrichtung/start", { method: "POST", body: { id: lead.id, t, name: "Haus", plz: "83022", city: "Rosenheim", terms: true, avv: true } })));
    const nurses = await import("../app/api/einrichtung/nurses/route");
    const n = (await (await nurses.POST(req("/api/einrichtung/nurses", { method: "POST", cookie, body: { first_name: "Amina", last_name: "El Idrissi", arrival: "2026-12-01" } }))).json()).nurse;
    const ank = await import("../app/api/ankunft/[token]/route");
    const g = await ank.GET(req(`/api/ankunft/${n.share_token}`), { params: Promise.resolve({ token: n.share_token }) });
    const j = await g.json();
    expect(j.first_name).toBe("Amina");
    expect(JSON.stringify(j)).not.toContain("El Idrissi"); // her last name stays inside the facility
    expect(JSON.stringify(j)).not.toContain("leitung@");
    const p = await ank.PATCH(req(`/api/ankunft/${n.share_token}`, { method: "PATCH", body: { step: "anmeldung", done: true } }), { params: Promise.resolve({ token: n.share_token }) });
    expect((await p.json()).steps.anmeldung).toBeTruthy();
    const nope = await ank.GET(req("/api/ankunft/x".padEnd(50, "x")), { params: Promise.resolve({ token: "x".repeat(43) }) });
    expect(nope.status).toBe(404);
  });
});
