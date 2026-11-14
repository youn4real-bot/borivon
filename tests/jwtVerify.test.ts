import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { createHmac } from "node:crypto";

/**
 * Local verification of Supabase access tokens (lib/jwtVerify.ts) and the auth
 * gate built on it (lib/authVerify.ts, lib/authRevoked.ts, lib/admin-auth.ts).
 *
 * Real ES256 keys are generated here and real tokens signed with them; the
 * JWKS endpoint is a mocked fetch, Supabase's auth.getUser (the fallback / the
 * background re-check) a mock, and D1 an in-memory SQLite (or a tiny fake on a
 * Node without node:sqlite). Nothing leaves the process.
 */

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  tables: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("@/lib/supabase", () => {
  const qb = (result: { data: unknown; error: unknown }) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "ilike", "eq", "in", "limit", "order"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve(result);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return b;
  };
  return {
    getAnonVerifyClient: () => ({ auth: { getUser: (...a: unknown[]) => h.getUser(...a) } }),
    getServiceSupabase: () => ({ from: (t: string) => qb(h.tables[t] ?? { data: [], error: null }) }),
    getAuthSchemaClient: () => ({}),
    supabase: {},
  };
});

import {
  verifySupabaseJwt,
  resetJwksCacheForTests,
  CLOCK_LEEWAY_SEC,
  JWKS_TTL_MS,
  JWKS_REFETCH_MIN_MS,
  JWKS_FAIL_BACKOFF_MS,
} from "@/lib/jwtVerify";
import {
  verifyAccessToken,
  getUserFromToken,
  settleAuthBackgroundForTests,
  resetAuthVerifyForTests,
  REVALIDATE_EVERY_MS,
} from "@/lib/authVerify";
import { isUserRevoked, revokeUserTokens, resetRevokedCacheForTests, NEGATIVE_TTL_MS } from "@/lib/authRevoked";
import { setD1Runner, type D1Runner, type D1Row } from "@/lib/d1/client";
import { requireAdminRole, requireUser } from "@/lib/admin-auth";

const SB = "https://proj.supabase.co";
const JWKS_URL = `${SB}/auth/v1/.well-known/jwks.json`;
const UID = "11111111-1111-4111-8111-111111111111";
const SID = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-11-14T10:00:00Z").getTime();

/* ── keys + tokens ─────────────────────────────────────────────────────────── */

type Signer = { kid: string; priv: CryptoKey; jwk: JsonWebKey & { kid: string } };
async function signer(kid: string): Promise<Signer> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  // exactly the shape Supabase publishes: kty/crv/x/y + ext + key_ops, plus kid/alg/use
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid, alg: "ES256", use: "sig" };
  return { kid, priv: kp.privateKey, jwk };
}
let A: Signer; // published
let B: Signer; // not published (until a "rotation")

const b64u = (v: string | Uint8Array) => Buffer.from(v).toString("base64url");
const nowSec = () => Math.floor(Date.now() / 1000);

function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: `${SB}/auth/v1`, sub: UID, aud: "authenticated", role: "authenticated",
    exp: nowSec() + 3600, iat: nowSec(), email: "Nurse@X.test", phone: "",
    session_id: SID, is_anonymous: false, aal: "aal1",
    user_metadata: { full_name: "Nurse X", first_name: "Nurse" }, app_metadata: { provider: "email" },
    ...over,
  };
}

async function mint(c: Record<string, unknown>, s: Signer = A, header: Record<string, unknown> = {}): Promise<string> {
  const hd = b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid: s.kid, ...header }));
  const pl = b64u(JSON.stringify(c));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, s.priv, new TextEncoder().encode(`${hd}.${pl}`)));
  return `${hd}.${pl}.${b64u(sig)}`;
}

/* ── the JWKS endpoint ─────────────────────────────────────────────────────── */

