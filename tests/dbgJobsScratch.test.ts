/**
 * The scheduled jobs and the public entry points, EXECUTED against the
 * THROWAWAY D1 copy (borivon-db-scratch-20261007) with every outbound effect
 * mocked or blocked: Telegram/email/Google are mocks, and a fetch guard lets
 * through only the scratch D1's query endpoint and READ-ONLY (GET/HEAD) calls
 * to Supabase; anything else throws. The live D1 id is refused outright.
 *
 * Skipped unless RUN_JOBS_SCRATCH=1. Creates rows with dbg ids/emails
 * (dbdbdbdb-0b05-…, dbg-jobs-…@example.invalid) and deletes them again.
 *   RUN_JOBS_SCRATCH=1 npx vitest run tests/dbgJobsScratch.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";

const ENABLED = process.env.RUN_JOBS_SCRATCH === "1";
const SCRATCH = "df7163e3-239a-400f-8a2c-fc45ed7507e9";
const LIVE = "ffb9dcff-a501-4dc2-a94a-e5301e2595f0";

const out = vi.hoisted(() => ({
  OWNER: "dbdbdbdb-0b05-4000-8000-000000000001",
  adminId: "dbdbdbdb-0b05-4000-8000-000000000001" as string | null,
  tg: [] as string[],
  mail: [] as unknown[][],
  blocked: [] as string[],
  quiet: undefined as boolean | undefined,
  inbox: [] as unknown[] | null,
  gmailSearch: [] as unknown[] | null,
  flags: {} as Record<string, boolean>,
  r2Fail: false,
  r2Puts: [] as string[],
}));

vi.mock("@/lib/telegram", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/telegram")>();
  return {
    ...real,
    telegramConfigured: () => true,
    tgSend: vi.fn(async (_c: unknown, t: unknown) => { out.tg.push(String(t)); }),
    tgSendNatural: vi.fn(async (_c: unknown, t: unknown) => { out.tg.push(String(t)); }),
    tgSendReturningId: vi.fn(async (_c: unknown, t: unknown) => { out.tg.push(String(t)); return 777; }),
    tgSendDocument: vi.fn(async () => undefined),
    tgSendChatAction: vi.fn(async () => undefined),
    getAdminUserId: vi.fn(async () => out.adminId),
  };
});
vi.mock("@/lib/email", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const m: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(real)) {
    m[k] = typeof v === "function" ? vi.fn(async (...a: unknown[]) => { out.mail.push([k, ...a]); return true; }) : v;
  }
  return m;
});
vi.mock("@/lib/outboundEmail", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, sendOutboundEmail: vi.fn(async (o: unknown) => { out.mail.push(["sendOutboundEmail", o]); return { ok: true }; }) };
});
vi.mock("@/lib/gmailInbox", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/gmailInbox")>();
  return { ...real, gmailReadConfigured: () => true, getUnansweredEmails: vi.fn(async () => out.inbox) };
});
vi.mock("@/lib/gmailApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/gmailApi")>();
  return { ...real, gmailApiReady: () => true, gmailSearch: vi.fn(async () => out.gmailSearch), gmailGet: vi.fn(async () => null) };
});
vi.mock("@/lib/workspaceCalendar", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/workspaceCalendar")>();
  return {
    ...real,
    listTodayEvents: vi.fn(async () => []),
    listEventsInWindow: vi.fn(async () => ({ ok: true, events: [] })),
    bookWorkspaceEvent: vi.fn(async () => ({ ok: true, id: "dbg-ev", meetLink: null })),
    updateWorkspaceEvent: vi.fn(async () => ({ ok: true })),
    cancelWorkspaceEvent: vi.fn(async () => ({ ok: true })),
  };
});
vi.mock("@/lib/googleWorkspace", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/googleWorkspace")>();
  return { ...real, testWorkspace: vi.fn(async () => ({ ok: true, gmail: true, calendar: true, drive: true })) };
});
vi.mock("@/lib/r2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2")>();
  return { ...real, r2Configured: () => true, r2List: vi.fn(async () => []), r2Put: vi.fn(async (k: string) => { if (out.r2Fail) { out.r2Fail = false; throw new Error("r2Put failed (dbg)"); } out.r2Puts.push(k); }), r2Delete: vi.fn(async () => { throw new Error("r2Delete blocked"); }), r2GetObject: vi.fn(async () => ({ body: Buffer.from("%PDF-1.4 dbg"), contentType: "application/pdf" })) };
});
vi.mock("@/lib/botQuiet", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/botQuiet")>();
  return { ...real, isBotQuiet: vi.fn(async () => (out.quiet === undefined ? real.isBotQuiet() : out.quiet)) };
});
vi.mock("@/lib/automationSettings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/automationSettings")>();
  return {
    ...real,
    isAutomationEnabled: vi.fn(async (k: string) => (k in out.flags ? out.flags[k] : real.isAutomationEnabled(k as never))),
  };
});

function loadEnv() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  process.env.D1_DATABASE_ID = SCRATCH;
  process.env.DATA_BACKEND = "d1";
  process.env.MAINTENANCE_WRITES = "0";
  process.env.SHADOW_D1_RATE = "0";
  delete process.env.STORAGE_BACKEND;
  process.env.CRON_SECRET = "dbg-jobs-secret";
  process.env.TELEGRAM_CHAT_ID = "dbg-chat";
  process.env.TELEGRAM_BOT_TOKEN = "dbg-token";
  for (const k of Object.keys(process.env)) {
    if (/^(GOOGLE_|AZURE_|RESEND|GMAIL_|GIPHY|TURNSTILE|VERCEL_OIDC|OPENROUTER|GROQ|GEMINI|VERTEX)/.test(k)) delete process.env[k];
  }
  process.env.ASSISTANT_ENABLED = "false";
}

const realFetch = globalThis.fetch;
function installGuard() {
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.startsWith("https://api.cloudflare.com/")) {
      if (url.includes(LIVE)) throw new Error("BLOCKED: live D1");
      if (!url.includes(`/d1/database/${SCRATCH}/query`)) throw new Error("BLOCKED cloudflare api " + url);
      return realFetch(input as RequestInfo, init);
    }
    if (url.startsWith(sb)) {
      if (method !== "GET" && method !== "HEAD") { out.blocked.push(`${method} ${url}`); throw new Error(`BLOCKED Supabase ${method}`); }
      return realFetch(input as RequestInfo, init);
    }
    out.blocked.push(`${method} ${url}`);
    throw new Error("BLOCKED outbound " + url);
  }) as typeof fetch;
}

/** Raw SQL on the scratch DB (fixtures + inspection). Asserts the id. */
async function sq(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  expect(process.env.D1_DATABASE_ID).toBe(SCRATCH);
  const r = await realFetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${SCRATCH}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const j = (await r.json()) as { success: boolean; result?: { results: Record<string, unknown>[] }[]; errors?: unknown };
  if (!j.success) throw new Error("scratch sql: " + JSON.stringify(j.errors));
  return j.result?.[0]?.results ?? [];
}

