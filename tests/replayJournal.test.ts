import { describe, it, expect, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import registryJson from "@/d1/types.json";
import type { Registry } from "@/lib/d1/pgrest/types";
import type { D1Runner } from "@/lib/d1/client";
import { appendEntry, resetJournalForTests, JOURNAL_DDL, type JournalEntry } from "@/lib/d1/writeJournal";
import { makeBvFetch } from "@/lib/d1/bvFetch";
import { buildServiceFetch } from "@/lib/d1/serviceFetch";
import {
  replayJournal, describeEntry, replayPrefer, mergeFill, redactMessage, REPLAYED_TABLE,
} from "../d1/replay-journal.mjs";
import { hasSqlite, openDb, sqliteRunner, type SqliteDb } from "./helpers/sqliteD1";

/**
 * The rollback's promise: every write D1 took reaches Supabase, in order, once —
 * even across an interrupted run. Never against the real Supabase: the target
 * here is a recording fake, and (last block) a second SQLite answering PostgREST
 * through the adapter, so "loses nothing" is checked row for row.
 */

const registry = registryJson as unknown as Registry;
const SB = "https://p.supabase.co";
const U1 = "11111111-1111-4111-8111-111111111111";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Sent = { method: string; url: string; body?: string; prefer: string | null; apikey: string | null };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A Supabase stand-in: records every request, answers what the test scripts. */
function fakeSupabase(answer: (s: Sent) => Response | undefined = () => undefined) {
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    const s: Sent = { method: init?.method ?? "GET", url: String(input), body: init?.body as string | undefined, prefer: h.get("prefer"), apikey: h.get("apikey") };
    sent.push(s);
    return answer(s) ?? new Response(null, { status: s.method === "POST" ? 201 : 204 });
  }) as typeof fetch;
  return { sent, target: { url: SB, key: "service-key", fetch } };
}

const quiet = () => { const lines: string[] = []; return { lines, log: (l: string) => lines.push(l) }; };

describe("pure pieces", () => {
  it("describes an entry with no value in it", () => {
    const e = { id: 7, method: "PATCH", path: `/rest/v1/candidate_profiles?user_id=eq.${U1}&email=ilike.*nurse%40mail.ma*&or=(passport_no.eq.AB12,city.eq.Fes)` };
    const d = describeEntry(e);
    expect(d).toBe("#7 PATCH candidate_profiles user_id=eq email=ilike or=(passport_no");
    for (const v of [U1, "nurse", "AB12", "Fes"]) expect(d).not.toContain(v);
  });

  it("asks for no rows back, and keeps what shaped the write", () => {
    expect(replayPrefer("return=representation,resolution=merge-duplicates,count=exact", false)).toBe("resolution=merge-duplicates,return=minimal");
    expect(replayPrefer(null, false)).toBe("return=minimal");
    expect(replayPrefer("missing=default", false)).toBe("missing=default,return=minimal");
    expect(replayPrefer("return=representation", true)).toBe("");
  });

  it("merges generated values into upsert rows and lists them in columns=, touching nothing else", () => {
    const path = `/rest/v1/employers?on_conflict=slug&columns=${encodeURIComponent('"slug","name"')}&select=*`;
    const body = JSON.stringify([{ slug: "a", name: "A" }, { slug: "b", name: "B", id: ID(9) }]);
    const out = mergeFill(path, body, [{ id: ID(1), created_at: "2026-09-14T10:00:00.000000+00:00" }, { id: ID(2) }]);
    expect(JSON.parse(out.body!)).toEqual([
      { slug: "a", name: "A", id: ID(1), created_at: "2026-09-14T10:00:00.000000+00:00" },
      { slug: "b", name: "B", id: ID(9) },                          // the caller's own id wins
    ]);
    expect(out.path.startsWith("/rest/v1/employers?on_conflict=slug&columns=")).toBe(true);
    expect(out.path.endsWith("&select=*")).toBe(true);
    expect(new URL(out.path, SB).searchParams.get("columns")).toBe('"slug","name","id","created_at"');
    expect(mergeFill(path, body, null)).toEqual({ path, body });
  });

  it("redacts values from PostgREST messages but keeps constraint names", () => {
    expect(redactMessage('invalid input syntax for type uuid: "not-a-uuid"')).toBe('invalid input syntax for type uuid: "…"');
    expect(redactMessage('duplicate key value violates unique constraint "leads_email_key"')).toContain('"leads_email_key"');
  });
});

