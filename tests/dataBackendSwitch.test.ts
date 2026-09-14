import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { dataBackend, servicePlan } from "@/lib/dataBackend";
import { buildServiceFetch, failClosedForData } from "@/lib/d1/serviceFetch";
import { hasSqlite, openDb, sqliteRunner } from "./helpers/sqliteD1";

/**
 * DATA_BACKEND — the one flip. What must hold:
 *   • default (and any typo) = Supabase, byte-for-byte the client the site has today;
 *   • "d1" = D1 answers /rest/v1 tables and RPC, while logins, storage and
 *     realtime still reach Supabase, and the browser's anon client never changes;
 *   • a D1-backed isolate that cannot reach D1 fails closed, never half-writes Supabase.
 * A fake network fetch shows exactly which backend each request reached.
 */

const SB = "https://p.supabase.co";

function network() {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(`${(init?.method ?? "GET").toUpperCase()} ${url.replace(SB, "")}`);
    return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, f };
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("servicePlan", () => {
  it("is null — plain fetch, today's client — with every flag at its default", () => {
    expect(servicePlan({}, false)).toBeNull();
    expect(servicePlan({ DATA_BACKEND: "supabase", SHADOW_D1_RATE: "0", MAINTENANCE_WRITES: "0" }, false)).toBeNull();
  });

  it("fails toward Supabase on anything but exactly \"d1\"", () => {
    for (const v of ["D1", "d1 ", " d1", "true", "cloudflare", ""]) expect(dataBackend({ DATA_BACKEND: v })).toBe("supabase");
    expect(dataBackend({ DATA_BACKEND: "d1" })).toBe("d1");
  });

  it("skips shadow reads on D1 — there is nothing left to compare against", () => {
    expect(servicePlan({ DATA_BACKEND: "d1", SHADOW_D1_RATE: "0.25" }, false)).toEqual({ backend: "d1", shadow: false, freeze: false });
    expect(servicePlan({ SHADOW_D1_RATE: "0.25" }, false)).toEqual({ backend: "supabase", shadow: true, freeze: false });
  });

  it("carries the freeze on either backend", () => {
    expect(servicePlan({ MAINTENANCE_WRITES: "1" }, false)).toEqual({ backend: "supabase", shadow: false, freeze: true });
    expect(servicePlan({ DATA_BACKEND: "d1", MAINTENANCE_WRITES: "1" }, false)).toEqual({ backend: "d1", shadow: false, freeze: true });
  });

  it("never gives the browser anything but the plain client", () => {
    expect(servicePlan({ DATA_BACKEND: "d1", SHADOW_D1_RATE: "1", MAINTENANCE_WRITES: "1" }, true)).toBeNull();
  });

  it("keeps lib/supabase.ts's static imports free of the adapter (it is in the browser bundle)", () => {
    const staticImports = (file: string) => [...fs.readFileSync(file, "utf8").matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(staticImports("lib/supabase.ts")).toEqual(["@supabase/supabase-js", "@/lib/dataBackend"]);
    expect(staticImports("lib/dataBackend.ts")).toEqual(["@/lib/maintenance"]);
    expect(staticImports("lib/maintenance.ts")).toEqual([]);
  });
});

describe("failClosedForData", () => {
  it("refuses a data request with PostgREST's own 'cannot connect' answer, and passes everything else", async () => {
    const net = network();
    const f = failClosedForData(net.f);
    const res = await f(`${SB}/rest/v1/documents?select=id`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "PGRST000" });
    await f(`${SB}/auth/v1/user`);
    await f(`${SB}/storage/v1/object/photos/a.jpg`);
    expect(net.calls).toEqual(["GET /auth/v1/user", "GET /storage/v1/object/photos/a.jpg"]);
  });
});

describe.skipIf(!hasSqlite)("buildServiceFetch: which backend each request reaches", () => {
  it("on d1: tables and RPC from D1, auth/storage/realtime to Supabase", async () => {
    const net = network();
    const sql: string[] = [];
    const runner = sqliteRunner(openDb({ schema: true }), (s) => sql.push(s));
    const f = buildServiceFetch({ backend: "d1", shadow: false, freeze: false }, { base: net.f, runner, journal: false });

    const read = await f(`${SB}/rest/v1/notifications?select=id`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual([]);
    const rpc = await f(`${SB}/rest/v1/rpc/rl_hit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_key: "k", p_window_ms: 1000 }) });
    expect(rpc.status).toBe(200);
    expect(sql.some((s) => /FROM\s+"notifications"/.test(s))).toBe(true);
    expect(sql.some((s) => /INSERT INTO "rate_limits"/.test(s))).toBe(true);
    expect(net.calls).toEqual([]);

    await f(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", body: "{}" });
    await f(`${SB}/storage/v1/object/photos/a.jpg`);
    await f(`${SB}/realtime/v1/api/broadcast`, { method: "POST", body: "{}" });
    expect(net.calls).toEqual(["POST /auth/v1/token?grant_type=password", "GET /storage/v1/object/photos/a.jpg", "POST /realtime/v1/api/broadcast"]);
  });

  it("on supabase: everything to Supabase, D1 untouched", async () => {
    const net = network();
    const sql: string[] = [];
    const runner = sqliteRunner(openDb({ schema: true }), (s) => sql.push(s));
    const f = buildServiceFetch({ backend: "supabase", shadow: false, freeze: false }, { base: net.f, runner });
    await f(`${SB}/rest/v1/notifications?select=id`);
    await f(`${SB}/rest/v1/notifications`, { method: "POST", body: "{}" });
    expect(net.calls).toEqual(["GET /rest/v1/notifications?select=id", "POST /rest/v1/notifications"]);
    expect(sql).toEqual([]);
  });
});

describe.skipIf(!hasSqlite)("lib/supabase.ts end to end", () => {
  async function load(env: Record<string, string>) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SB);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const net = network();
    vi.stubGlobal("fetch", net.f);
    const sql: string[] = [];
    const client = await import("@/lib/d1/client");
    client.setD1Runner(sqliteRunner(openDb({ schema: true }), (s) => sql.push(s)));
    const mod = await import("@/lib/supabase");
    return { ...mod, net, sql, reset: () => client.setD1Runner(null) };
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("DATA_BACKEND=d1: the service client reads D1; logins, storage and the anon client stay on Supabase", async () => {
    const s = await load({ DATA_BACKEND: "d1", SHADOW_D1_RATE: "1" });
    try {
      const svc = s.getServiceSupabase();
      const { data, error } = await svc.from("notifications").select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
      await settle();
      expect(s.sql.some((q) => /FROM\s+"notifications"/.test(q))).toBe(true);
      expect(s.net.calls).toEqual([]);                       // no Supabase data request, and no shadow read either

      await s.getAnonVerifyClient().auth.getUser("a.jwt.token");
      await svc.storage.from("photos").download("a.jpg");
      await s.supabase.from("notifications").select("id");  // the browser's anon client
      await s.getAuthSchemaClient().from("users").select("id");
      expect(s.net.calls).toEqual([
        "GET /auth/v1/user",
        "GET /storage/v1/object/photos/a.jpg",
        "GET /rest/v1/notifications?select=id",
        "GET /rest/v1/users?select=id",
      ]);
    } finally { s.reset(); }
  });

  it("default: the service client is plain Supabase and D1 is never asked", async () => {
    const s = await load({});
    try {
      await s.getServiceSupabase().from("notifications").select("id");
      await settle();
      expect(s.net.calls).toEqual(["GET /rest/v1/notifications?select=id"]);
      expect(s.sql).toEqual([]);
    } finally { s.reset(); }
  });
});
