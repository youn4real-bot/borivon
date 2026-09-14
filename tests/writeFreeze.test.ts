import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { middleware } from "@/middleware";
import {
  freezeDecision, maintenanceResponse, pickLang, writesFrozen, isMaintenanceBody,
  MAINTENANCE_MESSAGES, MAINTENANCE_RETRY_AFTER_SEC,
} from "@/lib/maintenance";
import { isFrozenWrite, withWriteFreeze, buildServiceFetch } from "@/lib/d1/serviceFetch";

/**
 * The WRITE FREEZE for the final copy. What it protects: a document approved or
 * a lead captured between "export started" and "D1 answers" would exist only in
 * Supabase and vanish at the flip. What it must not break: reading the portal,
 * the uptime probe, and the cron alerting (a 503'd cron pages the founder).
 */

const SITE = "https://www.borivon.com";

function req(method: string, path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, SITE), { method, headers: { host: "www.borivon.com", ...headers } });
}

/** NextResponse.next() — the middleware let the request through to the route. */
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

afterEach(() => { vi.unstubAllEnvs(); });

describe("the flag", () => {
  it("is off unless MAINTENANCE_WRITES is exactly \"1\"", () => {
    expect(writesFrozen({})).toBe(false);
    for (const v of ["0", "", "true", "yes", "1 ", " 1", "on"]) expect(writesFrozen({ MAINTENANCE_WRITES: v })).toBe(false);
    expect(writesFrozen({ MAINTENANCE_WRITES: "1" })).toBe(true);
  });

  it("ships OFF in wrangler.jsonc", () => {
    const src = fs.readFileSync("wrangler.jsonc", "utf8");
    expect(src).toMatch(/"MAINTENANCE_WRITES":\s*"0"/);
    expect(src).toMatch(/"DATA_BACKEND":\s*"supabase"/);
  });
});

describe("freezeDecision", () => {
  it("blocks every mutating /api request", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      for (const p of ["/api/portal/upload", "/api/portal/messages", "/api/public/register", "/api/telegram/webhook", "/api"]) {
        expect(freezeDecision(m, p), `${m} ${p}`).toBe("block");
      }
    }
  });

  it("lets reads through", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(freezeDecision(m, "/api/portal/documents")).toBe("pass");
  });

  it("keeps /api/health open whatever the method", () => {
    for (const m of ["GET", "POST", "HEAD"]) expect(freezeDecision(m, "/api/health")).toBe("pass");
    expect(freezeDecision("GET", "/api/healthz")).toBe("pass");          // a GET anyway
    expect(freezeDecision("POST", "/api/healthz")).toBe("block");        // not the health route
  });

  it("answers cron routes 'skipped' whatever the method — they are GETs that write", () => {
    for (const m of ["GET", "POST"]) {
      expect(freezeDecision(m, "/api/cron/reminders")).toBe("skip-cron");
      expect(freezeDecision(m, "/api/cron/nudge")).toBe("skip-cron");
    }
    expect(freezeDecision("GET", "/api/cronjobs")).toBe("pass");
  });

  it("never touches pages", () => {
    expect(freezeDecision("POST", "/portal/dashboard")).toBe("pass");
    expect(freezeDecision("POST", "/apix")).toBe("pass");
  });
});