const ids = {
  remOnce: "dbdbdbdb-0b05-4000-8000-0000000000a1",
  remDaily: "dbdbdbdb-0b05-4000-8000-0000000000a2",
  remFuture: "dbdbdbdb-0b05-4000-8000-0000000000a3",
  remDone: "dbdbdbdb-0b05-4000-8000-0000000000a4",
  remRace: "dbdbdbdb-0b05-4000-8000-0000000000a5",
};

async function cleanup() {
  await sq(`DELETE FROM assistant_reminders WHERE owner_user_id = ?`, [out.OWNER]);
  await sq(`DELETE FROM bookings WHERE email LIKE 'dbg-jobs-%@example.invalid' OR name LIKE 'dbg-jobs%'`);
  await sq(`DELETE FROM email_followup_chase WHERE owner_user_id = ?`, [out.OWNER]);
  await sq(`DELETE FROM assistant_commitments WHERE owner_user_id = ?`, [out.OWNER]);
  await sq(`DELETE FROM inbox_sla_nudges WHERE key LIKE 'dbg-jobs-%'`);
  await sq(`DELETE FROM rate_limits WHERE bucket_key LIKE 'dbg-jobs%' OR bucket_key LIKE '%203.0.113.%' OR bucket_key LIKE '%198.51.100.%'`);
}

