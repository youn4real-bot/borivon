import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkJournal, runHealthProbes, JOURNAL_LAG_MS } from "../lib/healthProbes";
import { JOURNAL_DDL } from "@/lib/d1/writeJournal";
import { hasSqlite, openDb, sqliteRunner, type SqliteDb } from "./helpers/sqliteD1";

/**
 * Since the flip the hourly watchdog's `database` probe reads D1, so two things
 * that decide whether the portal survives the next months had no alarm at all:
 * Supabase (the logins) pausing, and the rollback journal silently not recording.
 */

vi.mock("@/lib/googleWorkspace", () => ({ testWorkspace: async () => ({ ok: true, gmail: true, calendar: true, drive: true }) }));
vi.mock("@/lib/r2", () => ({ r2Configured: () => true, r2List: async () => [] }));
vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => ({ from: () => ({ select: () => Promise.resolve({ count: 1, error: null }) }) }),
}));

describe("auth probe: the logins Supabase still runs", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://p.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("is red when Supabase auth does not answer 200 (a paused project), with the database probe still green", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { calls.push(String(u)); return new Response("paused", { status: 540 }); }));
    const probes = await runHealthProbes();
    expect(probes.find((p) => p.name === "database")!.ok).toBe(true);
    expect(probes.find((p) => p.name === "auth")).toMatchObject({ ok: false, detail: expect.stringContaining("540") });
    expect(calls).toEqual(["https://p.supabase.co/auth/v1/health"]);
  });

  it("is green when it answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    expect((await runHealthProbes()).find((p) => p.name === "auth")!.ok).toBe(true);
  });
});

describe.skipIf(!hasSqlite)("journal probe: every new row has its journaled insert", () => {
  let db: SqliteDb;
  const NOW = Date.parse("2026-10-08T12:00:00.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const journal = (at: number, path: string, method = "POST") => db.prepare(`INSERT INTO _write_journal (at, at_ms, seq, method, path, status) VALUES (?, ?, 1, ?, ?, 201)`).run(iso(at), at, method, path);
  const notification = (at: number) => db.prepare(`INSERT INTO notifications (id, user_id, doc_name, doc_type, action, created_at) VALUES (lower(hex(randomblob(16))), 'u', 'cv', 't', 'approved', ?)`).run(iso(at).replace("Z", "+00:00"));

  beforeEach(async () => {
    db = openDb({ schema: true });
    for (const ddl of JOURNAL_DDL) await sqliteRunner(db).run(ddl);
    notification(NOW - 5 * 86_400_000);                     // the copy's own rows predate the journal
    journal(NOW - 2 * 86_400_000, "/rest/v1/leads");        // first journaled write after the flip
  });

  it("green when the newest rows predate the journal or were journaled", async () => {
    expect((await checkJournal(sqliteRunner(db), NOW)).ok).toBe(true);
    notification(NOW - 3_600_000);
    journal(NOW - 3_600_000 + 200, "/rest/v1/notifications?columns=%22id%22");
    expect((await checkJournal(sqliteRunner(db), NOW)).ok).toBe(true);
  });

  it("red, naming the table only, when a row is newer than every journaled insert into its table", async () => {
    journal(NOW - 7_200_000, "/rest/v1/notifications");
    notification(NOW - 7_200_000 + JOURNAL_LAG_MS + 60_000);
    const probe = await checkJournal(sqliteRunner(db), NOW);
    expect(probe).toMatchObject({ name: "journal", ok: false });
    expect(probe.detail).toMatch(/^newest notifications row/);
  });

  it("green when the newest timestamp came from a journaled UPDATE (the page organiser re-stamps uploaded_at)", async () => {
    const doc = (at: number) => db.prepare(`INSERT INTO documents (id, user_id, file_name, file_path, uploaded_at) VALUES (lower(hex(randomblob(16))), 'u', 'f.pdf', 'p', ?)`).run(iso(at).replace("Z", "+00:00"));
    journal(NOW - 7_200_000, "/rest/v1/documents");
    doc(NOW - 7_200_000);
    doc(NOW - 3_600_000);                                   // stands for the PATCH's new uploaded_at
    journal(NOW - 3_600_000 + 200, "/rest/v1/documents?id=eq.x", "PATCH");
    expect((await checkJournal(sqliteRunner(db), NOW)).ok).toBe(true);
  });

  it("no journal table yet is not an alarm", async () => {
    expect(await checkJournal(sqliteRunner(openDb({ schema: true })), NOW)).toMatchObject({ ok: true });
  });
});