let published: JsonWebKey[] = [];
let jwksMode: "ok" | "down" | "500" = "ok";
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url !== JWKS_URL) throw new Error(`unexpected fetch ${url}`);
  if (jwksMode === "down") throw new TypeError("fetch failed");
  if (jwksMode === "500") return new Response("upstream error", { status: 500 });
  return new Response(JSON.stringify({ keys: published }), { status: 200, headers: { "content-type": "application/json" } });
});

/* ── D1: in-memory SQLite, else a fake that understands our three statements ─ */

type SqliteDb = { exec(sql: string): void; prepare(sql: string): { all(...a: unknown[]): D1Row[]; run(...a: unknown[]): unknown } };
let DatabaseSync: (new (path: string) => SqliteDb) | null = null;
try { ({ DatabaseSync } = (await import("node:sqlite")) as unknown as { DatabaseSync: new (path: string) => SqliteDb }); } catch { /* older Node */ }

function makeD1(): D1Runner & { hasTable(): Promise<boolean> } {
  if (DatabaseSync) {
    const db = new DatabaseSync(":memory:");
    const run: D1Runner["run"] = async (sql, params = []) => {
      const stmt = db.prepare(sql);
      if (/^\s*select\b/i.test(sql)) return { results: stmt.all(...params), meta: {} };
      stmt.run(...params);
      return { results: [], meta: {} };
    };
    return {
      run,
      async hasTable() {
        return (await run(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_revoked_users'`)).results.length === 1;
      },
    };
  }
  let table = false;
  const ids = new Set<string>();
  return {
    async run(sql, params = []) {
      const s = sql.trim();
      if (/^CREATE TABLE IF NOT EXISTS auth_revoked_users/i.test(s)) { table = true; return { results: [], meta: {} }; }
      if (!table) throw new Error("D1_ERROR: no such table: auth_revoked_users: SQLITE_ERROR");
      if (/^SELECT 1 AS hit FROM auth_revoked_users WHERE user_id = \?/i.test(s)) return { results: ids.has(String(params[0])) ? [{ hit: 1 }] : [], meta: {} };
      if (/^INSERT INTO auth_revoked_users/i.test(s)) { ids.add(String(params[0])); return { results: [], meta: {} }; }
      throw new Error(`fake D1: unexpected SQL ${s}`);
    },
    async hasTable() { return table; },
  };
}

const brokenD1: D1Runner = { run: async () => { throw new Error("D1_ERROR: Network connection lost."); } };

/* ── request helpers ───────────────────────────────────────────────────────── */

function req(token?: string) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === "authorization" && token !== undefined ? `Bearer ${token}` : null) },
  } as unknown as Parameters<typeof requireAdminRole>[0];
}

const liveUser = (over: Record<string, unknown> = {}) => ({
  data: { user: { id: UID, email: "nurse@x.test", user_metadata: {}, app_metadata: {}, ...over } },
  error: null,
});
const sessionMissing = () => ({
  data: { user: null },
  error: Object.assign(new Error("Auth session missing!"), { name: "AuthSessionMissingError", status: 400 }),
});

let d1: ReturnType<typeof makeD1>;

beforeAll(async () => {
  A = await signer("kid-a");
  B = await signer("kid-b");
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SB);
  vi.stubEnv("ADMIN_EMAIL", "admin@borivon.com");
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockClear();
  h.getUser.mockReset();
  h.getUser.mockResolvedValue(liveUser());
  h.tables = {};
  published = [A.jwk];
  jwksMode = "ok";
  resetJwksCacheForTests();
  resetRevokedCacheForTests();
  resetAuthVerifyForTests();
  d1 = makeD1();
  setD1Runner(d1);
});

