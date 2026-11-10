/**
 * DIY facilities in the real portal (founder 2026-11-10): the gift link creates an organization + its
 * org-scoped admin; a DIY facility's own nurses stay out of Borivon's team and automation until the
 * facility switches on "Mit Borivon arbeiten" (LAW #25, amended). Fake portal DB + real SQLite for fx_*.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ── a tiny in-memory stand-in for the Supabase-shaped adapter ─────────────────────────────────
type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
const authUsers: { id: string; email: string }[] = [];
function reset() {
  for (const k of Object.keys(T)) delete T[k];
  Object.assign(T, {
    leads: [{ id: "lead-1", kind: "roadmap", email: "Leitung@Pflegeheim-Sonne.de", details: { salutation: "frau", lastName: "Müller", facility: "", consent: { confirmedAt: "2026-11-10T09:00:00Z" } } }],
    organizations: [], sub_admins: [], organization_members: [], candidate_profiles: [], candidate_organizations: [],
  });
  authUsers.length = 0;
}
function query(table: string) {
  let rows = () => (T[table] ??= []);
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "delete" | "update" = "select";
  let patch: Row = {};
  let inserted: Row[] | null = null;
  let countMode = false;
  const match = (r: Row) => filters.every((f) => f(r));
  const result = () => {
    if (inserted) return { data: inserted, error: null };
    if (op === "delete") { T[table] = rows().filter((r) => !match(r)); return { data: null, error: null }; }
    if (op === "update") { rows().filter(match).forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
    const hit = rows().filter(match);
    return countMode ? { data: null, error: null, count: hit.length } : { data: hit, error: null };
  };
  const q: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (o?.count) countMode = true; return q; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    ilike: (k: string, v: string) => { filters.push((r) => String(r[k] ?? "").toLowerCase() === v.replace(/\\/g, "").toLowerCase()); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
    limit: () => q, order: () => q,
    delete: () => { op = "delete"; return q; },
    update: (p: Row) => { op = "update"; patch = p; return q; },
    insert: (r: Row | Row[]) => {
      const list = (Array.isArray(r) ? r : [r]).map((x) => ({ id: x.id ?? crypto.randomUUID(), ...x }));
      rows().push(...list); inserted = list; return q;
    },
    upsert: (r: Row) => { rows().push(r); inserted = [r]; return q; },
    maybeSingle: async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    single: async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return q;
}
const fakeDb = {
  from: (t: string) => query(t),
  auth: {
    admin: {
      createUser: async ({ email }: { email: string }) => {
        if (authUsers.some((u) => u.email.toLowerCase() === email.toLowerCase())) return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
        const user = { id: crypto.randomUUID(), email };
        authUsers.push(user);
        return { data: { user }, error: null };
      },
      deleteUser: async (id: string) => { const i = authUsers.findIndex((u) => u.id === id); if (i >= 0) authUsers.splice(i, 1); return { error: null }; },
    },
  },
};
vi.mock("@/lib/supabase", () => ({ getServiceSupabase: () => fakeDb }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimitDistributed: async () => ({ ok: true }) }));
vi.mock("@/lib/track/server", () => ({ trackServer: async () => {} }));
vi.mock("@/lib/keepAlive", () => ({ keepAlive: () => {} }));
vi.mock("@/lib/email", () => ({ sendAdminAlertEmail: async () => true }));

describe("DIY facility", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { setD1Runner } = await import("../lib/d1/client");
  const { NextRequest } = await import("next/server");
  const { signLeadToken } = await import("../lib/roadmap/token");
  let sqlite: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    process.env.DL_TOKEN_SECRET = "test-secret-0123456789abcdef";
    reset();
    sqlite = new DatabaseSync(":memory:");
    setD1Runner({
      async run(sql: string, params: unknown[] = []) {
        const st = sqlite.prepare(sql);
        const p = params as (string | number | null)[];
        if (/^\s*select/i.test(sql)) return { results: st.all(...p) as Row[], meta: {} };
        const r = st.run(...p);
        return { results: [], meta: { changes: Number(r.changes) } };
      },
    });
  });
  afterAll(() => setD1Runner(null));

  const post = (body: unknown) => new NextRequest("https://borivon.com/api/einrichtung/start", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://borivon.com" }, body: JSON.stringify(body),
  });

  it("the gift link opens the facility's own space in the portal", async () => {
    const start = await import("../app/api/einrichtung/start/route");
    const t = await signLeadToken("platform", "lead-1");
    expect((await start.GET(new NextRequest(`https://borivon.com/api/einrichtung/start?id=lead-1&t=nope`))).status).toBe(403);
    const g = await (await start.GET(new NextRequest(`https://borivon.com/api/einrichtung/start?id=lead-1&t=${t}`))).json();
    expect(g).toMatchObject({ email: "leitung@pflegeheim-sonne.de", lastName: "Müller", existing: false });

    const base = { id: "lead-1", t, name: "Pflegeheim Sonne", password: "sonne-2026" };
    expect((await start.POST(post({ ...base, terms: true }))).status).toBe(400); // AVV box missing
    expect((await start.POST(post({ ...base, password: "short", terms: true, avv: true }))).status).toBe(400);
    const ok = await start.POST(post({ ...base, terms: true, avv: true }));
    expect(ok.status).toBe(200);

    // a real organization, an ORG-SCOPED admin (LAW #25), never a candidate
    expect(T.organizations).toHaveLength(1);
    const org = T.organizations[0];
    expect(String(org.invite_code)).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(String(org.member_invite_code).length).toBeGreaterThan(30);
    expect(T.sub_admins).toEqual([expect.objectContaining({ email: "leitung@pflegeheim-sonne.de", is_agency_admin: true })]);
    expect(T.organization_members).toEqual([expect.objectContaining({ org_id: org.id, sub_admin_email: "leitung@pflegeheim-sonne.de" })]);
    expect(authUsers).toHaveLength(1);
    // the DIY settings: Borivon off, the free scope, the acceptance on record
    const fx = sqlite.prepare("SELECT * FROM fx_orgs").all() as Row[];
    expect(fx).toEqual([expect.objectContaining({ org_id: org.id, borivon_access: 0, nurse_limit: 5, user_limit: 2, terms_version: "2026-11-10" })]);
    // once per lead
    expect((await start.POST(post({ ...base, terms: true, avv: true }))).status).toBe(409);
    expect(T.organizations).toHaveLength(1);
  });

  it("an existing portal account is never taken over", async () => {
    authUsers.push({ id: "u-old", email: "leitung@pflegeheim-sonne.de" });
    const start = await import("../app/api/einrichtung/start/route");
    const t = await signLeadToken("platform", "lead-1");
    const r = await start.POST(post({ id: "lead-1", t, name: "Haus", password: "long-enough", terms: true, avv: true }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: "account_exists" });
    expect(T.organizations).toHaveLength(0);
    expect(T.sub_admins).toHaveLength(0);
  });

  it("hides a DIY facility's own nurses from Borivon until it switches Borivon on", async () => {
    const { fxDb } = await import("../lib/facility/db");
    const { hiddenFromBorivon, setBorivonAccess } = await import("../lib/facility/diy");
    const db = (await fxDb())!;
    await db.run(`INSERT INTO fx_orgs (org_id, borivon_access, created_at) VALUES ('org-diy', 0, ''), ('org-open', 1, '')`);
    T.candidate_organizations.push(
      { candidate_user_id: "n-diy", org_id: "org-diy", status: "approved" },
      { candidate_user_id: "n-pending", org_id: "org-diy", status: "pending" },
      { candidate_user_id: "n-open", org_id: "org-open", status: "approved" },
      { candidate_user_id: "n-calmaroi", org_id: "org-agency", status: "approved" },
    );
    let h = await hiddenFromBorivon();
    expect(h.ok).toBe(true);
    expect([...h.ids]).toEqual(["n-diy"]);
    await setBorivonAccess("org-diy", true);
    h = await hiddenFromBorivon();
    expect(h.ids.size).toBe(0);
  });

  it("a Borivon team member cannot act on a hidden nurse; the supreme admin can", async () => {
    const { fxDb } = await import("../lib/facility/db");
    const { canActOnCandidate } = await import("../lib/admin-auth");
    const db = (await fxDb())!;
    await db.run(`INSERT INTO fx_orgs (org_id, borivon_access, created_at) VALUES ('org-diy', 0, '')`);
    T.candidate_organizations.push({ candidate_user_id: "n-diy", org_id: "org-diy", status: "approved" });
    T.sub_admins.push({ email: "team@borivon.com", is_agency_admin: false });
    expect(await canActOnCandidate("sub_admin", "team@borivon.com", "n-diy")).toBe(false);
    expect(await canActOnCandidate("sub_admin", "team@borivon.com", "someone-else")).toBe(true);
    expect(await canActOnCandidate("admin", "founder@borivon.com", "n-diy")).toBe(true);
    // the facility's own admin (org-scoped) sees her
    T.sub_admins.push({ email: "leitung@sonne.de", is_agency_admin: true });
    T.organization_members.push({ org_id: "org-diy", sub_admin_email: "leitung@sonne.de" });
    expect(await canActOnCandidate("sub_admin", "leitung@sonne.de", "n-diy")).toBe(true);
    expect(await canActOnCandidate("sub_admin", "leitung@sonne.de", "someone-else")).toBe(false);
  });
});