describe.skipIf(!hasSqlite)("replayJournal", () => {
  let d1: SqliteDb;
  let runner: D1Runner;

  /** Journal entries in a chosen ORDER that differs from their id order. */
  async function journal(entries: Partial<JournalEntry>[], fills: (unknown[] | null)[] = []) {
    for (const ddl of JOURNAL_DDL) await runner.run(ddl);
    const ids: number[] = [];
    for (const [i, e] of entries.entries()) {
      ids.push(await appendEntry(runner, {
        at: "2026-09-14T10:00:00.000Z", at_ms: 1000 + i, seq: i + 1, method: "POST", path: "/rest/v1/notifications",
        prefer: "return=representation", body: null, status: 201, note: null, ...e,
      }, (fills[i] ?? null) as never));
    }
    return ids;
  }
  const marks = () => d1.prepare(`SELECT journal_id, target, outcome FROM "${REPLAYED_TABLE}" ORDER BY journal_id`).all();

  beforeEach(() => {
    d1 = openDb();
    runner = sqliteRunner(d1);
    resetJournalForTests();
  });

  it("with no journal table, has nothing to do", async () => {
    const { target, sent } = fakeSupabase();
    const out = await replayJournal({ d1: runner, target, registry, dryRun: false, log: quiet().log });
    expect(out).toMatchObject({ ok: true, journaled: 0, sent: 0 });
    expect(sent).toEqual([]);
  });

  it("is a dry run by default: sends nothing, creates nothing, lists the order it would use", async () => {
    // Appended out of order: the replay must follow at_ms/seq, not the row id.
    await journal([
      { at_ms: 3000, seq: 1, method: "DELETE", path: `/rest/v1/notifications?id=eq.${ID(1)}` },
      { at_ms: 1000, seq: 1, body: JSON.stringify({ id: ID(1), user_id: U1, doc_name: "passport" }) },
      { at_ms: 2000, seq: 5, method: "PATCH", path: `/rest/v1/notifications?id=eq.${ID(1)}`, body: JSON.stringify({ read: true }) },
    ]);
    const { target, sent } = fakeSupabase();
    const out = quiet();
    const summary = await replayJournal({ d1: runner, target, registry, log: out.log });
    expect(summary).toMatchObject({ dryRun: true, ok: false, pending: 3, sent: 0 });
    expect(sent).toEqual([]);
    expect(d1.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).all(REPLAYED_TABLE)).toEqual([]);
    const would = out.lines.filter((l) => l.includes("would replay")).map((l) => l.replace(/^.*would replay #\d+ /, ""));
    expect(would).toEqual(["POST notifications", "PATCH notifications id=eq", "DELETE notifications id=eq"]);
    expect(out.lines.join("\n")).not.toMatch(/passport|1111/);
  });

  it("replays in order with the service key, byte-identical bodies, and marks each", async () => {
    const insert = JSON.stringify({ id: ID(1), user_id: U1, doc_name: "cv", doc_type: "t", action: "x" });
    const ids = await journal([
      { at_ms: 2000, seq: 1, method: "PATCH", path: `/rest/v1/notifications?id=eq.${ID(1)}`, body: JSON.stringify({ read: true }), prefer: "return=minimal" },
      { at_ms: 1000, seq: 9, body: insert, prefer: "return=representation" },
      { at_ms: 2000, seq: 2, method: "POST", path: "/rest/v1/rpc/claim_upload_key", body: JSON.stringify({ p_link_id: ID(5), p_key: "cv" }), prefer: null, status: 200 },
    ]);
    const { target, sent } = fakeSupabase();
    const summary = await replayJournal({ d1: runner, target, registry, dryRun: false, log: quiet().log });
    expect(summary).toMatchObject({ ok: true, sent: 3, pending: 0 });
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      `POST ${SB}/rest/v1/notifications`,
      `PATCH ${SB}/rest/v1/notifications?id=eq.${ID(1)}`,
      `POST ${SB}/rest/v1/rpc/claim_upload_key`,
    ]);
    expect(sent[0].body).toBe(insert);
    expect(sent.every((s) => s.apikey === "service-key")).toBe(true);
    expect(sent.map((s) => s.prefer)).toEqual(["return=minimal", "return=minimal", null]);
    expect(marks().map((m) => m.journal_id)).toEqual([ids[0], ids[1], ids[2]].sort((a, b) => a - b));
    expect(marks().every((m) => m.target === "p.supabase.co" && m.outcome === "applied")).toBe(true);
  });

  it("is idempotent: a second run sends nothing", async () => {
    await journal([{ body: JSON.stringify({ id: ID(1) }) }, { method: "DELETE", path: `/rest/v1/notifications?id=eq.${ID(1)}` }]);
    const first = fakeSupabase();
    await replayJournal({ d1: runner, target: first.target, registry, dryRun: false, log: quiet().log });
    const second = fakeSupabase();
    const summary = await replayJournal({ d1: runner, target: second.target, registry, dryRun: false, log: quiet().log });
    expect(first.sent).toHaveLength(2);
    expect(second.sent).toEqual([]);
    expect(summary).toMatchObject({ ok: true, alreadyReplayed: 2, pending: 0, sent: 0 });
  });

  it("halts on a refusal before sending anything later, and resumes where it stopped", async () => {
    await journal([
      { body: JSON.stringify({ id: ID(1) }) },
      { method: "PATCH", path: `/rest/v1/notifications?id=eq.${ID(1)}`, body: JSON.stringify({ read: true }) },
      { method: "DELETE", path: `/rest/v1/notifications?id=eq.${ID(1)}` },
    ]);
    let down = true;
    const flaky = fakeSupabase((s) => (down && s.method === "PATCH" ? json(503, { code: "PGRST000", message: "Could not connect" }) : undefined));
    const out = quiet();
    const halted = await replayJournal({ d1: runner, target: flaky.target, registry, dryRun: false, log: out.log });
    expect(halted.ok).toBe(false);
    expect(flaky.sent.map((s) => s.method)).toEqual(["POST", "PATCH"]);
    expect(marks()).toHaveLength(1);
    expect(out.lines.some((l) => l.startsWith("HALT at #2 PATCH notifications id=eq"))).toBe(true);

    down = false;
    flaky.sent.length = 0;
    const resumed = await replayJournal({ d1: runner, target: flaky.target, registry, dryRun: false, log: quiet().log });
    expect(resumed).toMatchObject({ ok: true, sent: 2 });
    expect(flaky.sent.map((s) => s.method)).toEqual(["PATCH", "DELETE"]);
  });

  it("recognises the insert an interrupted run already delivered, by primary key", async () => {
    await journal([{ body: JSON.stringify([{ id: ID(1), user_id: U1 }, { id: ID(2), user_id: U1 }]) }, { method: "DELETE", path: `/rest/v1/notifications?id=eq.${ID(2)}` }]);
    const present = new Set([ID(1), ID(2)]);
    const sb = fakeSupabase((s) => {
      if (s.method === "POST") return json(409, { code: "23505", message: 'duplicate key value violates unique constraint "notifications_pkey"' });
      if (s.method === "GET") { const id = new URL(s.url).searchParams.get("id")!.slice(3); return json(200, present.has(id) ? [{ id }] : []); }
    });
    const summary = await replayJournal({ d1: runner, target: sb.target, registry, dryRun: false, log: quiet().log });
    expect(summary).toMatchObject({ ok: true, sent: 2, alreadyPresent: 1 });
    expect(marks().map((m) => m.outcome)).toEqual(["already-present", "applied"]);
    expect(sb.sent.filter((s) => s.method === "GET").every((s) => s.url.includes("select=id&id=eq."))).toBe(true);
  });

  it("halts on a conflict that is NOT a row it already delivered, without printing the value", async () => {
    await journal([{ path: "/rest/v1/leads", body: JSON.stringify({ id: ID(1), email: "nurse@mail.ma" }) }]);
    const sb = fakeSupabase((s) => {
      if (s.method === "POST") return json(409, { code: "23505", message: 'duplicate key value violates unique constraint "leads_email_key"', details: "Key (email)=(nurse@mail.ma) already exists." });
      if (s.method === "GET") return json(200, []);
    });
    const out = quiet();
    const summary = await replayJournal({ d1: runner, target: sb.target, registry, dryRun: false, log: out.log });
    expect(summary).toMatchObject({ ok: false, haltedAt: 1, sent: 0 });
    expect(out.lines.join("\n")).toContain("leads_email_key");
    expect(out.lines.join("\n")).not.toContain("nurse@mail.ma");
  });

  it("merges read-back values into an upsert and reassembles a body stored in parts", async () => {
    const big = JSON.stringify({ id: ID(3), body: "y".repeat(1_100_000) });
    await journal([
      { path: `/rest/v1/employers?on_conflict=slug&columns=${encodeURIComponent('"slug","name"')}`, prefer: "resolution=merge-duplicates", body: JSON.stringify([{ slug: "uksh", name: "UKSH" }]) },
      { path: "/rest/v1/messages", body: big },
    ], [[{ id: ID(2), created_at: "2026-09-14T10:00:00.000000+00:00" }], null]);
    const { target, sent } = fakeSupabase();
    await replayJournal({ d1: runner, target, registry, dryRun: false, log: quiet().log });
    expect(JSON.parse(sent[0].body!)).toEqual([{ slug: "uksh", name: "UKSH", id: ID(2), created_at: "2026-09-14T10:00:00.000000+00:00" }]);
    expect(new URL(sent[0].url).searchParams.get("columns")).toBe('"slug","name","id","created_at"');
    expect(sent[0].prefer).toBe("resolution=merge-duplicates,return=minimal");
    expect(sent[1].body).toBe(big);
  });

  it("refuses to replay a late entry out of order unless told to", async () => {
    const ids = await journal([{ body: JSON.stringify({ id: ID(1) }) }, { body: JSON.stringify({ id: ID(2) }) }, { body: JSON.stringify({ id: ID(3) }) }]);
    // Entries 1 and 3 were replayed; 2 was journaled late (its background insert lagged).
    await runner.run(`CREATE TABLE IF NOT EXISTS "${REPLAYED_TABLE}" ("journal_id" INTEGER NOT NULL, "target" TEXT NOT NULL, "at" TEXT NOT NULL, "status" INTEGER NOT NULL, "outcome" TEXT NOT NULL, PRIMARY KEY ("journal_id", "target"))`);
    for (const id of [ids[0], ids[2]]) d1.prepare(`INSERT INTO "${REPLAYED_TABLE}" VALUES (?, 'p.supabase.co', 'x', 201, 'applied')`).run(id);
    const sb = fakeSupabase();
    const refused = await replayJournal({ d1: runner, target: sb.target, registry, dryRun: false, log: quiet().log });
    expect(refused).toMatchObject({ ok: false, late: 1, sent: 0 });
    expect(sb.sent).toEqual([]);
    const allowed = await replayJournal({ d1: runner, target: sb.target, registry, dryRun: false, allowLate: true, log: quiet().log });
    expect(allowed).toMatchObject({ ok: true, sent: 1 });
    expect(sb.sent.map((s) => JSON.parse(s.body!).id)).toEqual([ID(2)]);
  });

  it("halts on an entry whose body was never recorded, and honours --limit", async () => {
    await journal([{ body: JSON.stringify({ id: ID(1) }) }, { body: JSON.stringify({ id: ID(2) }) }, { note: "body-unrecordable" }]);
    const sb = fakeSupabase();
    const limited = await replayJournal({ d1: runner, target: sb.target, registry, dryRun: false, limit: 1, log: quiet().log });
    expect(limited).toMatchObject({ ok: false, sent: 1, pending: 2 });
    const out = quiet();
    const halted = await replayJournal({ d1: runner, target: sb.target, registry, dryRun: false, log: out.log });
    expect(halted).toMatchObject({ ok: false, haltedAt: 3, sent: 1 });
    expect(sb.sent).toHaveLength(2);
    expect(out.lines.some((l) => l.includes("WARN #3") && l.includes("not recorded"))).toBe(true);
  });
});

