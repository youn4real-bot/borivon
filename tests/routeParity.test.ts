/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { makeBvFetch } from "../lib/d1/bvFetch";
import { selectOnlyRunner, throwawayRunner, getOnlyFetch, LIVE_D1_ID, SCRATCH_D1_ID, type Attempt, type Runner } from "./helpers/readOnlyBackends";
import { CASES, type Prepared, type RouteCase } from "./helpers/routeParityCases";

/**
 * WHOLE-FEATURE READ PARITY — the real route handlers, run against both databases.
 *
 * Every GET handler in CASES is called twice with the same request, as the same
 * person: once with the service client on SUPABASE (which still holds the
 * pre-switch data) and once on LIVE D1 through the adapter. The JSON the user
 * would get must match; anything that differs and is not explained by the few
 * journaled writes since the switch is an adapter or semantics bug.
 *
 * READ-ONLY on both sides (tests/helpers/readOnlyBackends.ts, proven by
 * tests/routeParityGuards.test.ts):
 *   • Supabase: GET/HEAD only — every write, RPC, upload or broadcast throws.
 *   • live D1: a runner that refuses any statement that is not a SELECT.
 *   • the global fetch: GET/HEAD to Supabase only — Telegram, Google, Resend
 *     and everything else are refused, so a handler cannot send anything.
 *   • storage: a stub (R2 has no binding outside Workers); signed/public URLs
 *     are deterministic strings, uploads/removes are refused.
 * A GET handler that tries to write is RECORDED (result.attempts) — the write
 * fails identically on both sides, and the report lists it.
 *
 * Auth is impersonated, not minted: `Authorization: Bearer persona:<name>`, and
 * the verify client answers with that person's real auth user (read by id from
 * Supabase auth with a GET). No session, token or link is ever created.
 *
 * Each (case, backend) runs in a FRESH module graph (vi.resetModules), so no
 * module-level cache can carry one backend's answer into the other's run, and
 * Date is frozen to one instant for the whole run.
 *
 * Skipped unless RUN_ROUTE_PARITY=1:
 *   RUN_ROUTE_PARITY=1 npx vitest run tests/routeParity.test.ts
 * Optional: ROUTE_PARITY_ONLY=<regex on case id>, ROUTE_PARITY_OUT=<file>.
 */
const ENABLED = process.env.RUN_ROUTE_PARITY === "1";

/** "scratch" = the throwaway D1 copy, writable — only for GET handlers that write. */
type Backend = "supabase" | "d1" | "scratch";

type Harness = {
  backend: Backend;
  attempts: Attempt[];
  /** Data reads that reached the backend under test in the current run (proves D1 really answered). */
  reads: number;
  users: Map<string, User>;
  clients: Record<Backend, SupabaseClient<any, any, any>>;
  scratchRunner: Runner;
  authSchema: SupabaseClient<any, any, any>;
};

const H = () => (globalThis as any).__routeParity as Harness;

vi.mock("@/lib/supabase", () => {
  const verify = {
    auth: {
      async getUser(jwt?: string) {
        const user = (jwt && H().users.get(jwt)) || null;
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { name: "AuthApiError", status: 401, message: "invalid JWT" } };
      },
    },
  };
  const current = () => H().clients[H().backend];
  // The anon browser client: its auth answers like the verify client; anything
  // else a server route might do with it goes to the backend under test.
  const anon = new Proxy({}, { get: (_t, k) => (k === "auth" ? verify.auth : (current() as any)[k]) });
  return {
    supabase: anon,
    getServiceSupabase: () => current(),
    getAnonVerifyClient: () => verify,
    getAuthSchemaClient: () => H().authSchema,
  };
});

// The shared limiter is an RPC write (rl_hit); both sides would refuse it and
// fail open anyway. Allowing everything keeps it out of the write record.
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/rateLimit")>();
  const ok = { ok: true as const, remaining: 999, resetAt: 0 };
  return { ...orig, enforceRateLimit: () => ok, enforceUserRateLimit: async () => ok, enforceRateLimitDistributed: async () => ok };
});