describe.skipIf(!ENABLED)("jobs on the throwaway D1", () => {
  beforeAll(async () => {
    loadEnv();
    expect(process.env.D1_DATABASE_ID).toBe(SCRATCH);
    installGuard();
    await cleanup();
  }, 120_000);

  afterAll(async () => {
    if (!ENABLED) return;
    await cleanup();
    globalThis.fetch = realFetch;
    console.log("BLOCKED outbound:", JSON.stringify(out.blocked));
  }, 120_000);

  it("reminders: each due reminder fires once; recurring re-arms; rerun is silent; concurrent runs never double", async () => {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const { fireDueReminders } = await import("@/lib/reminderFire");
    const db = getServiceSupabase();
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const { error } = await db.from("assistant_reminders").insert([
      { id: ids.remOnce, owner_user_id: out.OWNER, text: "dbg once", done: false, recurrence: null, due_at: iso(now - 60_000), due_date: iso(now - 60_000).slice(0, 10) },
      { id: ids.remDaily, owner_user_id: out.OWNER, text: "dbg daily", done: false, due_at: "2026-10-05T08:00:00+00:00", due_date: "2026-10-05", recurrence: "daily" },
      { id: ids.remFuture, owner_user_id: out.OWNER, text: "dbg future", done: false, recurrence: null, due_date: null, due_at: iso(now + 3_600_000) },
      { id: ids.remDone, owner_user_id: out.OWNER, text: "dbg done", due_at: iso(now - 60_000), done: true, recurrence: null, due_date: null },
    ]);
    expect(error).toBeNull();
    out.quiet = false;
    out.tg.length = 0;
    const r1 = await fireDueReminders("dbg-chat", out.OWNER);
    expect(r1).toEqual({ fired: 2 });
    expect(out.tg.sort()).toEqual(["dbg daily", "dbg once"]);
    const rows = await sq(`SELECT id, notified_at, due_at, remind_count, last_ping_message_id FROM assistant_reminders WHERE owner_user_id = ? ORDER BY id`, [out.OWNER]);
    console.log("after fire:", JSON.stringify(rows));
    const once = rows.find((r) => r.id === ids.remOnce)!;
    expect(once.notified_at).not.toBeNull();
    expect(once.remind_count).toBe(1);
    expect(once.last_ping_message_id).toBe(777);
    const daily = rows.find((r) => r.id === ids.remDaily)!;
    expect(daily.notified_at).toBeNull();
    expect(Date.parse(String(daily.due_at))).toBeGreaterThan(now);
    // 08:00 UTC = 09:00 Casablanca wall clock preserved
    expect(String(daily.due_at)).toMatch(/T08:00:00/);

    out.tg.length = 0;
    const r2 = await fireDueReminders("dbg-chat", out.OWNER);
    expect(r2).toEqual({ fired: 0 });
    expect(out.tg).toEqual([]);

    // concurrency: one newly-due row, two triggers at once
    await db.from("assistant_reminders").insert({ id: ids.remRace, owner_user_id: out.OWNER, text: "dbg race", due_at: iso(now - 1000) });
    out.tg.length = 0;
    const [a, b] = await Promise.all([fireDueReminders("dbg-chat", out.OWNER), fireDueReminders("dbg-chat", out.OWNER)]);
    expect(a.fired + b.fired).toBe(1);
    expect(out.tg).toEqual(["dbg race"]);
    out.quiet = undefined;
  }, 120_000);

  it("booking-reminders: one email per due booking, phone-only stamped, out-of-window untouched, rerun silent", async () => {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const db = getServiceSupabase();
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const base = { kind: "nurse", status: "booked", source: "public", selections: {} };
    const ins = await db.from("bookings").insert([
      { ...base, name: "dbg-jobs A", email: "dbg-jobs-a@example.invalid", manage_token: "dbg-jobs-tok-a", starts_at: iso(now + 10 * 3600e3), ends_at: iso(now + 10.5 * 3600e3), lang: "de" },
      { ...base, name: "dbg-jobs B", email: null, manage_token: null, starts_at: iso(now + 11 * 3600e3), ends_at: iso(now + 11.5 * 3600e3), lang: null },
      { ...base, name: "dbg-jobs C", email: "dbg-jobs-c@example.invalid", manage_token: "dbg-jobs-tok-c", starts_at: iso(now + 40 * 3600e3), ends_at: iso(now + 40.5 * 3600e3), lang: null },
      { ...base, name: "dbg-jobs D", email: "dbg-jobs-d@example.invalid", manage_token: "dbg-jobs-tok-d", starts_at: iso(now - 3600e3), ends_at: iso(now - 0.5 * 3600e3), lang: null },
    ]).select("id, name");
    expect(ins.error).toBeNull();
    const { GET } = await import("@/app/api/cron/booking-reminders/route");
    const { NextRequest } = await import("next/server");
    const call = () => GET(new NextRequest("https://cron.internal/api/cron/booking-reminders", { headers: { authorization: "Bearer dbg-jobs-secret" } }));
    out.mail.length = 0;
    const r1 = await (await call()).json();
    console.log("booking r1", JSON.stringify(r1));
    expect(r1).toEqual({ ok: true, considered: 2, sent: 1, skipped: 1 });
    expect(out.mail.map((m) => m[0])).toEqual(["sendBookingReminderEmail"]);
    expect((out.mail[0][1] as { to: string; lang?: string }).to).toBe("dbg-jobs-a@example.invalid");
    expect((out.mail[0][1] as { to: string; lang?: string }).lang).toBe("de");
    const r2 = await (await call()).json();
    expect(r2).toEqual({ ok: true, considered: 0, sent: 0, skipped: 0 });
    const rows = await sq(`SELECT name, reminded_at FROM bookings WHERE name LIKE 'dbg-jobs%' ORDER BY name`);
    console.log("bookings", JSON.stringify(rows));
    expect(rows.map((r) => r.reminded_at !== null)).toEqual([true, true, false, false]);
  }, 120_000);

  it("followup chase: due row nudged once, 10h gate holds, reply resolves", async () => {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const { runFollowupChase } = await import("@/lib/followupsRun");
    const db = getServiceSupabase();
    const old = new Date(Date.now() - 30 * 3600e3).toISOString();
    const ins = await db.from("email_followup_chase").insert([
      { owner_user_id: out.OWNER, to_email: "dbg-jobs-x@example.invalid", subject: "dbg x", sent_at: old, last_nudge_at: old, nudge_count: 0 },
    ]).select("id");
    expect(ins.error).toBeNull();
    out.flags = { followup_chase: true };
    out.adminId = out.OWNER;
    out.gmailSearch = [];
    out.tg.length = 0;
    const r1 = await runFollowupChase("dbg-chat");
    expect(r1).toEqual({ sent: true, nudged: 1, resolved: 0 });
    const r2 = await runFollowupChase("dbg-chat");
    expect(r2).toEqual({ sent: false, nudged: 0, resolved: 0 });
    const row = (await sq(`SELECT nudge_count, done, last_nudge_at FROM email_followup_chase WHERE owner_user_id = ?`, [out.OWNER]))[0];
    console.log("followup row", JSON.stringify(row));
    expect(row.nudge_count).toBe(1);
    out.gmailSearch = [{ id: "m1", threadId: "t", from: "dbg-jobs-x@example.invalid", fromName: "x", subject: "re", date: new Date().toUTCString(), snippet: "" }];
    const r3 = await runFollowupChase("dbg-chat");
    expect(r3).toEqual({ sent: false, nudged: 0, resolved: 1 });
    const row2 = (await sq(`SELECT done FROM email_followup_chase WHERE owner_user_id = ?`, [out.OWNER]))[0];
    expect(row2.done).toBe(1);
    out.flags = {};
    out.gmailSearch = [];
  }, 120_000);

  it("inbox SLA: 6h+ emails nudged once; rerun silent", async () => {
    const before = await sq(`SELECT key, nudged_at FROM inbox_sla_nudges ORDER BY key`);
    const { runInboxSlaNudge } = await import("@/lib/inboxSlaRun");
    const d = (h: number) => new Date(Date.now() - h * 3600e3).toUTCString();
    out.inbox = [
      { from: "dbg-jobs-1@example.invalid", fromName: "One", subject: "s1", date: d(7), ageDays: 0 },
      { from: "dbg-jobs-2@example.invalid", fromName: "Two", subject: "s2", date: d(2), ageDays: 0 },
    ];
    out.flags = { inbox_sla: true };
    out.tg.length = 0;
    try {
      const r1 = await runInboxSlaNudge("dbg-chat");
      expect(r1).toEqual({ sent: true, count: 1 });
      const r2 = await runInboxSlaNudge("dbg-chat");
      expect(r2).toEqual({ sent: false, count: 0 });
      const after = await sq(`SELECT key, nudged_at FROM inbox_sla_nudges ORDER BY key`);
      console.log("sla before", before.length, "after", after.length, JSON.stringify(after.filter((r) => String(r.key).startsWith("dbg-jobs"))));
    } finally {
      // restore any copied row the 30-day prune removed
      for (const r of before) await sq(`INSERT OR IGNORE INTO inbox_sla_nudges (key, nudged_at) VALUES (?, ?)`, [r.key, r.nudged_at]);
      out.flags = {};
      out.inbox = [];
    }
  }, 120_000);

  it("commitments: upsert dedupes on re-scan; chase nudges overdue once (gate)", async () => {
    const { recordCommitments, listOpenCommitments } = await import("@/lib/commitments");
    const { runCommitmentChase } = await import("@/lib/commitmentsRun");
    const past = new Date(Date.now() - 3 * 86400e3).toISOString();
    const items = [
      { who_email: "dbg-jobs-p@example.invalid", who_name: "P", what: "dbg Fahrplan", due_at: past, source_message_id: "dbg-msg-1", source_subject: "s", promised_at: past },
      { who_email: "dbg-jobs-p@example.invalid", who_name: "P", what: "dbg contract", due_at: null, source_message_id: "dbg-msg-1", source_subject: "s", promised_at: past },
    ];
    const n1 = await recordCommitments(out.OWNER, items);
    const n2 = await recordCommitments(out.OWNER, items);
    console.log("commitments n1/n2", n1, n2);
    expect(n1).toBe(2);
    expect(n2).toBe(0);
    const open = await listOpenCommitments(out.OWNER);
    expect(open.map((c) => c.what)).toEqual(["dbg Fahrplan", "dbg contract"]);
    out.quiet = false;
    out.flags = { commitments: true };
    out.tg.length = 0;
    const c1 = await runCommitmentChase("dbg-chat", out.OWNER);
    const c2 = await runCommitmentChase("dbg-chat", out.OWNER);
    console.log("chase", JSON.stringify(c1), JSON.stringify(c2), JSON.stringify(out.tg));
    expect(c1.sent).toBe(true);
    expect(c2).toEqual({ sent: false, count: 0 });
    out.quiet = undefined;
    out.flags = {};
  }, 120_000);

  it("rate limiter (rl_hit on D1): limit 1 per window gates the second hit", async () => {
    const { enforceUserRateLimit } = await import("@/lib/rateLimit");
    const a = await enforceUserRateLimit("dbg-jobs", "k1", { limit: 1, windowMs: 6 * 3600e3 });
    const b = await enforceUserRateLimit("dbg-jobs", "k1", { limit: 1, windowMs: 6 * 3600e3 });
    console.log("rl", JSON.stringify(a), JSON.stringify(b));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  }, 60_000);

  it("health-watch route runs on D1 (database probe real, others mocked healthy)", async () => {
    const { GET } = await import("@/app/api/cron/health-watch/route");
    const { NextRequest } = await import("next/server");
    process.env.RESEND_API_KEY = "re_dbg";
    out.tg.length = 0;
    const res = await GET(new NextRequest("https://cron.internal/api/cron/health-watch", { headers: { authorization: "Bearer dbg-jobs-secret" } }));
    const j = await res.json();
    delete process.env.RESEND_API_KEY;
    console.log("health", JSON.stringify(j), JSON.stringify(out.tg));
    expect(j.ok).toBe(true);
    expect(j.probes).toEqual({ google: true, drive: true, r2: true, database: true, email: true });
  }, 60_000);

  it("briefing route: free-plan safety runs, then bot_quiet=hold skips everything", async () => {
    const { GET } = await import("@/app/api/cron/briefing/route");
    const { NextRequest } = await import("next/server");
    out.tg.length = 0;
    const warn = vi.spyOn(console, "warn");
    const res = await GET(new NextRequest("https://cron.internal/api/cron/briefing", { headers: { authorization: "Bearer dbg-jobs-secret" } }));
    const j = await res.json();
    const lines = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    console.log("briefing", JSON.stringify(j), JSON.stringify(lines.filter((l) => /keepalive|auth-backup/.test(l))));
    expect(j).toEqual({ skipped: "quiet" });
    expect(out.tg).toEqual([]);
    expect(lines.some((l) => l.startsWith("[supabase-keepalive] ok"))).toBe(true);
  }, 60_000);

  it("selection parity: each cron's compute on D1 vs read-only Supabase", async () => {
    const now = Date.now();
    out.adminId = null;
    const realAdmin = await (async () => {
      const r = await realFetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
      const j = (await r.json()) as { users: { id: string; email?: string }[] };
      return j.users.find((u) => (u.email ?? "").toLowerCase() === (process.env.ADMIN_EMAIL ?? "").toLowerCase())?.id ?? null;
    })();
    out.adminId = realAdmin;
    out.flags = { briefing_extras: true, doc_reminders: true };
    out.inbox = [];
    const runAll = async () => {
      const { computeBriefing } = await import("@/lib/briefing");
      const { computeWeeklyReport } = await import("@/lib/weeklyReport");
      const { computeStuckCandidates } = await import("@/lib/autoChase");
      const { computeChaseList } = await import("@/lib/chaseList");
      const { computeCriticalDates } = await import("@/lib/criticalDates");
      const { computeBatchTasks } = await import("@/lib/batchBoard");
      const { computeDueReminders } = await import("@/lib/docRemindersRun");
      const { driveOnlyDocCount } = await import("@/lib/healthProbes");
      const due = await computeDueReminders(now);
      return {
        briefing: await computeBriefing(realAdmin),
        weekly: await computeWeeklyReport(),
        stuck: await computeStuckCandidates(),
        chase: (await computeChaseList(now)).map((r: { userId?: string; reason?: string; days?: number }) => [r.userId, r.reason, r.days]),
        critical: await computeCriticalDates(),
        batch: await computeBatchTasks(),
        docRem: { ok: due.ok, tableReady: due.tableReady, due: due.due.map((d) => [d.userId, d.items.map((i) => `${i.kind}:${i.key}`).sort().join(",")]), sentLast7d: due.sentLast7d },
        stranded: await driveOnlyDocCount(),
      };
    };
    const d1 = await runAll();
    vi.resetModules();
    process.env.DATA_BACKEND = "supabase";
    let sb: Awaited<ReturnType<typeof runAll>>;
    try {
      sb = await runAll();
    } finally {
      vi.resetModules();
      process.env.DATA_BACKEND = "d1";
    }
    // Holds candidate names: written only on request, to a path outside the repo.
    if (process.env.JOBS_PARITY_OUT) fs.writeFileSync(process.env.JOBS_PARITY_OUT, JSON.stringify({ d1, sb }, null, 1));
    for (const k of Object.keys(d1) as (keyof typeof d1)[]) {
      const same = JSON.stringify(d1[k]) === JSON.stringify(sb[k]);
      console.log(`PARITY ${k}: ${same ? "same" : "DIFF"}`);
    }
    out.flags = {};
    out.adminId = out.OWNER;
  }, 300_000);

  it("doc-reminders: switch on → each due candidate mailed once, logged; rerun sends nothing", async () => {
    const startIso = new Date(Date.now() - 1000).toISOString();
    const pre = await sq(`SELECT COUNT(*) n FROM candidate_reminders`);
    expect(pre[0].n).toBe(0);
    await sq(`INSERT INTO app_settings (key, value, updated_at) VALUES ('candidate_doc_reminders', 'on', ?)`, [startIso]);
    try {
      const { runDocReminders } = await import("@/lib/docRemindersRun");
      out.mail.length = 0;
      const r1 = await runDocReminders();
      const mails1 = out.mail.filter((m) => m[0] === "sendDocReminderEmail").length;
      const logged = await sq(`SELECT user_id, sent_at, items FROM candidate_reminders`);
      console.log("docrem r1", JSON.stringify(r1), "mails", mails1, "logged", logged.length, "sample sent_at", logged[0]?.sent_at, "items type", typeof logged[0]?.items);
      expect(r1.sent).toBe(r1.due > 40 ? 40 : r1.due);
      expect(mails1).toBe(r1.sent);
      expect(logged.length).toBe(r1.sent);
      out.mail.length = 0;
      const r2 = await runDocReminders();
      console.log("docrem r2", JSON.stringify(r2));
      expect(r2.sent).toBe(0);
      expect(out.mail.length).toBe(0);
    } finally {
      await sq(`DELETE FROM candidate_reminders WHERE sent_at >= ?`, [startIso.slice(0, 10)]);
      await sq(`DELETE FROM app_settings WHERE key = 'candidate_doc_reminders'`);
    }
  }, 300_000);

  it("founder routes run end-to-end on D1 when not quiet (nudge, weekly, auto-chase, inbox-reminder, briefing)", async () => {
    const { NextRequest } = await import("next/server");
    const req = (p: string) => new NextRequest(`https://cron.internal${p}`, { headers: { authorization: "Bearer dbg-jobs-secret" } });
    out.quiet = false;
    out.adminId = out.OWNER;
    out.inbox = [];
    out.tg.length = 0;
    const results: Record<string, unknown> = {};
    try {
      results.nudgeEvening = await (await (await import("@/app/api/cron/nudge/route")).GET(req("/api/cron/nudge?slot=evening"))).json();
      results.weekly = await (await (await import("@/app/api/cron/weekly-report/route")).GET(req("/api/cron/weekly-report"))).json();
      out.flags = { daily_briefing: false };
      results.autoChase = await (await (await import("@/app/api/cron/auto-chase/route")).GET(req("/api/cron/auto-chase"))).json();
      results.inbox = await (await (await import("@/app/api/cron/inbox-reminder/route")).GET(req("/api/cron/inbox-reminder"))).json();
      out.flags = {};
      results.briefing = await (await (await import("@/app/api/cron/briefing/route")).GET(req("/api/cron/briefing"))).json();
    } finally {
      out.quiet = undefined;
      out.flags = {};
    }
    console.log("routes", JSON.stringify(results), "tg msgs", out.tg.length);
    expect((results.weekly as { sent: boolean }).sent).toBe(true);
    expect((results.autoChase as { sent: boolean }).sent).toBe(true);
    expect((results.briefing as { sent: boolean }).sent).toBe(true);
  }, 300_000);

  it("public /api/book → manage (GET, reschedule, cancel) on D1: follow-ups re-armed and dropped", async () => {
    const { NextRequest } = await import("next/server");
    const book = await import("@/app/api/book/route");
    const manage = await import("@/app/api/book/manage/route");
    const ip = { "cf-connecting-ip": "203.0.113.77", "x-forwarded-for": "203.0.113.77" };
    out.adminId = out.OWNER;
    await sq(`DELETE FROM assistant_reminders WHERE owner_user_id = ?`, [out.OWNER]); // only this booking's chase below
    out.mail.length = 0;
    const g = await (await book.GET(new NextRequest("https://www.borivon.com/api/book?kind=nurse", { headers: ip }))).json();
    const all: number[] = g.days.flatMap((d: { slots: { at: number }[] }) => d.slots.map((s) => s.at));
    expect(all.length).toBeGreaterThan(4);
    const at1 = all[all.length - 1];
    const at2 = all[all.length - 3];
    const post = (body: unknown) => book.POST(new NextRequest("https://www.borivon.com/api/book", { method: "POST", headers: { ...ip, "content-type": "application/json" }, body: JSON.stringify(body) }));
    const r1 = await post({ kind: "nurse", at: at1, name: "dbg-jobs Booker", email: "dbg-jobs-book@example.invalid", lang: "de", selections: {} });
    const j1 = await r1.json();
    console.log("book r1", r1.status, JSON.stringify(j1));
    expect(r1.status).toBe(200);
    // second booking of the same slot is refused
    const r1b = await post({ kind: "nurse", at: at1, name: "dbg-jobs Booker2", email: "dbg-jobs-book2@example.invalid", lang: "de", selections: {} });
    expect(r1b.status).toBe(409);
    const waitFor = async (pred: () => Promise<boolean>, what: string) => {
      for (let i = 0; i < 60; i++) { if (await pred()) return; await new Promise((r) => setTimeout(r, 500)); }
      throw new Error("timed out waiting for " + what);
    };
    await waitFor(async () => out.mail.some((m) => m[0] === "sendBookingConfirmedEmail"), "confirmation email");
    const token = (out.mail.find((m) => m[0] === "sendBookingConfirmedEmail")![1] as { manageToken: string }).manageToken;
    await waitFor(async () => (await sq(`SELECT COUNT(*) n FROM assistant_reminders WHERE owner_user_id = ?`, [out.OWNER]))[0].n as number > 0, "follow-ups");
    await waitFor(async () => (await sq(`SELECT lead_id FROM bookings WHERE manage_token = ?`, [token]))[0]?.lead_id != null, "lead link");
    const rem1 = await sq(`SELECT text, due_at FROM assistant_reminders WHERE owner_user_id = ? ORDER BY due_at`, [out.OWNER]);
    const bk1 = await sq(`SELECT id, starts_at, ends_at, manage_token, lang, status, calendar_event_id, selections FROM bookings WHERE manage_token = ?`, [token]);
    console.log("booking row", JSON.stringify({ ...bk1[0], manage_token: "<tok>" }), "follow-ups", JSON.stringify(rem1.map((r) => r.due_at)));

    const mg = await manage.GET(new NextRequest(`https://www.borivon.com/api/book/manage?t=${token}`, { headers: ip }));
    const mj = await mg.json();
    expect(mg.status).toBe(200);
    expect(mj.booking.startsAt).toBe(at1);

    const mpost = (body: unknown) => manage.POST(new NextRequest("https://www.borivon.com/api/book/manage", { method: "POST", headers: { ...ip, "content-type": "application/json" }, body: JSON.stringify(body) }));
    const rs = await mpost({ token, action: "reschedule", at: at2 });
    console.log("reschedule", rs.status, JSON.stringify(await rs.clone().json()));
    expect(rs.status).toBe(200);
    // background: drop old follow-ups, add new ones
    const { followUpsFor } = await import("@/lib/booking");
    const wantNew = followUpsFor({ startsAt: at2, name: "dbg-jobs Booker", kind: "nurse", now: Date.now() }).map((f) => Date.parse(new Date(f.dueAt).toISOString()));
    await waitFor(async () => {
      const r = await sq(`SELECT due_at FROM assistant_reminders WHERE owner_user_id = ?`, [out.OWNER]);
      const got = r.map((x) => Date.parse(String(x.due_at))).sort();
      return JSON.stringify(got) === JSON.stringify([...wantNew].sort());
    }, "re-armed follow-ups (old dropped, new added)");

    const cx = await mpost({ token, action: "cancel" });
    expect(cx.status).toBe(200);
    await waitFor(async () => (await sq(`SELECT COUNT(*) n FROM assistant_reminders WHERE owner_user_id = ?`, [out.OWNER]))[0].n === 0, "follow-ups dropped on cancel");
    const st = await sq(`SELECT status FROM bookings WHERE manage_token = ?`, [token]);
    expect(st[0].status).toBe("cancelled");
    // a cancelled slot is free again; and the unique slot index answers 23505 on D1
    const { getServiceSupabase } = await import("@/lib/supabase");
    const db = getServiceSupabase();
    const iso = new Date(at2).toISOString();
    const a = await db.from("bookings").insert({ kind: "nurse", name: "dbg-jobs U1", email: "dbg-jobs-u1@example.invalid", starts_at: iso, ends_at: iso, selections: {} }).select("id").single();
    expect(a.error).toBeNull();
    const plus1 = new Date(at2 + 3600e3).toISOString().replace("Z", "").replace(/\.\d+$/, "") + "+01:00";
    const b = await db.from("bookings").insert({ kind: "nurse", name: "dbg-jobs U2", email: "dbg-jobs-u2@example.invalid", starts_at: plus1, ends_at: plus1, selections: {} }).select("id").single();
    console.log("unique slot (same instant, other spelling):", JSON.stringify(b.error));
    expect(b.error?.code).toBe("23505");
    await sq(`DELETE FROM leads WHERE email LIKE 'dbg-jobs-%@example.invalid'`);
  }, 300_000);

  it("/u/[token] one-time upload link on D1: claim RPC, release on failure, concurrent same-key, retire when done", async () => {
    const CAND = "dbdbdbdb-0b05-4000-8000-0000000000c1";
    const { generateUploadToken, hashUploadToken } = await import("@/lib/uploadLink");
    const route = await import("@/app/api/portal/u/[token]/route");
    const { NextRequest } = await import("next/server");
    const token = generateUploadToken();
    const startIso = new Date(Date.now() - 2000).toISOString();
    await sq(`INSERT INTO upload_links (token_hash, candidate_user_id, doc_keys, uploaded_keys, expires_at) VALUES (?, ?, ?, '[]', ?)`,
      [await hashUploadToken(token), CAND, JSON.stringify(["diploma", "transcript"]), new Date(Date.now() + 86400e3).toISOString().replace("Z", "000+00:00")]);
    const ip = { "cf-connecting-ip": "203.0.113.78" };
    const ctx = { params: Promise.resolve({ token }) };
    try {
      const g = await route.GET(new NextRequest(`https://www.borivon.com/api/portal/u/${token}`, { headers: ip }), ctx);
      const gj = await g.json();
      console.log("u GET", g.status, JSON.stringify(gj));
      expect(g.status).toBe(200);
      expect(gj.docs).toEqual([{ key: "diploma", uploaded: false }, { key: "transcript", uploaded: false }]);
      const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
      const upload = (key: string) => {
        const fd = new FormData();
        fd.set("file", new File([pdf], "x.pdf", { type: "application/pdf" }));
        fd.set("docKey", key);
        return route.POST(new NextRequest(`https://www.borivon.com/api/portal/u/${token}`, { method: "POST", headers: ip, body: fd }), { params: Promise.resolve({ token }) });
      };
      // storage failure → claim released
      out.r2Fail = true;
      const f = await upload("diploma");
      console.log("u fail", f.status, JSON.stringify(await f.clone().json()));
      expect(f.status).toBe(500);
      const afterFail = await sq(`SELECT uploaded_keys, used_at FROM upload_links WHERE candidate_user_id = ?`, [CAND]);
      expect(JSON.parse(String(afterFail[0].uploaded_keys))).toEqual([]);
      // concurrent same key → exactly one stored
      const [a, b] = await Promise.all([upload("diploma"), upload("diploma")]);
      const ja = await a.json(), jb = await b.json();
      console.log("u concurrent", JSON.stringify(ja), JSON.stringify(jb));
      expect([ja.alreadyUploaded === true, jb.alreadyUploaded === true].filter(Boolean).length).toBe(1);
      const docs1 = await sq(`SELECT id, file_type, status FROM documents WHERE user_id = ?`, [CAND]);
      expect(docs1.length).toBe(1);
      const c = await upload("transcript");
      const jc = await c.json();
      console.log("u last", JSON.stringify(jc));
      expect(jc.done).toBe(true);
      const link = await sq(`SELECT uploaded_keys, used_at FROM upload_links WHERE candidate_user_id = ?`, [CAND]);
      expect(link[0].used_at).not.toBeNull();
      expect(JSON.parse(String(link[0].uploaded_keys)).sort()).toEqual(["diploma", "transcript"]);
      const g2 = await route.GET(new NextRequest(`https://www.borivon.com/api/portal/u/${token}`, { headers: ip }), { params: Promise.resolve({ token }) });
      expect(g2.status).toBe(404);
    } finally {
      const names = (await sq(`SELECT file_name FROM documents WHERE user_id = ?`, [CAND])).map((r) => String(r.file_name));
      await sq(`DELETE FROM documents WHERE user_id = ?`, [CAND]);
      for (const n of names) await sq(`DELETE FROM admin_notifications WHERE doc_name = ? AND created_at >= ?`, [n, startIso.slice(0, 19)]);
      await sq(`DELETE FROM upload_links WHERE candidate_user_id = ?`, [CAND]);
    }
  }, 300_000);

  it("telegram: silence read from D1; webhook records update once, dedupes a retry, stamps responded_at", async () => {
    const real = await vi.importActual<typeof import("@/lib/telegram")>("@/lib/telegram");
    expect(await real.telegramSilenced()).toBe(true);
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const { NextRequest } = await import("next/server");
    const UPD = 990000777;
    await sq(`DELETE FROM telegram_updates WHERE update_id = ?`, [UPD]);
    const prevChat = process.env.TELEGRAM_CHAT_ID;
    process.env.TELEGRAM_CHAT_ID = "990000111";
    out.tg.length = 0;
    try {
      const send = () => POST(new NextRequest("https://www.borivon.com/api/telegram/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ update_id: UPD, message: { chat: { id: 990000111 }, text: "/help" } }) }));
      const r1 = await send();
      expect(r1.status).toBe(200);
      const row1 = await sq(`SELECT update_id, created_at, responded_at FROM telegram_updates WHERE update_id = ?`, [UPD]);
      console.log("tg row", JSON.stringify(row1), "msgs", out.tg.length);
      expect(row1.length).toBe(1);
      const r2 = await send();
      expect(r2.status).toBe(200);
      console.log("tg after retry msgs", out.tg.length);
      expect(out.tg.filter((t) => t.includes("Borivon ops bot") || t.includes("free")).length).toBe(1);
      // a stranger's chat is ignored and recorded nowhere
      const r3 = await POST(new NextRequest("https://www.borivon.com/api/telegram/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ update_id: UPD + 1, message: { chat: { id: 1 }, text: "/help" } }) }));
      expect(r3.status).toBe(200);
      expect((await sq(`SELECT COUNT(*) n FROM telegram_updates WHERE update_id = ?`, [UPD + 1]))[0].n).toBe(0);
    } finally {
      process.env.TELEGRAM_CHAT_ID = prevChat;
      await sq(`DELETE FROM telegram_updates WHERE update_id IN (?, ?)`, [UPD, UPD + 1]);
    }
  }, 120_000);

  it("public leads + v2/contact on D1: insert, details JSON round-trip, 1h dedupe-with-correction", async () => {
    const { NextRequest } = await import("next/server");
    const leads = await import("@/app/api/leads/route");
    const contact = await import("@/app/api/v2/contact/route");
    const ip = { "cf-connecting-ip": "203.0.113.79", "content-type": "application/json" };
    try {
      const p1 = await leads.POST(new NextRequest("https://www.borivon.com/api/leads", { method: "POST", headers: ip, body: JSON.stringify({ kind: "person", email: "dbg-jobs-lead@example.invalid", name: "dbg-jobs Lead", phone: "1", level: "B1", city: "Rabat" }) }));
      expect(await p1.json()).toEqual({ ok: true });
      const p2 = await leads.POST(new NextRequest("https://www.borivon.com/api/leads", { method: "POST", headers: ip, body: JSON.stringify({ kind: "person", email: "dbg-jobs-lead@example.invalid", phone: "2", level: "B2" }) }));
      expect(await p2.json()).toEqual({ ok: true, duplicate: true });
      const rows = await sq(`SELECT name, phone, details, status FROM leads WHERE email = 'dbg-jobs-lead@example.invalid'`);
      console.log("lead rows", JSON.stringify(rows));
      expect(rows.length).toBe(1);
      expect(rows[0].phone).toBe("2");
      expect(rows[0].name).toBe("dbg-jobs Lead");
      expect(JSON.parse(String(rows[0].details))).toEqual({ level: "B2" });
      const c1 = await contact.POST(new NextRequest("https://www.borivon.com/api/v2/contact", { method: "POST", headers: ip, body: JSON.stringify({ name: "dbg-jobs C", email: "dbg-jobs-ent@example.invalid", company: "dbg co", message: "hi", lang: "de" }) }));
      expect(await c1.json()).toEqual({ ok: true });
      const ent = await sq(`SELECT company, lang, source, status FROM enterprise_leads WHERE email = 'dbg-jobs-ent@example.invalid'`);
      expect(ent).toEqual([{ company: "dbg co", lang: "de", source: "v2-contact", status: "new" }]);
    } finally {
      await sq(`DELETE FROM leads WHERE email LIKE 'dbg-jobs-%@example.invalid'`);
      await sq(`DELETE FROM enterprise_leads WHERE email LIKE 'dbg-jobs-%@example.invalid'`);
    }
  }, 120_000);

  it("calendar ICS feed on D1 matches Supabase for every user with a visible event; bad token 401", async () => {
    const { signFeedToken } = await import("@/lib/calendarFeed");
    const { NextRequest } = await import("next/server");
    const evs = await sq(`SELECT attendee_ids FROM calendar_events`);
    const users = new Set<string>();
    for (const e of evs) for (const u of JSON.parse(String(e.attendee_ids ?? "[]")) as string[]) users.add(u);
    const someone = (await sq(`SELECT user_id FROM candidate_profiles WHERE manually_verified = 0 LIMIT 1`))[0]?.user_id as string;
    if (someone) users.add(someone);
    const ids = [...users].slice(0, 6);
    const run = async () => {
      const { GET } = await import("@/app/api/portal/calendar/feed/[token]/route");
      const outp: string[] = [];
      for (const [i, u] of ids.entries()) {
        const r = await GET(new NextRequest(`https://www.borivon.com/api/portal/calendar/feed/x.ics`, { headers: { "cf-connecting-ip": `203.0.113.${100 + i}` } }), { params: Promise.resolve({ token: `${signFeedToken(u)}.ics` }) });
        outp.push(`${r.status}:${(await r.text()).replace(/\r\n/g, "\n")}`);
      }
      const bad = await GET(new NextRequest(`https://www.borivon.com/api/portal/calendar/feed/x.ics`, { headers: { "cf-connecting-ip": "203.0.113.99" } }), { params: Promise.resolve({ token: `${ids[0] ?? "x"}.AAAA.ics` }) });
      outp.push(String(bad.status));
      return outp;
    };
    const d1 = await run();
    vi.resetModules();
    process.env.DATA_BACKEND = "supabase";
    let sb: string[];
    try { sb = await run(); } finally { vi.resetModules(); process.env.DATA_BACKEND = "d1"; }
    console.log("ics", ids.length, "users; statuses", d1.map((x) => x.slice(0, 3)).join(","), "events per feed", d1.map((x) => (x.match(/BEGIN:VEVENT/g) ?? []).length).join(","));
    expect(d1.every((x, i) => i === d1.length - 1 || x.startsWith("200:"))).toBe(true);
    expect(d1[d1.length - 1]).toBe("401");
    expect(d1).toEqual(sb);
  }, 300_000);

  it("affiliate dashboard token on D1: GET dashboard, POST accept terms", async () => {
    const { generateDashToken, hashDashToken, AFFILIATE_TERMS_VERSION } = await import("@/lib/affiliates");
    const route = await import("@/app/api/affiliate/[token]/route");
    const { NextRequest } = await import("next/server");
    const token = generateDashToken();
    await sq(`INSERT INTO affiliates (code, dash_token_hash, name, commission_eur) VALUES ('DBGJOBS9', ?, 'dbg-jobs Aff', 150.5)`, [await hashDashToken(token)]);
    try {
      const ip = { "cf-connecting-ip": "203.0.113.80" };
      const g = await route.GET(new NextRequest(`https://affiliates.borivon.com/api/affiliate/${token}`, { headers: ip }), { params: Promise.resolve({ token }) });
      const gj = await g.json();
      console.log("aff GET", g.status, JSON.stringify(gj));
      expect(g.status).toBe(200);
      expect(gj).toMatchObject({ name: "dbg-jobs Aff", active: true, commissionEur: 150.5, referred: 0, placed: 0, termsAccepted: false });
      const p = await route.POST(new NextRequest(`https://affiliates.borivon.com/api/affiliate/${token}`, { method: "POST", headers: { ...ip, "content-type": "application/json" }, body: JSON.stringify({ accept: true, version: AFFILIATE_TERMS_VERSION }) }), { params: Promise.resolve({ token }) });
      console.log("aff POST", p.status, JSON.stringify(await p.clone().json()));
      const g2 = await (await route.GET(new NextRequest(`https://affiliates.borivon.com/api/affiliate/${token}`, { headers: ip }), { params: Promise.resolve({ token }) })).json();
      expect(g2.termsAccepted).toBe(true);
      const bad = await route.GET(new NextRequest(`https://affiliates.borivon.com/api/affiliate/x`, { headers: ip }), { params: Promise.resolve({ token: "A".repeat(43) }) });
      expect(bad.status).toBe(404);
    } finally {
      await sq(`DELETE FROM affiliates WHERE code = 'DBGJOBS9'`);
    }
  }, 120_000);

  it("partner API on D1: key auth, shares scope, documents, access log", async () => {
    const { generatePartnerKey, hashPartnerKey, keyPrefixOf } = await import("@/lib/partnerKeys");
    const cands = await import("@/app/api/partner/v1/candidates/route");
    const docsRoute = await import("@/app/api/partner/v1/documents/[id]/route");
    const { NextRequest } = await import("next/server");
    const share = (await sq(`SELECT org_id, candidate_user_id FROM partner_shares WHERE revoked_at IS NULL LIMIT 1`))[0];
    expect(share).toBeTruthy();
    const key = generatePartnerKey();
    const keyId = "dbdbdbdb-0b05-4000-8000-0000000000d1";
    await sq(`INSERT INTO partner_api_keys (id, org_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?, 'dbg-jobs')`, [keyId, share.org_id, await hashPartnerKey(key), keyPrefixOf(key)]);
    try {
      const h = { "cf-connecting-ip": "203.0.113.81", authorization: `Bearer ${key}` };
      const c = await cands.GET(new NextRequest("https://admin.calmaroi.de/api/partner/v1/candidates", { headers: h }));
      const cj = await c.json();
      const sharedLive = await sq(`SELECT DISTINCT candidate_user_id FROM partner_shares WHERE org_id = ? AND revoked_at IS NULL`, [share.org_id]);
      console.log("partner candidates", c.status, "count", cj.count, "live shares", sharedLive.length, "doc counts", JSON.stringify((cj.candidates ?? []).map((x: { documents?: unknown[] }) => x.documents?.length)));
      expect(c.status).toBe(200);
      expect(cj.count).toBe(sharedLive.length);
      const doc = (await sq(`SELECT id FROM documents WHERE user_id = ? AND status = 'approved' AND superseded_at IS NULL AND r2_key IS NOT NULL LIMIT 1`, [share.candidate_user_id]))[0];
      if (doc) {
        const d = await docsRoute.GET(new NextRequest(`https://admin.calmaroi.de/api/partner/v1/documents/${doc.id}`, { headers: h }), { params: Promise.resolve({ id: String(doc.id) }) });
        expect(d.status).toBe(200);
      }
      const other = (await sq(`SELECT id FROM documents WHERE user_id <> ? AND status = 'approved' AND superseded_at IS NULL LIMIT 1`, [share.candidate_user_id]))[0];
      const d2 = await docsRoute.GET(new NextRequest(`https://admin.calmaroi.de/api/partner/v1/documents/${other.id}`, { headers: h }), { params: Promise.resolve({ id: String(other.id) }) });
      expect(d2.status).toBe(404);
      const badKey = await cands.GET(new NextRequest("https://admin.calmaroi.de/api/partner/v1/candidates", { headers: { ...h, authorization: `Bearer ${key.slice(0, -2)}xx` } }));
      expect(badKey.status).toBe(401);
      await new Promise((r) => setTimeout(r, 1500));
      const log = await sq(`SELECT path, status FROM partner_api_log WHERE key_id = ? ORDER BY id`, [keyId]);
      const used = await sq(`SELECT last_used_at FROM partner_api_keys WHERE id = ?`, [keyId]);
      console.log("partner log", JSON.stringify(log), "last_used_at set", used[0]?.last_used_at != null);
      expect(log.map((l) => l.status)).toEqual(doc ? [200, 200, 404] : [200, 404]);
    } finally {
      await sq(`DELETE FROM partner_api_log WHERE key_id = ? OR (key_id IS NULL AND path = '/candidates' AND status = 401 AND at >= ?)`, [keyId, new Date(Date.now() - 600e3).toISOString().slice(0, 19)]);
      await sq(`DELETE FROM partner_api_keys WHERE id = ?`, [keyId]);
    }
  }, 120_000);

  it("invite GET on D1 matches Supabase for every code; check-email answers", async () => {
    const { NextRequest } = await import("next/server");
    const codes = (await sq(`SELECT code FROM invite_tokens ORDER BY created_at DESC LIMIT 25`)).map((r) => String(r.code));
    const orgCodes = (await sq(`SELECT invite_code, member_invite_code FROM organizations`)).flatMap((r) => [r.invite_code, r.member_invite_code]).filter(Boolean).map(String);
    const all = [...codes, ...orgCodes, "NOPE-NOT-A-CODE"];
    const run = async () => {
      const { GET } = await import("@/app/api/portal/invite/[code]/route");
      const res: string[] = [];
      for (const [i, code] of all.entries()) {
        const r = await GET(new NextRequest(`https://www.borivon.com/api/portal/invite/x`, { headers: { "cf-connecting-ip": `198.51.100.${i % 250}` } }), { params: Promise.resolve({ code }) });
        res.push(`${r.status}:${await r.text()}`);
      }
      return res;
    };
    const d1 = await run();
    vi.resetModules();
    process.env.DATA_BACKEND = "supabase";
    let sb: string[];
    try { sb = await run(); } finally { vi.resetModules(); process.env.DATA_BACKEND = "d1"; }
    const diffs = d1.map((x, i) => (x === sb[i] ? null : i)).filter((x) => x !== null);
    console.log("invite statuses", d1.map((x) => x.slice(0, 3)).join(","), "diff idx", JSON.stringify(diffs));
    expect(diffs).toEqual([]);
    const { POST } = await import("@/app/api/portal/check-email/route");
    const ce = await POST(new NextRequest("https://www.borivon.com/api/portal/check-email", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.82", "content-type": "application/json" }, body: JSON.stringify({ email: "dbg-jobs-nobody@example.invalid" }) }));
    expect(await ce.json()).toEqual({ exists: false });
  }, 300_000);

  it("reminders route honours bot_quiet=hold on D1 (skipped quiet)", async () => {
    const { GET } = await import("@/app/api/cron/reminders/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest("https://cron.internal/api/cron/reminders", { headers: { authorization: "Bearer dbg-jobs-secret" } }));
    expect(await res.json()).toEqual({ skipped: "quiet" });
    const bad = await GET(new NextRequest("https://cron.internal/api/cron/reminders?secret=dbg-jobs-secret"));
    expect(bad.status).toBe(403);
  }, 60_000);
});