describe("middleware", () => {
  it("changes nothing with the flag off", async () => {
    const res = await middleware(req("POST", "/api/portal/upload"));
    expect(passedThrough(res)).toBe(true);
  });

  it("503s a save with a JSON body the portal recognises, in the reader's language", async () => {
    vi.stubEnv("MAINTENANCE_WRITES", "1");
    const res = await middleware(req("POST", "/api/portal/messages", { "accept-language": "de-DE,de;q=0.9,en;q=0.5" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe(String(MAINTENANCE_RETRY_AFTER_SEC));
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error).toBe(MAINTENANCE_MESSAGES.de);
    expect(body.retryAfter).toBe(MAINTENANCE_RETRY_AFTER_SEC);
    expect(isMaintenanceBody(body)).toBe(true);
    expect(body.messages).toEqual(MAINTENANCE_MESSAGES);
  });

  it("blocks PUT / PATCH / DELETE too, and on the affiliate host", async () => {
    vi.stubEnv("MAINTENANCE_WRITES", "1");
    for (const m of ["PUT", "PATCH", "DELETE"]) expect((await middleware(req(m, "/api/portal/profile"))).status).toBe(503);
    const aff = new NextRequest(new URL("/api/affiliate/terms", "https://affiliates.borivon.com"), { method: "POST", headers: { host: "affiliates.borivon.com" } });
    expect((await middleware(aff)).status).toBe(503);
  });

  it("keeps GETs, the health probe and pages working", async () => {
    vi.stubEnv("MAINTENANCE_WRITES", "1");
    expect(passedThrough(await middleware(req("GET", "/api/portal/documents")))).toBe(true);
    expect(passedThrough(await middleware(req("GET", "/api/health")))).toBe(true);
    expect(passedThrough(await middleware(req("POST", "/api/health")))).toBe(true);
    expect(passedThrough(await middleware(req("GET", "/portal/dashboard")))).toBe(true);
  });

  it("answers a cron route 200 'skipped' so nothing alerts and nothing runs", async () => {
    vi.stubEnv("MAINTENANCE_WRITES", "1");
    const res = await middleware(req("GET", "/api/cron/reminders", { authorization: "Bearer x" }));
    expect(res.status).toBe(200);
    expect(passedThrough(res)).toBe(false);
    expect(await res.json()).toEqual({ ok: true, skipped: "maintenance" });
  });

  it("keeps the affiliate API's 404 off the main host when not frozen", async () => {
    const res = await middleware(req("POST", "/api/affiliate/terms"));
    expect(res.status).toBe(404);
  });
});

describe("the message (LAW #19)", () => {
  it("exists in FR, EN and DE, and they are different sentences", () => {
    const all = [MAINTENANCE_MESSAGES.fr, MAINTENANCE_MESSAGES.en, MAINTENANCE_MESSAGES.de];
    for (const m of all) expect(m.length).toBeGreaterThan(20);
    expect(new Set(all).size).toBe(3);
  });

  it("follows the browser's first supported language, French otherwise", () => {
    expect(pickLang("en-US,en;q=0.9")).toBe("en");
    expect(pickLang("fr-FR")).toBe("fr");
    expect(pickLang("ar-MA,de;q=0.8")).toBe("de");
    expect(pickLang("ar-MA")).toBe("fr");
    expect(pickLang(null)).toBe("fr");
  });

  it("is the same body maintenanceResponse builds", async () => {
    const body = await maintenanceResponse("en").json();
    expect(body).toMatchObject({ error: MAINTENANCE_MESSAGES.en, code: "maintenance", retryAfter: MAINTENANCE_RETRY_AFTER_SEC });
  });
});

describe("the second layer: the service client refuses data writes", () => {
  it("knows which Supabase requests are writes the copy would miss", () => {
    const sb = "https://p.supabase.co";
    expect(isFrozenWrite("POST", `${sb}/rest/v1/documents`)).toBe(true);
    expect(isFrozenWrite("PATCH", `${sb}/rest/v1/documents?id=eq.1`)).toBe(true);
    expect(isFrozenWrite("DELETE", `${sb}/rest/v1/documents?id=eq.1`)).toBe(true);
    expect(isFrozenWrite("POST", `${sb}/rest/v1/rpc/claim_upload_key`)).toBe(true);
    expect(isFrozenWrite("GET", `${sb}/rest/v1/documents`)).toBe(false);
    expect(isFrozenWrite("HEAD", `${sb}/rest/v1/documents`)).toBe(false);
    // rl_hit: the rate-limit counter is not part of the copy, and refusing it would 503 reads.
    expect(isFrozenWrite("POST", `${sb}/rest/v1/rpc/rl_hit`)).toBe(false);
    // An auth-only RPC (delete from auth.sessions) is a login operation, not data.
    expect(isFrozenWrite("POST", `${sb}/rest/v1/rpc/admin_force_logout`)).toBe(false);
    expect(isFrozenWrite("POST", `${sb}/rest/v1/rpc/app_delete_user`)).toBe(true);
    expect(isFrozenWrite("POST", `${sb}/storage/v1/object/candidate-photos/a.jpg`)).toBe(true);
    expect(isFrozenWrite("DELETE", `${sb}/storage/v1/object/candidate-photos`)).toBe(true);
    // Storage POSTs that only READ keep previews working.
    expect(isFrozenWrite("POST", `${sb}/storage/v1/object/sign/candidate-photos/a.jpg`)).toBe(false);
    expect(isFrozenWrite("POST", `${sb}/storage/v1/object/list/candidate-photos`)).toBe(false);
    // Logins are not part of the copy and stay on Supabase.
    expect(isFrozenWrite("POST", `${sb}/auth/v1/token?grant_type=password`)).toBe(false);
  });

  it("refuses without calling the network, and lets reads through", async () => {
    const calls: string[] = [];
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const f = withWriteFreeze(base);
    const refused = await f("https://p.supabase.co/rest/v1/documents", { method: "POST", body: "{}" });
    expect(refused.status).toBe(503);
    expect((await refused.json()).code).toBe("25006");
    expect(calls).toEqual([]);
    expect((await f("https://p.supabase.co/rest/v1/documents?select=id")).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("reaches supabase-js as an ordinary { error }, never a throw", async () => {
    const calls: string[] = [];
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const f = buildServiceFetch({ backend: "supabase", shadow: false, freeze: true }, { base });
    const db = createClient("https://p.supabase.co", "service", { global: { fetch: f }, auth: { persistSession: false } });
    const { error } = await db.from("documents").insert({ doc_name: "x" });
    expect(error?.code).toBe("25006");
    expect(calls).toEqual([]);
    const read = await db.from("documents").select("id");
    expect(read.error).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe("cf-worker.ts scheduled()", () => {
  it("returns before dispatching any cron while writes are frozen", () => {
    // Parsed as text: cf-worker.ts imports ./.open-next/worker.js, which only exists after a build.
    const src = fs.readFileSync("cf-worker.ts", "utf8");
    const scheduled = src.slice(src.indexOf("async scheduled("));
    const gate = scheduled.indexOf('env.MAINTENANCE_WRITES === "1"');
    const dispatch = scheduled.indexOf(".fetch(req, env, ctx)");
    expect(gate).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(gate);
    expect(scheduled.slice(gate, gate + 200)).toMatch(/return;/);
  });
});
