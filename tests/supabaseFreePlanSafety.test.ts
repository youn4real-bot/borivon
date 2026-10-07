import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";

/**
 * The Supabase Free-plan safety net: a daily keep-alive query and an encrypted
 * backup of the login accounts.
 *
 * The failure that matters most is invisible: with DATA_BACKEND="d1" the service
 * client answers from D1, so a keep-alive built on it would report "ok" every day
 * while Supabase slid into a pause, and one morning no candidate could log in.
 * The first test runs with DATA_BACKEND="d1", the service client and the D1
 * adapter rigged to throw, and the real global fetch replaced — and requires the
 * query to arrive at Supabase's own URL.
 *
 * No network: Supabase and R2 are fakes.
 */

const seen = vi.hoisted(() => ({ service: 0, adapter: 0 }));
vi.mock("@/lib/supabase", () => {
  const refuse = () => { seen.service++; throw new Error("the service client answers from D1 on DATA_BACKEND=d1"); };
  return { supabase: {}, getServiceSupabase: refuse, getAnonVerifyClient: refuse, getAuthSchemaClient: refuse };
});
vi.mock("@/lib/d1/serviceFetch", () => ({ buildServiceFetch: () => { seen.adapter++; throw new Error("D1 adapter"); } }));
vi.mock("@/lib/d1/bvFetch", () => ({ makeBvFetch: () => { seen.adapter++; throw new Error("D1 adapter"); } }));

import {
  runSupabaseFreePlanSafety,
  BACKUP_PREFIX,
  type BackupStore,
  type SafetyDeps,
} from "@/lib/supabaseFreePlanSafety";
import { decryptAuthBackup } from "../d1/decrypt-auth-backup.mjs";

const KEY = crypto.randomBytes(32).toString("base64");
const SB = { NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", DATA_BACKEND: "d1" };
const NOW = new Date("2026-09-15T06:00:03Z");

type Account = { id: string; email: string; encrypted_password: string; identities: unknown[] };
const ACCOUNTS: Account[] = [5, 3, 1, 4, 2].map((n) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  email: `person${n}@example.test`,
  encrypted_password: `$2a$10$${String(n).repeat(53)}`,
  identities: [{ provider: "email" }],
}));

function fakeSupabase(accounts: Account[], opts: { missingFunction?: boolean; total?: number; keepAlive?: "down" | "reject" } = {}) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const sorted = [...accounts].sort((a, b) => (a.id < b.id ? -1 : 1));
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const u = new URL(url);
    if (u.origin !== "https://proj.supabase.co") throw new Error(`request left Supabase: ${url}`);
    if (u.pathname === "/rest/v1/app_settings") {
      if (opts.keepAlive === "reject") throw new TypeError("fetch failed");
      if (opts.keepAlive === "down") return new Response(null, { status: 503 });
      return new Response(null, { status: 200, headers: { "content-range": "0-2/3" } });
    }
    if (u.pathname === "/rest/v1/rpc/bv_auth_users_backup_page") {
      if (method !== "GET") throw new Error("Supabase is read-only: the export must be a GET");
      if (opts.missingFunction) {
        return Response.json({ code: "PGRST202", message: "Could not find the function public.bv_auth_users_backup_page(page_size) in the schema cache" }, { status: 404 });
      }
      const after = u.searchParams.get("after_id");
      const size = Number(u.searchParams.get("page_size"));
      return Response.json({ total: opts.total ?? sorted.length, users: sorted.filter((a) => !after || a.id > after).slice(0, size) });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  }) as typeof fetch;
  return { calls, f };
}