describe.skipIf(!hasSqlite)("a rollback loses nothing: D1 writes → journal → replay → identical database", () => {
  it("rebuilds every row, generated ids and timestamps included", async () => {
    resetJournalForTests();
    // "D1" takes the writes; "Supabase" starts as the same copy and receives the replay.
    const d1Db = openDb({ schema: true }), sbDb = openDb({ schema: true });
    const d1 = sqliteRunner(d1Db), sb = sqliteRunner(sbDb);
    const seed = `INSERT INTO upload_links (id, token_hash, candidate_user_id, doc_keys, uploaded_keys, expires_at, created_at) VALUES ('${ID(50)}', 'h', '${U1}', '["cv","passport"]', '[]', '2030-01-01T00:00:00.000000+00:00', '2026-01-01T00:00:00.000000+00:00')`;
    d1Db.exec(seed); sbDb.exec(seed);

    const pending: Promise<void>[] = [];
    const noNetwork = (async () => { throw new Error("no network"); }) as unknown as typeof fetch;
    const portal = createClient(SB, "service", {
      auth: { persistSession: false },
      global: { fetch: buildServiceFetch({ backend: "d1", shadow: false, freeze: false }, { base: noNetwork, runner: d1, journal: { schedule: (w) => { pending.push(w()); } } }) },
    });

    // A day of portal traffic in miniature.
    const { data: n1 } = await portal.from("notifications").insert({ user_id: U1, doc_name: "cv", doc_type: "cv_de", action: "uploaded" }).select("id").single();
    await portal.from("notifications").insert([
      { user_id: U1, doc_name: "passport", doc_type: "passport", action: "approved" },
      { user_id: U1, doc_name: "b2", doc_type: "b2", action: "rejected" },
    ]);
    await portal.from("notifications").update({ read: true }).eq("id", n1!.id);
    await portal.from("notifications").delete().eq("doc_name", "b2");
    await portal.from("employers").upsert({ slug: "uksh", name: "UKSH", address_lines: ["Kiel"] }, { onConflict: "slug" });
    await portal.from("app_settings").upsert({ key: "telegram_silenced", value: "on" });
    await portal.rpc("claim_upload_key", { p_link_id: ID(50), p_key: "cv" });
    await portal.rpc("rl_hit", { p_key: "ip:1", p_window_ms: 60_000 });   // ephemeral: not journaled, not replayed
    while (pending.length) await Promise.all(pending.splice(0));

    const summary = await replayJournal({
      d1,
      target: { url: SB, key: "service", fetch: makeBvFetch({ runner: sb }) },
      registry, dryRun: false, log: quiet().log,
    });
    expect(summary).toMatchObject({ ok: true, sent: 7, pending: 0 });

    const dump = (db: SqliteDb, table: string, key: string) => db.prepare(`SELECT * FROM "${table}" ORDER BY "${key}"`).all();
    for (const [table, key] of [["notifications", "id"], ["employers", "id"], ["app_settings", "key"], ["upload_links", "id"]]) {
      const expected = dump(d1Db, table, key);
      expect(expected.length, table).toBeGreaterThan(0);
      expect(dump(sbDb, table, key), table).toEqual(expected);
    }
    expect(dump(sbDb, "notifications", "id")).toHaveLength(2);
  });
});