afterEach(async () => {
  await settleAuthBackgroundForTests();
  setD1Runner(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ── lib/jwtVerify.ts ──────────────────────────────────────────────────────── */

describe("verifySupabaseJwt — a published ES256 key decides", () => {
  it("valid token → its claims, one JWKS fetch, then cached", async () => {
    const t = await mint(claims());
    const v = await verifySupabaseJwt(t);
    expect(v.kind).toBe("valid");
    if (v.kind !== "valid") return;
    expect(v.claims).toMatchObject({ sub: UID, email: "Nurse@X.test", session_id: SID, user_metadata: { full_name: "Nurse X" }, app_metadata: { provider: "email" } });
    expect((await verifySupabaseJwt(await mint(claims({ email: "other@x.test" })))).kind).toBe("valid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an aud ARRAY containing 'authenticated' is fine; a trailing slash on the env URL is ignored", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `${SB}/`);
    expect((await verifySupabaseJwt(await mint(claims({ aud: ["authenticated", "other"] })))).kind).toBe("valid");
  });

  it("expired → invalid; inside the clock leeway → still valid", async () => {
    expect(await verifySupabaseJwt(await mint(claims({ exp: nowSec() - CLOCK_LEEWAY_SEC - 1 })))).toEqual({ kind: "invalid", reason: "expired" });
    expect((await verifySupabaseJwt(await mint(claims({ exp: nowSec() - CLOCK_LEEWAY_SEC + 5 })))).kind).toBe("valid");
    expect((await verifySupabaseJwt(await mint(claims({ exp: undefined })))).kind).toBe("invalid");
  });

  it("wrong issuer → invalid", async () => {
    expect(await verifySupabaseJwt(await mint(claims({ iss: "https://evil.supabase.co/auth/v1" })))).toEqual({ kind: "invalid", reason: "issuer" });
    expect((await verifySupabaseJwt(await mint(claims({ iss: undefined })))).kind).toBe("invalid");
  });

  it("wrong audience → invalid", async () => {
    expect(await verifySupabaseJwt(await mint(claims({ aud: "anon" })))).toEqual({ kind: "invalid", reason: "audience" });
    expect((await verifySupabaseJwt(await mint(claims({ aud: ["service"] })))).kind).toBe("invalid");
    expect((await verifySupabaseJwt(await mint(claims({ aud: undefined })))).kind).toBe("invalid");
  });

  it("no subject → invalid; a role other than 'authenticated' → inconclusive (Supabase decides)", async () => {
    expect(await verifySupabaseJwt(await mint(claims({ sub: "" })))).toEqual({ kind: "invalid", reason: "no_sub" });
    expect(await verifySupabaseJwt(await mint(claims({ role: "service_role" })))).toEqual({ kind: "inconclusive", reason: "role" });
  });

  it("tampered payload (re-pointed at another user) → bad signature", async () => {
    const [hd, , sig] = (await mint(claims())).split(".");
    const forged = `${hd}.${b64u(JSON.stringify(claims({ sub: "99999999-9999-4999-8999-999999999999", email: "admin@borivon.com" })))}.${sig}`;
    expect(await verifySupabaseJwt(forged)).toEqual({ kind: "invalid", reason: "bad_signature" });
  });

  it("tampered / truncated / DER signature → invalid", async () => {
    const t = await mint(claims());
    const [hd, pl, sig] = t.split(".");
    const flipped = Buffer.from(sig, "base64url"); flipped[10] ^= 0xff;
    expect(await verifySupabaseJwt(`${hd}.${pl}.${b64u(flipped)}`)).toEqual({ kind: "invalid", reason: "bad_signature" });
    expect(await verifySupabaseJwt(`${hd}.${pl}.${sig.slice(0, 40)}`)).toEqual({ kind: "invalid", reason: "malformed_signature" });
    expect(await verifySupabaseJwt(`${hd}.${pl}.`)).toEqual({ kind: "invalid", reason: "malformed_signature" });
    expect(await verifySupabaseJwt(`${hd}.${pl}.${b64u(new Uint8Array(72))}`)).toEqual({ kind: "invalid", reason: "malformed_signature" });
  });

  it("a payload that is not JSON, signed by the real key → invalid (malformed)", async () => {
    const hd = b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid: A.kid }));
    const pl = b64u("not json");
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, A.priv, new TextEncoder().encode(`${hd}.${pl}`)));
    expect(await verifySupabaseJwt(`${hd}.${pl}.${b64u(sig)}`)).toEqual({ kind: "invalid", reason: "malformed_payload" });
  });

  it("alg none / HS256 / no kid / test stubs → inconclusive, the JWKS is never even fetched", async () => {
    const none = `${b64u(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64u(JSON.stringify(claims()))}.`;
    expect(await verifySupabaseJwt(none)).toEqual({ kind: "inconclusive", reason: "alg_not_es256" });
    const hsHead = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const hsBody = b64u(JSON.stringify(claims()));
    const hs = `${hsHead}.${hsBody}.${createHmac("sha256", "legacy-secret").update(`${hsHead}.${hsBody}`).digest("base64url")}`;
    expect(await verifySupabaseJwt(hs)).toEqual({ kind: "inconclusive", reason: "alg_not_es256" });
    expect((await verifySupabaseJwt(await mint(claims(), A, { kid: undefined }))).kind).toBe("inconclusive");
    expect((await verifySupabaseJwt(await mint(claims(), A, { crit: ["b64"] }))).kind).toBe("inconclusive");
    for (const stub of ["x", "stub-jwt", "persona:admin", "a.jwt.token", "", "a.b.c.d"]) {
      expect((await verifySupabaseJwt(stub)).kind, stub).toBe("inconclusive");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an ES256 token whose kid is not published → inconclusive (never 'valid' with a foreign key)", async () => {
    expect(await verifySupabaseJwt(await mint(claims(), B))).toEqual({ kind: "inconclusive", reason: "unknown_kid" });
  });

  it("concurrent first calls share ONE JWKS fetch", async () => {
    const t = await mint(claims());
    const all = await Promise.all(Array.from({ length: 8 }, () => verifySupabaseJwt(t)));
    expect(all.every((v) => v.kind === "valid")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the cached key set is refetched after its TTL", async () => {
    const t = await mint(claims({ exp: nowSec() + 7200 }));
    await verifySupabaseJwt(t);
    vi.setSystemTime(T0 + JWKS_TTL_MS - 1000);
    await verifySupabaseJwt(t);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + JWKS_TTL_MS + 1000);
    expect((await verifySupabaseJwt(t)).kind).toBe("valid");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a key published by a rotation is picked up by the one refetch", async () => {
    await verifySupabaseJwt(await mint(claims()));
    published = [A.jwk, B.jwk];
    vi.setSystemTime(T0 + JWKS_REFETCH_MIN_MS + 1000);
    expect((await verifySupabaseJwt(await mint(claims(), B))).kind).toBe("valid");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("only usable P-256 signing keys are trusted from the JWKS", async () => {
    published = [
      { ...A.jwk, use: "enc" },
      { ...B.jwk, alg: "RS256" },
      { kty: "oct", k: "c2VjcmV0", kid: "kid-hs" },
    ] as JsonWebKey[];
    expect((await verifySupabaseJwt(await mint(claims(), A))).kind).toBe("inconclusive");
    expect((await verifySupabaseJwt(await mint(claims(), B))).kind).toBe("inconclusive");
  });
});

/* ── lib/authVerify.ts + lib/admin-auth.ts ─────────────────────────────────── */

describe("verifyAccessToken / requireUser / requireAdminRole", () => {
  it("valid token → the user from its claims, WITHOUT waiting on Supabase", async () => {
    let release: (v: unknown) => void = () => {};
    h.getUser.mockImplementation(() => new Promise((r) => { release = r; })); // Supabase hangs
    const t = await mint(claims());
    const v = await verifyAccessToken(t);
    expect(v).toMatchObject({ ok: true, via: "local", user: { id: UID, email: "Nurse@X.test", user_metadata: { full_name: "Nurse X" } } });
    expect(await requireUser(req(t))).toEqual({ ok: true, userId: UID, email: "nurse@x.test", jwt: t });
    release(liveUser()); // the background re-check may now finish
  });

  it("requireAdminRole: role resolution is unchanged (admin email → admin, others → sub_admins lookup)", async () => {
    const admin = await mint(claims({ email: "admin@borivon.com", sub: "33333333-3333-4333-8333-333333333333", session_id: "s-admin" }));
    expect(await requireAdminRole(req(admin))).toMatchObject({ ok: true, role: "admin", userId: "33333333-3333-4333-8333-333333333333" });
    h.tables.sub_admins = { data: [{ email: "nurse@x.test", agency_id: "ag1", is_agency_admin: true }], error: null };
    expect(await requireAdminRole(req(await mint(claims())))).toMatchObject({ ok: true, role: "sub_admin", agencyId: "ag1", isAgencyAdmin: true, userId: UID });
    h.tables.sub_admins = { data: [], error: null };
    expect(await requireAdminRole(req(await mint(claims())))).toMatchObject({ ok: false, status: 403 });
    expect(await requireAdminRole(req(await mint(claims({ email: "" }))))).toMatchObject({ ok: false, status: 401, error: "User has no email" });
  });

  it("expired / wrong iss / wrong aud / tampered → 401 straight away, Supabase is never asked", async () => {
    const good = await mint(claims());
    const [hd, , sig] = good.split(".");
    const bad = [
      await mint(claims({ exp: nowSec() - 3600 })),
      await mint(claims({ iss: "https://other.supabase.co/auth/v1" })),
      await mint(claims({ aud: "anon" })),
      `${hd}.${b64u(JSON.stringify(claims({ email: "admin@borivon.com" })))}.${sig}`,
    ];
    for (const t of bad) {
      expect(await verifyAccessToken(t)).toEqual({ ok: false, error: "Invalid token" });
      expect(await requireAdminRole(req(t))).toMatchObject({ ok: false, status: 401, error: "Invalid token" });
    }
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("alg none → falls back to Supabase, which refuses it", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT", status: 403 } });
    const none = `${b64u(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64u(JSON.stringify(claims()))}.`;
    expect(await requireUser(req(none))).toMatchObject({ ok: false, status: 401, error: "Invalid token" });
    expect(h.getUser).toHaveBeenCalledWith(none);
  });

  it("legacy HS256 token → falls back to Supabase (its answer decides, incl. the soft-delete gate)", async () => {
    const hsHead = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const hsBody = b64u(JSON.stringify(claims()));
    const hs = `${hsHead}.${hsBody}.${createHmac("sha256", "legacy-secret").update(`${hsHead}.${hsBody}`).digest("base64url")}`;
    expect(await verifyAccessToken(hs)).toMatchObject({ ok: true, via: "supabase", user: { id: UID } });
    expect(h.getUser).toHaveBeenCalledWith(hs);
    h.getUser.mockResolvedValue(liveUser({ user_metadata: { deleted: true } }));
    expect(await requireUser(req(hs))).toMatchObject({ ok: false, status: 401, error: "Account disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unknown kid → ONE refetch of the key set, then the Supabase fallback", async () => {
    await verifyAccessToken(await mint(claims()));                 // key set cached (fetch #1)
    await settleAuthBackgroundForTests();
    h.getUser.mockClear();
    vi.setSystemTime(T0 + JWKS_REFETCH_MIN_MS + 1000);             // our copy is now old enough to refetch
    const foreign = await mint(claims(), B);
    expect(await verifyAccessToken(foreign)).toMatchObject({ ok: true, via: "supabase" });
    expect(fetchMock).toHaveBeenCalledTimes(2);                    // exactly one refetch
    expect(h.getUser).toHaveBeenCalledWith(foreign);
    // a flood of unknown kids cannot hammer the endpoint: no more refetches for a while
    for (let i = 0; i < 5; i++) await verifyAccessToken(await mint(claims(), B, { kid: `random-${i}` }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("unknown kid on a just-fetched key set → no pointless second fetch, straight to the fallback", async () => {
    const foreign = await mint(claims(), B);
    expect(await verifyAccessToken(foreign)).toMatchObject({ ok: true, via: "supabase" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.getUser).toHaveBeenCalledWith(foreign);
  });

  it("JWKS unreachable (network error or 5xx) → the Supabase fallback; retried only after a backoff", async () => {
    jwksMode = "down";
    const t = await mint(claims());
    expect(await verifyAccessToken(t)).toMatchObject({ ok: true, via: "supabase" });
    expect(h.getUser).toHaveBeenCalledWith(t);
    expect(await verifyAccessToken(t)).toMatchObject({ ok: true, via: "supabase" });
    expect(fetchMock).toHaveBeenCalledTimes(1);                    // backoff: not retried on every request
    jwksMode = "500";
    vi.setSystemTime(T0 + JWKS_FAIL_BACKOFF_MS + 1000);
    expect(await verifyAccessToken(t)).toMatchObject({ ok: true, via: "supabase" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jwksMode = "ok";
    vi.setSystemTime(T0 + 2 * JWKS_FAIL_BACKOFF_MS + 2000);
    expect(await verifyAccessToken(t)).toMatchObject({ ok: true, via: "local" });
  });

  it("a fallback failure stays a 401 (Supabase says no → no)", async () => {
    jwksMode = "down";
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: "User from sub claim in JWT does not exist", status: 403, code: "user_not_found" } });
    expect(await requireUser(req(await mint(claims())))).toMatchObject({ ok: false, status: 401, error: "Invalid token" });
  });

  it("test stubs keep the old path (every existing route test relies on it)", async () => {
    expect(await requireUser(req("stub-jwt"))).toMatchObject({ ok: true, userId: UID, email: "nurse@x.test" });
    expect(h.getUser).toHaveBeenCalledWith("stub-jwt");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("soft-delete flags inside the claims → 401 'Account disabled'", async () => {
    expect(await requireUser(req(await mint(claims({ user_metadata: { deleted: true } }))))).toMatchObject({ ok: false, status: 401, error: "Account disabled" });
    expect(await requireUser(req(await mint(claims({ email: `deleted+${UID}@borivon.invalid` }))))).toMatchObject({ ok: false, status: 401, error: "Account disabled" });
  });

  it("getUserFromToken keeps the auth.getUser({ data: { user }, error }) shape", async () => {
    const ok = await getUserFromToken(await mint(claims()));
    expect(ok.error).toBeNull();
    expect(ok.data.user).toMatchObject({ id: UID, email: "Nurse@X.test", user_metadata: { first_name: "Nurse" } });
    const bad = await getUserFromToken(await mint(claims({ exp: nowSec() - 3600 })));
    expect(bad).toEqual({ data: { user: null }, error: { message: "Invalid token", status: 401 } });
  });
});

/* ── deleted = gone everywhere (lib/authRevoked.ts) ────────────────────────── */

describe("revoked list — a deleted user's still-valid token is refused", () => {
  it("revoked user id → 401 'Account disabled', without asking Supabase", async () => {
    const t = await mint(claims());
    expect(await revokeUserTokens(UID, "delete-user")).toEqual({ ok: true, stored: true });
    h.getUser.mockClear();
    expect(await requireUser(req(t))).toEqual({ ok: false, status: 401, error: "Account disabled" });
    expect(await requireAdminRole(req(t))).toMatchObject({ ok: false, status: 401, error: "Account disabled" });
    expect((await getUserFromToken(t)).error).toEqual({ message: "Account disabled", status: 401 });
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("another isolate's delete reaches this one through D1 (one indexed read)", async () => {
    await revokeUserTokens(UID, "delete-user");
    resetRevokedCacheForTests();                                   // = an isolate that never saw the delete
    expect(await requireUser(req(await mint(claims())))).toMatchObject({ ok: false, status: 401, error: "Account disabled" });
    expect(await isUserRevoked("44444444-4444-4444-8444-444444444444")).toBe(false);
  });

  it("'not listed' is cached per isolate for NEGATIVE_TTL_MS only", async () => {
    const t = await mint(claims({ exp: nowSec() + 7200 }));
    expect(await requireUser(req(t))).toMatchObject({ ok: true });
    // the delete runs in ANOTHER isolate: D1 has the row, this isolate's cache does not
    await d1.run(`INSERT INTO auth_revoked_users (user_id, revoked_at, reason) VALUES (?, ?, ?)`, [UID, new Date().toISOString(), "elsewhere"]);
    vi.setSystemTime(T0 + NEGATIVE_TTL_MS - 1000);
    expect(await requireUser(req(t))).toMatchObject({ ok: true });  // bounded window
    vi.setSystemTime(T0 + NEGATIVE_TTL_MS + 1000);
    expect(await requireUser(req(t))).toMatchObject({ ok: false, status: 401, error: "Account disabled" });
  });

  it("no table yet = nobody listed; the lookup creates it", async () => {
    expect(await d1.hasTable()).toBe(false);
    expect(await verifyAccessToken(await mint(claims()))).toMatchObject({ ok: true, via: "local" });
    expect(await d1.hasTable()).toBe(true);
  });

  it("D1 unreadable → neither locked out nor let in blindly: Supabase decides", async () => {
    setD1Runner(brokenD1);
    const t = await mint(claims());
    expect(await verifyAccessToken(t)).toMatchObject({ ok: true, via: "supabase" });
    expect(h.getUser).toHaveBeenCalledWith(t);
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: "User from sub claim in JWT does not exist", status: 403, code: "user_not_found" } });
    expect(await requireUser(req(t))).toMatchObject({ ok: false, status: 401 });
  });

  it("revokeUserTokens fails loudly when D1 refuses the write (the delete must stop)", async () => {
    setD1Runner(brokenD1);
    expect(await revokeUserTokens(UID, "delete-user")).toEqual({ ok: false, error: "D1_ERROR: Network connection lost." });
  });

  it("a re-registration (new user id) is not affected", async () => {
    await revokeUserTokens(UID, "delete-user");
    const fresh = await mint(claims({ sub: "55555555-5555-4555-8555-555555555555", session_id: "s-new" }));
    expect(await requireUser(req(fresh))).toMatchObject({ ok: true, userId: "55555555-5555-4555-8555-555555555555" });
  });

  it("both delete paths revoke BEFORE anything is removed, and stop if that fails", () => {
    const route = fs.readFileSync("app/api/portal/admin/delete-user/route.ts", "utf8");
    const revokeAt = route.indexOf('await revokeUserTokens(userId, "delete-user")');
    expect(revokeAt).toBeGreaterThan(-1);
    for (const step of ["drive.files.update(", "await deleteUserStorage(db, userId)", "await deleteAuthLinkedRows(db, userId)", 'db.rpc("app_delete_user"', "db.auth.admin.deleteUser(userId)", "db.auth.admin.updateUserById(userId"]) {
      const at = route.indexOf(step);
      expect(at, step).toBeGreaterThan(revokeAt);
    }
    expect(route.slice(revokeAt, revokeAt + 400)).toMatch(/if \(!revoked\.ok\)[\s\S]*status: 500/);

    const bot = fs.readFileSync("lib/assistantWrites.ts", "utf8");
    const fn = bot.slice(bot.indexOf("async function writeDeleteCandidate"));
    const botRevoke = fn.indexOf('revokeUserTokens(userId, "bot-delete")');
    expect(botRevoke).toBeGreaterThan(-1);
    for (const step of ["collectUserStorage(db, userId)", "deleteAuthLinkedRows(db, userId)", 'db.rpc("app_delete_user"']) {
      expect(fn.indexOf(step), step).toBeGreaterThan(botRevoke);
    }
    expect(fn.slice(botRevoke - 20, botRevoke + 80)).toMatch(/if \(!\(await revokeUserTokens\(userId, "bot-delete"\)\)\.ok\) return \{ ok: false/);
  });
});

/* ── what only Supabase knows: the background re-check ────────────────────── */

describe("background re-check (signed out / banned / deleted outside the portal)", () => {
  it("Supabase says the session is gone → this isolate refuses it from the next request on", async () => {
    h.getUser.mockResolvedValue(sessionMissing());
    const t = await mint(claims());
    expect(await verifyAccessToken(t)).toMatchObject({ ok: true, via: "local" }); // the one request in flight
    await settleAuthBackgroundForTests();
    expect(h.getUser).toHaveBeenCalledWith(t);
    expect(await verifyAccessToken(t)).toEqual({ ok: false, error: "Invalid token" });
    // a refreshed token of the SAME session is refused too; a new login (new session) is not
    expect(await verifyAccessToken(await mint(claims({ iat: nowSec() + 1 })))).toEqual({ ok: false, error: "Invalid token" });
    expect(await verifyAccessToken(await mint(claims({ session_id: "33333333-0000-4000-8000-000000000000" })))).toMatchObject({ ok: true });
  });

  it("deleted in the Supabase dashboard (user_not_found) or soft-deleted → refused after the re-check", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: Object.assign(new Error("User from sub claim in JWT does not exist"), { name: "AuthApiError", status: 403, code: "user_not_found" }) });
    const t1 = await mint(claims({ session_id: "s-1" }));
    await verifyAccessToken(t1);
    await settleAuthBackgroundForTests();
    expect(await verifyAccessToken(t1)).toEqual({ ok: false, error: "Invalid token" });

    h.getUser.mockResolvedValue(liveUser({ banned_until: new Date(T0 + 1e9).toISOString() }));
    const t2 = await mint(claims({ session_id: "s-2" }));
    await verifyAccessToken(t2);
    await settleAuthBackgroundForTests();
    expect(await verifyAccessToken(t2)).toEqual({ ok: false, error: "Account disabled" });
  });

  it("a blip, a 5xx or 'expired' inside our leeway is NOT a revocation", async () => {
    const t = await mint(claims());
    for (const answer of [
      { data: { user: null }, error: Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 }) },
      { data: { user: null }, error: Object.assign(new Error("token is expired"), { name: "AuthApiError", status: 403, code: "bad_jwt" }) },
    ]) {
      resetAuthVerifyForTests();
      h.getUser.mockResolvedValue(answer);
      await verifyAccessToken(t);
      await settleAuthBackgroundForTests();
      expect(await verifyAccessToken(t)).toMatchObject({ ok: true, via: "local" });
    }
    resetAuthVerifyForTests();
    h.getUser.mockRejectedValue(new Error("boom"));
    await verifyAccessToken(t);
    await settleAuthBackgroundForTests();
    expect(await verifyAccessToken(t)).toMatchObject({ ok: true, via: "local" });
  });

  it("runs at most once per session per REVALIDATE_EVERY_MS", async () => {
    const t = await mint(claims({ exp: nowSec() + 7200 }));
    for (let i = 0; i < 5; i++) await verifyAccessToken(t);
    await settleAuthBackgroundForTests();
    expect(h.getUser).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + REVALIDATE_EVERY_MS + 1000);
    await verifyAccessToken(t);
    await settleAuthBackgroundForTests();
    expect(h.getUser).toHaveBeenCalledTimes(2);
  });
});
