import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { middleware } from "@/middleware";
import {
  freezeDecision, maintenanceResponse, pickLang, writesFrozen, isMaintenanceBody,
  MAINTENANCE_MESSAGES, MAINTENANCE_RETRY_AFTER_SEC, MAINTENANCE_EVENT, reportIfMaintenance, isFreezeTolerantPath,
  isReadOnlyPostPath, readOnlyPostPaths, isMaintenanceUploadError, maintenanceBody,
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

describe("leads during the freeze", () => {
  it("lets the homepage funnel's POST reach its route — the service client still refuses the write", () => {
    expect(freezeDecision("POST", "/api/leads")).toBe("pass");
    expect(isFreezeTolerantPath("/api/leads")).toBe(true);
    // Only that exact route: a booking (calendar event + reminders) cannot be half-done.
    for (const p of ["/api/book", "/api/leads/export", "/api/leadsx"]) expect(freezeDecision("POST", p), p).toBe("block");
    expect(isFrozenWrite("POST", "https://p.supabase.co/rest/v1/leads")).toBe(true);
  });
});

describe("the POSTs that only read", () => {
  /**
   * The freeze decides on the METHOD, so a POST that only reads would answer
   * 503 and the pause would look like an outage: the admin search bar, the
   * filters and every "download the PDF" button. These paths were each read
   * line by line before being listed; these tests hold that reading in place.
   */
  const EXEMPT = [
    "/api/portal/admin/search",
    "/api/portal/admin/facets",
    "/api/portal/cv/generate",
    "/api/portal/letter/generate",
    "/api/portal/me/passport-data-pdf",
    "/api/portal/admin/passport-data-pdf",
    "/api/portal/admin/b2-report",
    "/api/portal/check-email",
  ];

  it("is exactly the list the module exports", () => {
    expect(readOnlyPostPaths().sort()).toEqual([...EXEMPT].sort());
  });

  it("lets each of them POST through, flag on", async () => {
    vi.stubEnv("MAINTENANCE_WRITES", "1");
    for (const p of EXEMPT) {
      expect(freezeDecision("POST", p), p).toBe("pass");
      expect(passedThrough(await middleware(req("POST", p))), p).toBe(true);
    }
  });

  it("every exempt path is a real route with a POST handler", () => {
    // A typo here would be silent: the Set would simply never match, the route
    // would keep 503-ing, and nothing would say so until switch day.
    for (const p of EXEMPT) {
      const file = `app${p}/route.ts`;
      expect(fs.existsSync(file), file).toBe(true);
      expect(fs.readFileSync(file, "utf8"), file).toContain("export async function POST");
    }
  });

  it("none of them writes a row, mints a token or sends mail", () => {
    // The reason each one is on the list. If a write is ever added to one of
    // these files this fails here, before it can slip past the freeze on
    // switch night. (withWriteFreeze in lib/d1/serviceFetch.ts is the runtime
    // backstop for the same mistake.)
    const WRITES = /\.(insert|upsert|delete|upload)\(|\.update\(\s*\{|sendEmail|resend\.|mintClassroomToken|admin\.(createUser|updateUserById|deleteUser)/;
    // Prove the pattern can fail before trusting it to pass: a route that
    // really does write must match it.
    expect(WRITES.test(fs.readFileSync("app/api/portal/upload/route.ts", "utf8"))).toBe(true);
    expect(WRITES.test(fs.readFileSync("app/api/portal/classroom/token/route.ts", "utf8"))).toBe(true);
    for (const p of EXEMPT) {
      const src = fs.readFileSync(`app${p}/route.ts`, "utf8");
      expect(src.match(WRITES)?.[0] ?? null, `${p} grew a write`).toBe(null);
    }
  });

  it("does NOT exempt the look-alikes that are not read-only", () => {
    // classroom/token writes no row but hands out a 3-hour LiveKit credential,
    // and the class it opens writes attendance telemetry the freeze refuses —
    // a class that half-records is worse than one that says "paused".
    expect(freezeDecision("POST", "/api/portal/classroom/token")).toBe("block");
    // cv-autofill never saves; its whole output is work the frozen autosave
    // would refuse a moment later.
    expect(freezeDecision("POST", "/api/portal/admin/cv-autofill")).toBe("block");
    // The admin panel's own POST is the document review — a real write.
    expect(freezeDecision("POST", "/api/portal/admin")).toBe("block");
    // Prefix matching would be a hole: these are not the exempt routes.
    for (const p of ["/api/portal/admin/searchx", "/api/portal/admin/search/save", "/api/portal/cv/generate/publish"]) {
      expect(freezeDecision("POST", p), p).toBe("block");
      expect(isReadOnlyPostPath(p), p).toBe(false);
    }
  });

  it("still blocks the saves on the same pages", async () => {
    vi.stubEnv("MAINTENANCE_WRITES", "1");
    // The CV page can render a PDF and cannot save the draft behind it; the
    // admin can search and cannot approve. That is the whole point.
    for (const p of ["/api/portal/admin/cv-draft", "/api/portal/upload", "/api/portal/me/passport-data"]) {
      expect((await middleware(req("POST", p))).status, p).toBe(503);
    }
  });
});

describe("the login-less upload page", () => {
  /**
   * components/DocUploader.tsx showed ONE error for every failure: "try again
   * with a PDF or photo (max 25 MB)". During the freeze that tells a nurse on
   * the login-less link that her file is wrong, so she re-shoots the photo and
   * gives up. She now gets the maintenance line — but only if the 503 is
   * actually recognised in the shape Uppy really hands over.
   */
  const body = () => maintenanceBody("fr");

  it("recognises the freeze in the shape @uppy/xhr-upload really emits (an XMLHttpRequest)", () => {
    // Its TYPES promise { status, body }; the runtime passes the request, whose
    // body is responseText. Reading only `body` made the whole fix dead code.
    expect(isMaintenanceUploadError({ status: 503, responseText: JSON.stringify(body()) })).toBe(true);
    expect(isMaintenanceUploadError({ status: 503, body: body() })).toBe(true);
  });

  it("does not mistake a real upload failure for the freeze", () => {
    expect(isMaintenanceUploadError(undefined)).toBe(false);
    expect(isMaintenanceUploadError({ status: 0, responseText: "" })).toBe(false);          // network dropped
    expect(isMaintenanceUploadError({ status: 413, responseText: '{"error":"too big"}' })).toBe(false);
    expect(isMaintenanceUploadError({ status: 503, responseText: "<html>bad gateway" })).toBe(false); // a real outage
    expect(isMaintenanceUploadError({ status: 503, responseText: '{"error":"nope"}' })).toBe(false);  // 503, wrong body
  });

  it("the upload route it posts to is NOT exempt — it really does write", () => {
    expect(freezeDecision("POST", "/api/portal/u/some-token")).toBe("block");
  });
});

describe("the portal's notice (no global patch)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reportIfMaintenance recognises only the freeze's own 503, from text or parsed JSON, and raises the event", () => {
    const target = new EventTarget();
    let hits = 0;
    target.addEventListener(MAINTENANCE_EVENT, () => { hits++; });
    vi.stubGlobal("window", target);
    const body = { error: MAINTENANCE_MESSAGES.fr, code: "maintenance", retryAfter: MAINTENANCE_RETRY_AFTER_SEC };
    expect(reportIfMaintenance(503, JSON.stringify(body))).toBe(true);
    expect(reportIfMaintenance(503, body)).toBe(true);
    expect(hits).toBe(2);
    expect(reportIfMaintenance(500, body)).toBe(false);                            // a real failure keeps its own handling
    expect(reportIfMaintenance(503, { error: "Cloudflare" })).toBe(false);        // an outage is not the freeze
    expect(reportIfMaintenance(503, "<html>503</html>")).toBe(false);
    expect(reportIfMaintenance(503, null)).toBe(false);
    expect(hits).toBe(2);
  });

  it("never throws without a window (server render, tests)", () => {
    expect(reportIfMaintenance(503, { code: "maintenance" })).toBe(true);
  });

  it("MaintenanceNotice only listens: no window.fetch or XMLHttpRequest patch ships to live pages", () => {
    const src = fs.readFileSync("components/MaintenanceNotice.tsx", "utf8").split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*\*)/.test(l)).join("\n");
    expect(src).not.toMatch(/window\.fetch\s*=/);
    expect(src).not.toMatch(/XMLHttpRequest\.prototype/);
    expect(src).toContain("addEventListener(MAINTENANCE_EVENT");
  });

  it("the document upload paths report the freeze instead of retrying into it", () => {
    const dashboard = fs.readFileSync("app/portal/dashboard/page.tsx", "utf8");
    const at = dashboard.indexOf("if (reportIfMaintenance(st, xhr.responseText))");
    expect(at).toBeGreaterThan(-1);
    expect(dashboard.indexOf('void failSettle("errUpload", st === 0', at)).toBeGreaterThan(at);
    expect(fs.readFileSync("app/portal/admin/page.tsx", "utf8")).toContain("reportIfMaintenance(res.status, body)");
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
