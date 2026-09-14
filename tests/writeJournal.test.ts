import { describe, it, expect, beforeEach } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import registryJson from "@/d1/types.json";
import type { Registry } from "@/lib/d1/pgrest/types";
import type { D1Runner } from "@/lib/d1/client";
import {
  journalTarget, prepareWrite, withWriteJournal, appendEntry, resetJournalForTests,
  JOURNAL_DDL, JOURNAL_TABLE, JOURNAL_PART_TABLE, PART_CHARS, type JournalOptions,
} from "@/lib/d1/writeJournal";
import { makeBvFetch } from "@/lib/d1/bvFetch";
import { buildServiceFetch } from "@/lib/d1/serviceFetch";
import { hasSqlite, openDb, sqliteRunner, type SqliteDb } from "./helpers/sqliteD1";

/**
 * The write journal is what makes a rollback from D1 lossless. Two promises to
 * keep: every write D1 accepted is recorded exactly as D1 applied it (same
 * generated ids and timestamps, or the replay lands different rows), and the
 * journal can never cost the user the write it records.
 */

const registry = registryJson as unknown as Registry;
const SB = "https://p.supabase.co";
const U1 = "11111111-1111-4111-8111-111111111111";
const FIXED_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIXED_NOW = "2026-09-14T10:00:00.000Z";

describe("journalTarget", () => {
  it("names the table or function of every mutating PostgREST request", () => {
    expect(journalTarget("POST", `${SB}/rest/v1/notifications?columns=%22a%22`)).toEqual({ table: "notifications", rpc: null });
    expect(journalTarget("patch", `${SB}/rest/v1/documents?id=eq.1`)).toEqual({ table: "documents", rpc: null });
    expect(journalTarget("DELETE", `${SB}/rest/v1/documents?id=eq.1`)).toEqual({ table: "documents", rpc: null });
    expect(journalTarget("POST", `${SB}/rest/v1/rpc/claim_upload_key`)).toEqual({ table: null, rpc: "claim_upload_key" });
  });

  it("ignores reads, the rate-limit counter, and everything that is not data", () => {
    expect(journalTarget("GET", `${SB}/rest/v1/documents`)).toBeNull();
    expect(journalTarget("HEAD", `${SB}/rest/v1/documents`)).toBeNull();
    expect(journalTarget("POST", `${SB}/rest/v1/rpc/rl_hit`)).toBeNull();
    expect(journalTarget("POST", `${SB}/auth/v1/token?grant_type=password`)).toBeNull();
    expect(journalTarget("POST", `${SB}/storage/v1/object/photos/a.jpg`)).toBeNull();
  });
});

describe("prepareWrite", () => {
  const gen = { uuid: () => FIXED_UUID, now: () => FIXED_NOW };
  const N = `${SB}/rest/v1/notifications`;

  it("prefills the id and timestamp a plain insert would let the database invent", () => {
    const body = JSON.stringify({ user_id: U1, doc_name: "cv", doc_type: "cv_de", action: "approved" });
    const out = prepareWrite("POST", N, "return=representation", body, registry, gen);
    expect(out.changed).toBe(true);
    const row = JSON.parse(out.body!);
    expect(row).toMatchObject({ id: FIXED_UUID, created_at: FIXED_NOW, user_id: U1 });
    // A constant default does not differ between D1 and Supabase: left to the database.
    expect(row).not.toHaveProperty("read");
    expect(out.fillPlan).toBeNull();
  });

  it("keeps an id the caller chose, and names added columns in columns=", () => {
    const rows = [{ id: U1, user_id: U1, doc_name: "a", doc_type: "t", action: "x" }, { user_id: U1, doc_name: "b", doc_type: "t", action: "x" }];
    const url = `${N}?columns=${encodeURIComponent('"id","user_id","doc_name","doc_type","action"')}`;
    const out = prepareWrite("POST", url, null, JSON.stringify(rows), registry, gen);
    const sent = JSON.parse(out.body!);
    expect(sent[0].id).toBe(U1);
    // "id" IS in columns, so the second row's missing id stays NULL — PostgREST's semantics, not ours to change.
    expect(sent[1]).not.toHaveProperty("id");
    expect(sent.map((r: { created_at: string }) => r.created_at)).toEqual([FIXED_NOW, FIXED_NOW]);
    expect(new URL(out.url).searchParams.get("columns")).toBe('"id","user_id","doc_name","doc_type","action","created_at"');
  });

  it("prefills a listed column only under missing=default", () => {
    const url = `${N}?columns=${encodeURIComponent('"user_id","created_at"')}`;
    const rows = JSON.stringify([{ user_id: U1 }]);
    expect(JSON.parse(prepareWrite("POST", url, null, rows, registry, gen).body!)[0]).not.toHaveProperty("created_at");
    expect(JSON.parse(prepareWrite("POST", url, "missing=default", rows, registry, gen).body!)[0].created_at).toBe(FIXED_NOW);
  });

  it("never rewrites an upsert on a non-key target — it plans to read the generated values back", () => {
    const body = JSON.stringify({ slug: "uksh", name: "UKSH", address_lines: [] });
    const out = prepareWrite("POST", `${SB}/rest/v1/employers?on_conflict=slug`, "resolution=merge-duplicates", body, registry, gen);
    expect(out.changed).toBe(false);
    expect(out.body).toBe(body);
    expect(out.fillPlan).toMatchObject({ table: "employers", keyCols: ["slug"] });
    expect(new Set(out.fillPlan!.missing[0])).toEqual(new Set(["id", "created_at", "updated_at"]));
  });

  it("prefills only the key of an upsert on its primary key", () => {
    const body = JSON.stringify({ user_id: U1, doc_name: "a", doc_type: "t", action: "x" });
    const out = prepareWrite("POST", `${SB}/rest/v1/notifications?on_conflict=id`, "resolution=merge-duplicates", body, registry, gen);
    const row = JSON.parse(out.body!);
    expect(row.id).toBe(FIXED_UUID);
    expect(row).not.toHaveProperty("created_at");
    expect(out.fillPlan?.missing[0]).toEqual(["created_at"]);
  });

  it("leaves updates, deletes, unknown tables and unparseable bodies alone", () => {
    for (const [m, url, body] of [
      ["PATCH", `${N}?id=eq.${U1}`, JSON.stringify({ read: true })],
      ["DELETE", `${N}?id=eq.${U1}`, undefined],
      ["POST", `${SB}/rest/v1/not_a_table`, "{}"],
      ["POST", N, "{not json"],
    ] as const) {
      const out = prepareWrite(m, url, null, body, registry, gen);
      expect(out.changed, `${m} ${url}`).toBe(false);
      expect(out.body).toBe(body);
    }
  });
});