function loadEnv() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  // Production's vars (wrangler.jsonc), so any code that branches on them takes the live path.
  process.env.DATA_BACKEND = "d1";
  process.env.STORAGE_BACKEND = "r2";
  process.env.MAINTENANCE_WRITES = "0";
  process.env.SHADOW_D1_RATE = "0";
  // Nothing outbound may be configured — belt and braces under the fetch guard.
  for (const k of ["TELEGRAM_BOT_TOKEN", "RESEND_API_KEY", "KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"]) delete process.env[k];
}

/** Storage stub: deterministic URLs, empty listings, refused writes. Identical on both sides. */
function stubStorage(attempts: () => Attempt[]) {
  const refuse = (what: string) => async () => {
    attempts().push({ kind: "fetch", what: `storage ${what}` });
    return { data: null, error: { name: "StorageError", message: "READ-ONLY GUARD: storage write refused" } };
  };
  const bucket = (b: string) => ({
    createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://storage.stub/sign/${b}/${p}` }, error: null }),
    createSignedUrls: async (ps: string[]) => ({ data: ps.map((p) => ({ path: p, signedUrl: `https://storage.stub/sign/${b}/${p}`, error: null })), error: null }),
    getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.stub/public/${b}/${p}` } }),
    download: async () => ({ data: null, error: { name: "StorageError", message: "storage stubbed: no R2 outside Workers", status: 404, statusCode: "404" } }),
    list: async () => ({ data: [], error: null }),
    exists: async () => ({ data: false, error: null }),
    info: async () => ({ data: null, error: { name: "StorageError", message: "storage stubbed" } }),
    upload: refuse(`upload ${b}`), update: refuse(`update ${b}`), remove: refuse(`remove ${b}`),
    move: refuse(`move ${b}`), copy: refuse(`copy ${b}`), createSignedUploadUrl: refuse(`signed-upload ${b}`),
    uploadToSignedUrl: refuse(`upload-signed ${b}`),
  });
  return { from: bucket };
}

function stubRealtime(client: any, attempts: () => Attempt[]) {
  client.channel = (name: string) => {
    const ch: any = {
      on: () => ch,
      subscribe: (cb?: (s: string) => void) => { cb?.("CLOSED"); return ch; },
      send: async () => { attempts().push({ kind: "fetch", what: `realtime send ${name}` }); return "error"; },
      unsubscribe: async () => "ok",
      httpSend: async () => { attempts().push({ kind: "fetch", what: `realtime send ${name}` }); return { success: false }; },
    };
    return ch;
  };
  client.removeChannel = async () => "ok";
  client.removeAllChannels = async () => [];
}

// ─── normalising answers ──────────────────────────────────────────────────────
type Answer = { status: number; type: string; location?: string; body: unknown; attempts: Attempt[]; reads: number; threw?: string; logs?: string[] };

async function readAnswer(res: Response | undefined): Promise<Omit<Answer, "attempts" | "reads">> {
  if (!res) return { status: -1, type: "none", body: null };
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const location = res.headers.get("location") ?? undefined;
  const buf = Buffer.from(await res.arrayBuffer());
  let body: unknown;
  if (type.includes("json")) {
    try { body = JSON.parse(buf.toString("utf8")); } catch { body = { $text: buf.toString("utf8").slice(0, 2000) }; }
  } else if (type.startsWith("text/") || type === "") {
    body = { $text: buf.toString("utf8") };
  } else {
    body = { $bytes: buf.length, $sha256: crypto.createHash("sha256").update(buf).digest("hex") };
  }
  return { status: res.status, type, location, body };
}

export type Diff = { path: string; supabase: unknown; d1: unknown };

/**
 * Structural diff, capped. Arrays of equal length compare index-wise; arrays of
 * different length report the rows only one side has (`[-]` Supabase only,
 * `[+]` D1 only) — one extra row would otherwise shift every index after it.
 * An order-only difference is detected separately (canon).
 */
function diff(a: unknown, b: unknown, at = "$", out: Diff[] = [], cap = 40): Diff[] {
  if (out.length >= cap) return out;
  if (Object.is(a, b)) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === b.length) {
      for (let i = 0; i < a.length; i++) diff(a[i], b[i], `${at}[${i}]`, out, cap);
      return out;
    }
    const ja = a.map((x) => JSON.stringify(x));
    const jb = b.map((x) => JSON.stringify(x));
    const left = [...jb];
    const onlyA: number[] = [];
    ja.forEach((j, i) => { const k = left.indexOf(j); if (k >= 0) left.splice(k, 1); else onlyA.push(i); });
    const right = [...ja];
    const onlyB: number[] = [];
    jb.forEach((j, i) => { const k = right.indexOf(j); if (k >= 0) right.splice(k, 1); else onlyB.push(i); });
    for (const i of onlyA) if (out.length < cap) out.push({ path: `${at}[-]`, supabase: a[i], d1: "<absent>" });
    for (const i of onlyB) if (out.length < cap) out.push({ path: `${at}[+]`, supabase: "<absent>", d1: b[i] });
    const keptA = ja.filter((_, i) => !onlyA.includes(i));
    const keptB = jb.filter((_, i) => !onlyB.includes(i));
    if (JSON.stringify(keptA) !== JSON.stringify(keptB)) out.push({ path: `${at}<order>`, supabase: `${a.length} rows`, d1: `${b.length} rows` });
    return out;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in (a as object))) out.push({ path: `${at}.${k}`, supabase: "<absent>", d1: (b as any)[k] });
      else if (!(k in (b as object))) out.push({ path: `${at}.${k}`, supabase: (a as any)[k], d1: "<absent>" });
      else diff((a as any)[k], (b as any)[k], `${at}.${k}`, out, cap);
    }
    return out;
  }
  out.push({ path: at, supabase: a, d1: b });
  return out;
}

/** Canonical form with every array sorted — equal canonical forms + unequal answers = an order-only difference. */
function canon(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canon).map((v) => JSON.stringify(v)).sort();
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon((x as any)[k])]));
  return x;
}

export type CaseResult = {
  id: string;
  supabase: Answer;
  d1: Answer;
  /** journaled = every difference sits in a row the live write journal touched since the switch. */
  verdict: "same" | "order-only" | "journaled" | "differs";
  diffs: Diff[];
};

/**
 * Ids and e-mails written to D1 since the switch (live `_write_journal` bodies).
 * Supabase never got those writes, so a row carrying one of them is EXPECTED to
 * differ. Only uuid- and e-mail-shaped values: a body's "de" or "general" must
 * not excuse every row that happens to hold the same word.
 */
const journalTokens = new Set<string>();
const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[^@\s]+@[^@\s]+)$/i;

function collectTokens(x: unknown): void {
  if (typeof x === "string") { if (TOKEN_RE.test(x)) journalTokens.add(x.toLowerCase()); return; }
  if (Array.isArray(x)) { x.forEach(collectTokens); return; }
  if (x && typeof x === "object") Object.values(x).forEach(collectTokens);
}

function carriesToken(o: unknown): boolean {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  return Object.values(o).some((v) => typeof v === "string" && journalTokens.has(v.toLowerCase()));
}

/** Does this difference sit inside (or is it) a row that carries a journaled id/e-mail? */
function touchesJournal(d: Diff, a: unknown, b: unknown): boolean {
  if (d.path.startsWith("$head")) return false;
  if (carriesToken(d.supabase) || carriesToken(d.d1)) return true; // a whole row only one side has
  const segs = [...d.path.slice(1).matchAll(/\.([^.[<]+)|\[(\d+|[+-])\]|<order>/g)].map((m) => m[1] ?? m[2] ?? "<order>");
  let xa: any = a, xb: any = b;
  for (const s of segs) {
    if (carriesToken(xa) || carriesToken(xb)) return true;
    if (s === "+" || s === "-" || s === "<order>") return false;
    xa = xa?.[s]; xb = xb?.[s];
  }
  return carriesToken(xa) || carriesToken(xb);
}

describe.skipIf(!ENABLED)("route handlers answer the same on Supabase and on live D1", () => {
  const results: CaseResult[] = [];
  const realFetch = globalThis.fetch;
  let outFile = "";

  beforeAll(async () => {
    loadEnv();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const attempts: Attempt[] = [];
    const guarded = getOnlyFetch(realFetch, url, attempts);
    // Auth is not under test (logins stay on Supabase on both backends), and a
    // burst of 35 getUserById calls from a workstation drops a few on connect
    // timeouts — a different few per run, which made the org admin's candidate
    // names differ between the two runs for no database reason. So every auth
    // GET is answered once (retried until it lands) and replayed to both sides.
    const authCache = new Map<string, Promise<{ status: number; headers: [string, string][]; body: string }>>();
    const authGet = (u: string, init?: RequestInit) => {
      let hit = authCache.get(u);
      if (!hit) {
        hit = (async () => {
          for (let attempt = 1; ; attempt++) {
            try {
              const r = await guarded(u, init);
              return { status: r.status, headers: [...r.headers.entries()], body: await r.text() };
            } catch (err) {
              if (attempt >= 5 || (err as Error).name === "ReadOnlyViolation") throw err;
              await new Promise((res) => setTimeout(res, 500 * attempt));
            }
          }
        })();
        authCache.set(u, hit);
        hit.catch(() => authCache.delete(u));
      }
      return hit.then((x) => new Response(x.status === 204 ? null : x.body, { status: x.status, headers: x.headers }));
    };
    const sbGet = ((input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (/\/auth\/v1\//.test(u) && method === "GET" && !(input instanceof Request)) return authGet(u, init);
      if (/\/rest\/v1\//.test(u) && (globalThis as any).__routeParity?.backend === "supabase") H().reads++;
      return guarded(input as RequestInfo, init);
    }) as typeof fetch;
    const opts = { auth: { persistSession: false, autoRefreshToken: false } };
    const liveRunner = selectOnlyRunner({
      send: realFetch,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
      token: process.env.CLOUDFLARE_API_TOKEN!,
      databaseId: LIVE_D1_ID,
      attempts,
    });
    const runner = { run: (sql: string, params?: unknown[]) => { if ((globalThis as any).__routeParity) H().reads++; return liveRunner.run(sql, params); } };
    const supa = createClient(url, key, { ...opts, global: { fetch: sbGet } });
    const d1 = createClient(url, key, { ...opts, global: { fetch: makeBvFetch({ runner, passthrough: sbGet }) } });
    const scratchRunner = throwawayRunner({
      send: realFetch,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
      token: process.env.CLOUDFLARE_API_TOKEN!,
      databaseId: SCRATCH_D1_ID,
    });
    const scratch = createClient(url, key, { ...opts, global: { fetch: makeBvFetch({ runner: scratchRunner, passthrough: sbGet }) } });
    const harness: Harness = {
      backend: "supabase",
      attempts,
      reads: 0,
      users: new Map(),
      clients: { supabase: supa, d1, scratch },
      scratchRunner,
      authSchema: createClient(url, key, { ...opts, db: { schema: "auth" }, global: { fetch: sbGet } }),
    };
    (globalThis as any).__routeParity = harness;
    for (const c of [supa, d1, scratch]) {
      (c as any).storage = stubStorage(() => H().attempts);
      stubRealtime(c, () => H().attempts);
    }

    // Personas → real auth users, read by id/email with GETs only.
    const { resolvePersonas } = await import("./helpers/routeParityCases");
    const personas = await resolvePersonas(supa);
    for (const [name, user] of Object.entries(personas)) harness.users.set(`persona:${name}`, user);

    // What D1 has that Supabase never got (SELECT only — the runner refuses anything else).
    const { results: journal } = await runner.run(`SELECT "path", "body" FROM "_write_journal"`);
    for (const row of journal) {
      try { collectTokens(JSON.parse(String(row.body ?? "null"))); } catch { /* split body: its parts are not needed for ids */ }
    }

    // Nothing a handler does may reach the network except a Supabase read.
    globalThis.fetch = getOnlyFetch(realFetch, url, attempts);
    // One frozen instant for the whole run: both sides see the same "now".
    vi.useFakeTimers({ toFake: ["Date"], now: Math.floor(Date.now() / 60_000) * 60_000 });

    outFile = process.env.ROUTE_PARITY_OUT || path.join(os.tmpdir(), `route-parity-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  }, 120_000);

  afterAll(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
    if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
    // eslint-disable-next-line no-console
    console.log(`[route-parity] ${results.length} cases → ${outFile}`);
  });

  async function runOnce(c: RouteCase, prep: Prepared, backend: Backend): Promise<Answer> {
    const h = H();
    h.backend = backend;
    h.attempts.length = 0;
    h.reads = 0;
    vi.resetModules();
    const mod = await import(/* @vite-ignore */ c.module);
    const handler = mod[c.method ?? "GET"];
    const headers = new Headers(c.headers ?? {});
    if (c.persona) headers.set("authorization", `Bearer persona:${c.persona}`);
    if (c.body !== undefined) headers.set("content-type", "application/json");
    const req = new NextRequest(new URL(prep.url ?? c.url, "https://www.borivon.com"), {
      method: c.method ?? "GET",
      headers,
      body: c.body === undefined ? undefined : JSON.stringify(c.body),
    });
    let res: Response | undefined;
    let threw: string | undefined;
    // What the handler logged (not compared — kept in the report to explain a 500).
    const logs: string[] = [];
    const keep = (...a: unknown[]) => { if (logs.length < 20) logs.push(a.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" ").slice(0, 300)); };
    const spies = [vi.spyOn(console, "error").mockImplementation(keep), vi.spyOn(console, "warn").mockImplementation(keep)];
    try {
      res = await handler(req, { params: Promise.resolve(prep.params ?? c.params ?? {}) });
    } catch (err) {
      threw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    } finally {
      spies.forEach((sp) => sp.mockRestore());
    }
    const answer = await readAnswer(res);
    return { ...answer, threw, attempts: [...h.attempts], reads: h.reads, logs };
  }

  const only = process.env.ROUTE_PARITY_ONLY;
  for (const c of CASES.filter((x) => !only || new RegExp(only).test(x.id))) {
    it(c.id, async () => {
      const prep = c.prepare ? await c.prepare(H().clients.supabase) : {};
      const a = await runOnce(c, prep, "supabase");
      const b = await runOnce(c, prep, "d1");
      const na = c.normalize ? c.normalize(a.body) : a.body;
      const nb = c.normalize ? c.normalize(b.body) : b.body;
      const head = (x: Answer) => ({ status: x.status, type: x.type, location: x.location, threw: x.threw });
      const ds = [...diff(head(a), head(b), "$head"), ...diff(na, nb)];
      let verdict: CaseResult["verdict"] = "same";
      if (ds.length) {
        verdict = JSON.stringify(canon(na)) === JSON.stringify(canon(nb)) && JSON.stringify(head(a)) === JSON.stringify(head(b)) ? "order-only"
          : (c.persona && journalTokens.has(H().users.get(`persona:${c.persona}`)?.id ?? "")) || ds.every((d) => touchesJournal(d, na, nb)) ? "journaled"
          : "differs";
      }
      results.push({ id: c.id, supabase: { ...a, body: na }, d1: { ...b, body: nb }, verdict, diffs: ds });
      // Shape sanity: a handler that 500s on both sides compares equal for the wrong reason.
      if (c.expectStatus !== undefined) expect(a.status, `${c.id} supabase status`).toBe(c.expectStatus);
    }, 600_000);
  }

  /**
   * GET handlers that WRITE (found by the write record above: the guards refused
   * them on both sides). Their writes are exercised here, on the THROWAWAY copy
   * only, for an invented person whose rows are deleted afterwards.
   */
  const DBG_CANDIDATE = "dbd0e5e0-0000-4000-8000-000000000001"; // invented: no auth user, no live rows
  const DBG_SELF = "dbd0e5e0-0000-4000-8000-000000000002";
  async function onScratch(module: string, url: string, persona: string): Promise<{ status: number; body: any }> {
    const h = H();
    h.backend = "scratch";
    vi.resetModules();
    try {
      const mod = await import(/* @vite-ignore */ module);
      const res: Response = await mod.GET(new NextRequest(new URL(url, "https://www.borivon.com"), { headers: { authorization: `Bearer persona:${persona}` } }), { params: Promise.resolve({}) });
      return { status: res.status, body: await res.json() };
    } finally {
      h.backend = "supabase";
    }
  }

  it.skipIf(!!only && !/throwaway/.test(only))("journey GET seeds the preset milestones on D1, once (throwaway copy)", async () => {
    const run = H().scratchRunner.run;
    try {
      const first = await onScratch("@/app/api/portal/journey/route", `/api/portal/journey?candidateId=${DBG_CANDIDATE}`, "admin");
      const second = await onScratch("@/app/api/portal/journey/route", `/api/portal/journey?candidateId=${DBG_CANDIDATE}`, "admin");
      const { JOURNEY_PRESETS } = await import("@/lib/candidateJourney");
      expect(first.status).toBe(200);
      expect(first.body.items.map((i: any) => i.preset_key).sort()).toEqual(JOURNEY_PRESETS.map((p: any) => p.key).sort());
      expect(second.body.items).toEqual(first.body.items); // ignoreDuplicates: the second seed changes nothing
      const { results } = await run(`SELECT count(*) AS n FROM "candidate_journey_items" WHERE "candidate_user_id" = ?`, [DBG_CANDIDATE]);
      expect(Number(results[0].n)).toBe(JOURNEY_PRESETS.length);
    } finally {
      await run(`DELETE FROM "candidate_journey_items" WHERE "candidate_user_id" = ?`, [DBG_CANDIDATE]);
    }
  }, 120_000);

  it.skipIf(!!only && !/throwaway/.test(only))("letter-data GET creates the missing profile stub on D1 (throwaway copy)", async () => {
    const run = H().scratchRunner.run;
    H().users.set("persona:dbg_self", {
      id: DBG_SELF, aud: "authenticated", app_metadata: {}, created_at: "2026-10-08T00:00:00Z",
      email: "dbg-routes-self@example.invalid", user_metadata: { first_name: "Dbg", last_name: "Routes" },
    } as unknown as User);
    try {
      const out = await onScratch("@/app/api/portal/me/letter-data/route", "/api/portal/me/letter-data", "dbg_self");
      expect(out.status).toBe(200);
      const { results } = await run(`SELECT "first_name", "last_name" FROM "candidate_profiles" WHERE "user_id" = ?`, [DBG_SELF]);
      expect(results).toEqual([{ first_name: "Dbg", last_name: "Routes" }]);
    } finally {
      await run(`DELETE FROM "candidate_profiles" WHERE "user_id" = ?`, [DBG_SELF]);
    }
  }, 120_000);

  it("summary: no unexplained differences", () => {
    const bad = results.filter((r) => (r.verdict === "differs" || r.verdict === "order-only") && !CASES.find((c) => c.id === r.id)?.expectedDiff);
    const writes = (r: CaseResult) => [...new Set([...r.supabase.attempts, ...r.d1.attempts].map((x) => x.what))];
    // eslint-disable-next-line no-console
    console.log(results.map((r) => `${r.verdict.padEnd(10)} ${String(r.supabase.status).padEnd(4)} ${`${r.supabase.reads}/${r.d1.reads}`.padEnd(8)} ${r.id}${writes(r).length ? `  [writes refused: ${writes(r).join(" | ")}]` : ""}`).join("\n"));
    expect(bad.map((r) => `${r.id}: ${r.diffs.slice(0, 3).map((d) => d.path).join(", ")}`)).toEqual([]);
  });
});