function memStore(keys: string[] = [], opts: { failPut?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>(keys.map((k) => [k, new Uint8Array([1])]));
  const deleted: string[] = [];
  const state = { opened: 0 };
  const store: BackupStore = {
    async put(key, body) {
      if (opts.failPut) throw new Error("R2 put failed");
      objects.set(key, body);
    },
    async list(prefix) { return [...objects.keys()].filter((k) => k.startsWith(prefix)); },
    async delete(key) { deleted.push(key); objects.delete(key); },
  };
  return { objects, deleted, state, factory: async () => { state.opened++; return store; } };
}

function capture(opts: { alertThrows?: boolean } = {}) {
  const lines: string[] = [];
  const push = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  const alerts: { title: string; detail: string; advice: string }[] = [];
  return {
    lines,
    alerts,
    log: { log: push, warn: push, error: push } as unknown as SafetyDeps["log"],
    alert: async (title: string, detail: string, advice: string) => {
      alerts.push({ title, detail, advice });
      if (opts.alertThrows) throw new Error("telegram down");
    },
  };
}

function day(offset: number): string {
  return new Date(NOW.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DATA_BACKEND;
});

describe("keep-alive", () => {
  it("with DATA_BACKEND=d1 it still reaches Supabase's Postgres, never the service client or D1", async () => {
    process.env.DATA_BACKEND = "d1";
    const sb = fakeSupabase(ACCOUNTS);
    vi.stubGlobal("fetch", sb.f); // the production default: no fetch injected below
    const c = capture();
    const st = memStore();

    const summary = await runSupabaseFreePlanSafety({ env: { ...SB }, store: st.factory, alert: c.alert, log: c.log, now: () => NOW });

    expect(summary).toEqual({ keepAlive: "ok", backup: "skipped" });
    expect(sb.calls).toHaveLength(1);
    expect(sb.calls[0]).toMatchObject({ url: "https://proj.supabase.co/rest/v1/app_settings?select=key", method: "HEAD" });
    expect(sb.calls[0].headers).toMatchObject({ apikey: "service-key", authorization: "Bearer service-key", prefer: "count=exact" });
    expect(seen).toEqual({ service: 0, adapter: 0 });
    expect(c.lines).toContain("[supabase-keepalive] ok (app_settings rows=3)");
    expect(c.alerts).toEqual([]);
  });

  it("cannot be rewired onto the service client: the module imports nothing from lib/supabase or lib/d1", () => {
    for (const file of ["lib/supabaseFreePlanSafety.ts", "lib/authBackupCrypto.ts"]) {
      const src = fs.readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/["']@\/lib\/supabase["']/);
      expect(src, file).not.toMatch(/["']@\/lib\/d1\//);
    }
  });

  it("its ok lines survive production: removeConsole strips console.log, so they go out as warn", () => {
    const src = fs.readFileSync("lib/supabaseFreePlanSafety.ts", "utf8");
    expect(src).toMatch(/log\.warn\(`\[supabase-keepalive\] ok/);
    expect(src).toMatch(/log\.warn\(`\[auth-backup\] ok/);
    expect(src).not.toMatch(/log\.log\(/);
  });

  it("a dead Supabase is alerted, and neither that nor a broken alerter throws out of the cron", async () => {
    for (const mode of ["down", "reject"] as const) {
      const sb = fakeSupabase(ACCOUNTS, { keepAlive: mode });
      const c = capture({ alertThrows: true });
      const summary = await runSupabaseFreePlanSafety({ env: { ...SB }, fetch: sb.f, store: memStore().factory, alert: c.alert, log: c.log });
      expect(summary.keepAlive).toBe("failed");
      expect(c.alerts.map((a) => a.title)).toEqual(["Supabase keep-alive failed"]);
      expect(c.alerts[0].detail).toBe(mode === "down" ? "HTTP 503" : "fetch failed");
      expect(c.alerts[0].advice).toMatch(/paused/);
      expect(c.lines.some((l) => l.startsWith("[supabase-safety] alert failed"))).toBe(true);
    }
  });

  it("missing Supabase credentials are a failure, not a silent pass", async () => {
    const c = capture();
    const summary = await runSupabaseFreePlanSafety({ env: {}, fetch: fakeSupabase(ACCOUNTS).f, store: memStore().factory, alert: c.alert, log: c.log });
    expect(summary.keepAlive).toBe("failed");
    expect(c.alerts[0].detail).toMatch(/SUPABASE_SERVICE_ROLE_KEY is missing/);
  });

  it("even a crash inside the pass resolves instead of throwing out of the cron", async () => {
    const sb = fakeSupabase(ACCOUNTS);
    const summary = await runSupabaseFreePlanSafety({ env: null as unknown as SafetyDeps["env"], fetch: sb.f, log: capture().log });
    expect(summary).toEqual({ keepAlive: "failed", backup: "failed" });
    expect(sb.calls).toEqual([]);
  });
});

describe("login backup", () => {
  it("without AUTH_BACKUP_KEY: skipped with one warning, nothing read, nothing written, nobody alerted", async () => {
    const sb = fakeSupabase(ACCOUNTS);
    const st = memStore();
    const c = capture();
    const summary = await runSupabaseFreePlanSafety({ env: { ...SB }, fetch: sb.f, store: st.factory, alert: c.alert, log: c.log });
    expect(summary).toEqual({ keepAlive: "ok", backup: "skipped" });
    expect(sb.calls.filter((x) => x.url.includes("/rpc/"))).toEqual([]);
    expect(st.state.opened).toBe(0);
    expect(c.lines.filter((l) => l.includes("AUTH_BACKUP_KEY"))).toEqual(["[auth-backup] AUTH_BACKUP_KEY is not set: login backup skipped"]);
    expect(c.alerts).toEqual([]);
  });

  it("a malformed key refuses to run, loudly, without echoing the key", async () => {
    for (const bad of ["hunter2", crypto.randomBytes(32).toString("hex"), crypto.randomBytes(31).toString("base64"), crypto.randomBytes(32).toString("base64url")]) {
      const sb = fakeSupabase(ACCOUNTS);
      const st = memStore();
      const c = capture();
      const summary = await runSupabaseFreePlanSafety({ env: { ...SB, AUTH_BACKUP_KEY: bad }, fetch: sb.f, store: st.factory, alert: c.alert, log: c.log });
      expect(summary.backup).toBe("failed");
      expect(c.alerts.map((a) => a.title)).toEqual(["Login backup failed"]);
      expect(c.alerts[0].detail).toMatch(/malformed/);
      expect(sb.calls.filter((x) => x.url.includes("/rpc/"))).toEqual([]);
      expect(st.state.opened).toBe(0);
      expect(JSON.stringify([c.lines, c.alerts])).not.toContain(bad);
    }
  });

  it("with a key: every account exported over GET pages, sealed, written under today's date, the newest 30 kept", async () => {
    const sb = fakeSupabase(ACCOUNTS);
    const older = Array.from({ length: 35 }, (_, i) => `${BACKUP_PREFIX}${day(i + 1)}.json.enc`);
    const foreign = `${BACKUP_PREFIX}README.txt`;
    const st = memStore([...older, foreign]);
    const c = capture();

    const summary = await runSupabaseFreePlanSafety({
      env: { ...SB, AUTH_BACKUP_KEY: KEY }, fetch: sb.f, store: st.factory, alert: c.alert, log: c.log, now: () => NOW, pageSize: 2,
    });

    expect(summary).toEqual({ keepAlive: "ok", backup: "written" });
    expect(c.alerts).toEqual([]);
    // Three pages of two (the last one short), each continuing after the previous page's last id.
    const rpc = sb.calls.filter((x) => x.url.includes("/rpc/"));
    expect(rpc.map((x) => x.method)).toEqual(["GET", "GET", "GET"]);
    expect(rpc.map((x) => new URL(x.url).searchParams.get("after_id"))).toEqual([null, ACCOUNTS[4].id, ACCOUNTS[3].id]);

    const todayKey = `${BACKUP_PREFIX}2026-09-15.json.enc`;
    const sealed = st.objects.get(todayKey)!;
    expect(sealed).toBeDefined();
    // Sealed: no email or hash readable in the stored bytes.
    const asText = Buffer.from(sealed).toString("latin1");
    expect(asText).not.toContain("example.test");
    expect(asText).not.toContain("$2a$");

    const doc = JSON.parse(await decryptAuthBackup(sealed, KEY));
    expect(doc).toMatchObject({ format: "borivon-auth-users", version: 1, exported_at: NOW.toISOString(), supabase_host: "proj.supabase.co", accounts: 5 });
    expect(doc.users.map((u: Account) => u.id)).toEqual([...ACCOUNTS].map((a) => a.id).sort());
    expect(doc.users[0].encrypted_password).toBe(ACCOUNTS.find((a) => a.id === doc.users[0].id)!.encrypted_password);

    // 35 older + today = 36; the six oldest go, the file this job never wrote stays.
    expect([...st.deleted].sort()).toEqual(older.slice(29).sort());
    expect(st.objects.has(foreign)).toBe(true);
    expect([...st.objects.keys()].filter((k) => k.endsWith(".json.enc"))).toHaveLength(30);

    // Logs say what happened, never what was in it.
    expect(c.lines).toContain(`[auth-backup] ok ${todayKey} accounts=5 bytes=${sealed.length} pruned=6`);
    const said = JSON.stringify(c.lines);
    expect(said).not.toContain("example.test");
    expect(said).not.toContain("$2a$");
  });

  it("the migration not yet run: alerted with the file to run, nothing written or pruned", async () => {
    const sb = fakeSupabase(ACCOUNTS, { missingFunction: true });
    const st = memStore([`${BACKUP_PREFIX}${day(40)}.json.enc`]);
    const c = capture();
    const summary = await runSupabaseFreePlanSafety({ env: { ...SB, AUTH_BACKUP_KEY: KEY }, fetch: sb.f, store: st.factory, alert: c.alert, log: c.log, now: () => NOW });
    expect(summary).toEqual({ keepAlive: "ok", backup: "failed" });
    expect(c.alerts[0].detail).toMatch(/supabase\/auth_users_backup\.sql has not been run/);
    expect(st.state.opened).toBe(0);
    expect(st.deleted).toEqual([]);
  });

  it("a partial export is refused rather than sealed", async () => {
    const sb = fakeSupabase(ACCOUNTS, { total: 7 });
    const st = memStore();
    const c = capture();
    const summary = await runSupabaseFreePlanSafety({ env: { ...SB, AUTH_BACKUP_KEY: KEY }, fetch: sb.f, store: st.factory, alert: c.alert, log: c.log, pageSize: 2 });
    expect(summary.backup).toBe("failed");
    expect(c.alerts[0].detail).toBe("export incomplete: 5 of 7 accounts");
    expect(st.state.opened).toBe(0);
  });

  it("an empty export is refused (the login table is never empty)", async () => {
    const c = capture();
    const st = memStore();
    const summary = await runSupabaseFreePlanSafety({ env: { ...SB, AUTH_BACKUP_KEY: KEY }, fetch: fakeSupabase([]).f, store: st.factory, alert: c.alert, log: c.log });
    expect(summary.backup).toBe("failed");
    expect(c.alerts[0].detail).toBe("export returned no accounts");
    expect(st.state.opened).toBe(0);
  });

  it("R2 refusing the write: alerted, old backups untouched, and the cron still resolves", async () => {
    const older = Array.from({ length: 40 }, (_, i) => `${BACKUP_PREFIX}${day(i + 1)}.json.enc`);
    const st = memStore(older, { failPut: true });
    const c = capture({ alertThrows: true });
    const summary = await runSupabaseFreePlanSafety({ env: { ...SB, AUTH_BACKUP_KEY: KEY }, fetch: fakeSupabase(ACCOUNTS).f, store: st.factory, alert: c.alert, log: c.log, now: () => NOW });
    expect(summary).toEqual({ keepAlive: "ok", backup: "failed" });
    expect(c.alerts.map((a) => [a.title, a.detail])).toEqual([["Login backup failed", "R2 put failed"]]);
    expect(st.deleted).toEqual([]);
  });
});