describe.skipIf(!hasSqlite)("withWriteJournal against a real SQLite", () => {
  let d1: SqliteDb;
  let runner: D1Runner;
  let pending: Promise<void>[];
  let logs: string[];
  const noNetwork = (async () => { throw new Error("the network must not be called"); }) as unknown as typeof fetch;

  function client(journal: JournalOptions = {}): SupabaseClient {
    const f = buildServiceFetch({ backend: "d1", shadow: false, freeze: false }, {
      base: noNetwork,
      runner,
      journal: { schedule: (work) => { pending.push(work()); }, log: (_l, line) => logs.push(line), ...journal },
    });
    return createClient(SB, "service", { global: { fetch: f }, auth: { persistSession: false } });
  }
  const flush = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  const journal = () => d1.prepare(`SELECT * FROM "${JOURNAL_TABLE}" ORDER BY "at_ms", "seq", "id"`).all();

  beforeEach(() => {
    d1 = openDb({ schema: true });
    runner = sqliteRunner(d1);
    pending = [];
    logs = [];
    resetJournalForTests();
  });

  it("records an insert with the SAME id and created_at D1 stored", async () => {
    const { data, error } = await client().from("notifications")
      .insert({ user_id: U1, doc_name: "cv", doc_type: "cv_de", action: "approved" })
      .select("id, created_at").single();
    expect(error).toBeNull();
    await flush();
    const rows = journal();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: "POST", status: 201, body_parts: 0, note: null });
    expect(String(rows[0].path)).toMatch(/^\/rest\/v1\/notifications\?/);
    const body = JSON.parse(String(rows[0].body));
    expect(body.id).toBe(data!.id);
    expect(Date.parse(body.created_at)).toBe(Date.parse(data!.created_at));
  });

  it("records nothing for reads, refused writes, or the rate-limit counter", async () => {
    const db = client();
    expect((await db.from("notifications").select("id")).error).toBeNull();
    const refused = await db.from("notifications").insert({ user_id: U1 });     // doc_name NOT NULL
    expect(refused.error).not.toBeNull();
    expect((await db.from("notifications").update({ nope: 1 }).eq("id", U1)).error).not.toBeNull();
    expect((await db.rpc("rl_hit", { p_key: "k", p_window_ms: 60_000 })).error).toBeNull();
    await flush();
    expect(d1.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).all(JOURNAL_TABLE)).toEqual([]);
  });

  it("records updates, deletes and a writing RPC, in the order D1 answered them", async () => {
    const db = client();
    d1.prepare(`INSERT INTO upload_links (id, token_hash, candidate_user_id, doc_keys, uploaded_keys, expires_at, created_at) VALUES (?, 'h', ?, '["cv"]', '[]', '2030-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')`).run(FIXED_UUID, U1);
    const { data } = await db.from("notifications").insert({ user_id: U1, doc_name: "cv", doc_type: "t", action: "x" }).select("id").single();
    await db.from("notifications").update({ read: true }).eq("id", data!.id);
    await db.from("notifications").delete().eq("id", data!.id);
    expect((await db.rpc("claim_upload_key", { p_link_id: FIXED_UUID, p_key: "cv" })).data).toEqual(["cv"]);
    await flush();
    expect(journal().map((r) => `${r.method} ${String(r.path).split("?")[0]}`)).toEqual([
      "POST /rest/v1/notifications",
      "PATCH /rest/v1/notifications",
      "DELETE /rest/v1/notifications",
      "POST /rest/v1/rpc/claim_upload_key",
    ]);
  });

  it("stores the generated values of an upsert on a non-key target, for the replay", async () => {
    const { error } = await client().from("employers").upsert({ slug: "uksh", name: "UKSH", address_lines: [] }, { onConflict: "slug" });
    expect(error).toBeNull();
    await flush();
    const [entry] = journal();
    const stored = d1.prepare(`SELECT id, created_at, updated_at FROM employers WHERE slug = 'uksh'`).all()[0];
    expect(JSON.parse(String(entry.fill))).toEqual([{ id: stored.id, created_at: stored.created_at, updated_at: stored.updated_at }]);
  });

  it("answers the write even when the journal cannot be written — and says so, without values", async () => {
    const broken: D1Runner = { run: async () => { throw new Error("D1 overloaded"); } };
    const { data, error } = await client({ runner: async () => broken }).from("notifications")
      .insert({ user_id: U1, doc_name: "passport", doc_type: "t", action: "x" }).select("id").single();
    expect(error).toBeNull();
    expect(data!.id).toMatch(/^[0-9a-f-]{36}$/);
    await flush();
    expect(logs.some((l) => l.startsWith("[write-journal] LOST POST notifications"))).toBe(true);
    expect(logs.join("\n")).not.toContain(U1);
    expect(logs.join("\n")).not.toContain("passport");
  });

  it("answers the write even when the scheduler or the preparation throws", async () => {
    const throwingSchedule = client({ schedule: () => { throw new Error("no waitUntil"); } });
    const a = await throwingSchedule.from("notifications").insert({ user_id: U1, doc_name: "a", doc_type: "t", action: "x" });
    expect(a.error).toBeNull();

    const exploding = new Proxy({}, { get: () => { throw new Error("registry unreadable"); } }) as Registry;
    const f = withWriteJournal(makeBvFetch({ runner }), { registry: exploding, schedule: (w) => { pending.push(w()); }, log: (_l, line) => logs.push(line) });
    const b = await createClient(SB, "k", { global: { fetch: f }, auth: { persistSession: false } })
      .from("notifications").insert({ user_id: U1, doc_name: "b", doc_type: "t", action: "x" });
    expect(b.error).toBeNull();
    expect(logs.some((l) => l.includes("LOST") && l.includes("could not prepare"))).toBe(true);
    expect(logs.some((l) => l.includes("LOST") && l.includes("no waitUntil"))).toBe(true);
    expect(d1.prepare(`SELECT count(*) AS n FROM notifications`).all()[0].n).toBe(2);
  });

  it("journals a Request object passed without init", async () => {
    const f = withWriteJournal(makeBvFetch({ runner }), { runner: async () => runner, schedule: (w) => { pending.push(w()); } });
    d1.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('telegram_silenced', 'off', '2026-01-01T00:00:00+00:00')`).run();
    const res = await f(new Request(`${SB}/rest/v1/app_settings?key=eq.telegram_silenced`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "on" }),
    }));
    expect(res.ok).toBe(true);
    await flush();
    expect(journal().map((r) => [r.method, r.body])).toEqual([["PATCH", JSON.stringify({ value: "on" })]]);
  });

  it("splits a body too big for one D1 row into parts, losslessly", async () => {
    for (const ddl of JOURNAL_DDL) await runner.run(ddl);
    const body = "x".repeat(PART_CHARS * 2 + 17);
    const id = await appendEntry(runner, { at: FIXED_NOW, at_ms: 1, seq: 1, method: "POST", path: "/rest/v1/messages", prefer: null, body, status: 201, note: null }, null);
    const row = d1.prepare(`SELECT body, body_parts FROM "${JOURNAL_TABLE}" WHERE id = ?`).all(id)[0];
    expect(row).toEqual({ body: null, body_parts: 3 });
    const parts = d1.prepare(`SELECT data FROM "${JOURNAL_PART_TABLE}" WHERE journal_id = ? ORDER BY n`).all(id);
    expect(parts.map((p) => String(p.data)).join("")).toBe(body);
  });
});
