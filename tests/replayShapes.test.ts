import { describe, it, expect, beforeEach } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import registryJson from "@/d1/types.json";
import type { Registry } from "@/lib/d1/pgrest/types";
import type { D1Runner } from "@/lib/d1/client";
import { resetJournalForTests, defaultKind, identityColumn, PART_CHARS } from "@/lib/d1/writeJournal";
import { makeBvFetch } from "@/lib/d1/bvFetch";
import { buildServiceFetch } from "@/lib/d1/serviceFetch";
import { replayJournal, REPLAY_RECOMPUTED } from "../d1/replay-journal.mjs";
import { hasSqlite, openDb, sqliteRunner, type SqliteDb } from "./helpers/sqliteD1";

/**
 * Every mutation SHAPE the portal sends, replayed: the request the rollback
 * sends to Supabase must be the request supabase-js sent to D1 — same method,
 * path, filters, on_conflict, the Prefer tokens that shape the write, the same
 * rows — differing only by what the journal deliberately ADDS (ids and
 * timestamps the database would otherwise invent again, with exactly the
 * values D1 stored). Then the end state of a "Supabase" that received the
 * replay must equal D1's, table by table.
 *
 * "Supabase" here is a second SQLite behind the adapter: it proves the replay
 * carries everything D1 applied; the request comparison proves Supabase is
 * asked for the same thing PostgREST was designed to answer.
 */

const registry = registryJson as unknown as Registry;
const SB = "https://p.supabase.co";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const LINK = "44444444-4444-4444-8444-444444444444";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Sent = { method: string; url: URL; prefer: string[]; body: string | undefined };

function sentOf(input: RequestInfo | URL, init?: RequestInit): Sent {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const prefer = (new Headers(init?.headers).get("prefer") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return { method: (init?.method ?? "GET").toUpperCase(), url, prefer, body: init?.body as string | undefined };
}

const isWrite = (s: Sent) => s.method !== "GET" && s.method !== "HEAD" && /\/rest\/v1\//.test(s.url.pathname) && !/\/rpc\/rl_hit$/.test(s.url.pathname);
const shaping = (prefer: string[]) => prefer.filter((t) => !t.startsWith("return=") && !t.startsWith("count=")).sort();
const columnsOf = (u: URL) => (u.searchParams.get("columns") ?? "").split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
const tableOf = (u: URL) => u.pathname.match(/\/rest\/v1\/([A-Za-z0-9_]+)$/)?.[1] ?? null;

/** Columns whose value the database invents (gen_random_uuid(), now(), now() + interval, a self-numbered id). */
function generated(table: string): Set<string> {
  const cols = registry[table]?.columns ?? {};
  const id = registry[table] ? identityColumn(registry[table]) : null;
  return new Set([...Object.entries(cols).filter(([, c]) => ["uuid", "time"].includes(defaultKind(c).kind)).map(([n]) => n), ...(id ? [id] : [])]);
}

const describeD1 = describe.skipIf(!hasSqlite);

describeD1("every mutation shape replays as the request supabase-js sent", () => {
  let d1Db: SqliteDb, sbDb: SqliteDb, d1: D1Runner, sb: D1Runner;
  let originals: Sent[], replayed: Sent[], pending: Promise<void>[], logs: string[];
  let db: SupabaseClient;

  /** The same rows on both sides: the copy as it stood at the flip. */
  function seed(sql: string) { d1Db.exec(sql); sbDb.exec(sql); }

  beforeEach(() => {
    resetJournalForTests();
    d1Db = openDb({ schema: true }); sbDb = openDb({ schema: true });
    d1 = sqliteRunner(d1Db); sb = sqliteRunner(sbDb);
    originals = []; replayed = []; pending = []; logs = [];
    const noNetwork = (async () => { throw new Error("the network must not be called"); }) as unknown as typeof fetch;
    const service = buildServiceFetch({ backend: "d1", shadow: false, freeze: false }, {
      base: noNetwork, runner: d1,
      journal: { schedule: (w) => { pending.push(w()); }, log: (_l, line) => logs.push(line) },
    });
    const recording = ((input: RequestInfo | URL, init?: RequestInit) => {
      const s = sentOf(input, init);
      if (isWrite(s)) originals.push(s);
      return service(input as RequestInfo, init);
    }) as typeof fetch;
    db = createClient(SB, "service", { global: { fetch: recording }, auth: { persistSession: false } });
    seed(`
      INSERT INTO organizations (id, name, invite_code, created_at) VALUES ('${ORG}', 'Org', 'org-code', '2026-01-01T00:00:00+00:00');
      INSERT INTO candidate_profiles (user_id, first_name, lang, updated_at) VALUES ('${U1}', 'A', 'fr', '2026-08-19T10:13:15.241+00:00');
      INSERT INTO notifications (id, user_id, doc_name, doc_type, action, created_at) VALUES
        ('${ID(1)}', '${U1}', 'cv', 'cv_de', 'approved', '2026-09-01T00:00:00+00:00'),
        ('${ID(2)}', '${U1}', 'Lebenslauf (ü), v2', 'cv_de', 'rejected', '2026-09-02T00:00:00+00:00'),
        ('${ID(3)}', '${U2}', 'passport', 'passport', 'approved', '2026-09-03T00:00:00+00:00');
      INSERT INTO upload_links (id, token_hash, candidate_user_id, doc_keys, uploaded_keys, expires_at, created_at) VALUES
        ('${LINK}', 'h', '${U1}', '["cv","passport"]', '[]', '2030-01-01T00:00:00.000000+00:00', '2026-01-01T00:00:00.000000+00:00');
    `);
  });

  async function replay() {
    while (pending.length) await Promise.all(pending.splice(0));
    const inner = makeBvFetch({ runner: sb });
    const target = { url: SB, key: "service", fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      replayed.push(sentOf(input, init));
      return inner(input as RequestInfo, init);
    }) as typeof fetch };
    const out: string[] = [];
    const summary = await replayJournal({ d1, target, registry, dryRun: false, log: (l: string) => out.push(l) });
    expect(summary, out.join("\n")).toMatchObject({ ok: true, pending: 0 });
    expect(logs.filter((l) => l.includes("LOST"))).toEqual([]);
  }

  /** The replayed request asks Supabase for what the original asked D1. */
  function expectEquivalent() {
    expect(replayed.map((s) => `${s.method} ${s.url.pathname}`)).toEqual(originals.map((s) => `${s.method} ${s.url.pathname}`));
    originals.forEach((o, i) => {
      const r = replayed[i];
      const where = `#${i} ${o.method} ${o.url.pathname}${o.url.search}`;
      // Every filter, select, on_conflict… byte for byte; columns= may only grow.
      for (const key of new Set([...o.url.searchParams.keys(), ...r.url.searchParams.keys()])) {
        if (key === "columns") continue;
        expect(r.url.searchParams.getAll(key), `${where} ?${key}`).toEqual(o.url.searchParams.getAll(key));
      }
      const table = tableOf(o.url);
      const gen = table ? generated(table) : new Set<string>();
      const oc = columnsOf(o.url), rc = columnsOf(r.url);
      expect(rc.slice(0, oc.length), `${where} columns`).toEqual(oc);
      for (const extra of rc.slice(oc.length)) expect(gen.has(extra), `${where} added column ${extra}`).toBe(true);
      expect(shaping(r.prefer), `${where} Prefer`).toEqual(shaping(o.prefer));
      if (o.method !== "POST" || !table) {
        expect(r.body ?? null, `${where} body`).toEqual(o.body ?? null);
        return;
      }
      const ob = JSON.parse(o.body!), rb = JSON.parse(r.body!);
      expect(Array.isArray(rb), `${where} array`).toBe(Array.isArray(ob));
      const orows = Array.isArray(ob) ? ob : [ob], rrows = Array.isArray(rb) ? rb : [rb];
      expect(rrows.length, `${where} rows`).toBe(orows.length);
      orows.forEach((orow: Record<string, unknown>, n: number) => {
        const rrow = rrows[n] as Record<string, unknown>;
        for (const [k, v] of Object.entries(orow)) expect(rrow[k], `${where} row ${n} .${k}`).toEqual(v);
        for (const k of Object.keys(rrow).filter((k) => !(k in orow))) {
          expect(gen.has(k), `${where} row ${n} added .${k}`).toBe(true);
        }
      });
    });
  }

  /**
   * D1 and the replayed "Supabase" hold the same rows, everywhere — but for the
   * columns Supabase restamps itself on replay (REPLAY_RECOMPUTED), which the
   * rollback's parity gate leaves out the same way.
   */
  function expectSameDatabases() {
    for (const table of Object.keys(registry)) {
      if (table === "rate_limits") continue;
      const order = registry[table].pk.map((c) => `"${c}"`).join(", ");
      const skip = Object.keys(REPLAY_RECOMPUTED).filter((k) => k.startsWith(`${table}.`)).map((k) => k.slice(table.length + 1));
      const dump = (x: SqliteDb) => x.prepare(`SELECT * FROM "${table}" ORDER BY ${order}`).all()
        .map((r) => Object.fromEntries(Object.entries(r).filter(([c]) => !skip.includes(c))));
      expect(dump(sbDb), table).toEqual(dump(d1Db));
    }
  }

  async function check() {
    await replay();
    expectEquivalent();
    expectSameDatabases();
  }

  const ok = async <T extends { error: unknown }>(p: PromiseLike<T>): Promise<T> => {
    const r = await p;
    expect(r.error).toBeNull();
    return r;
  };

  it("plain inserts: one row, rows with different keys, missing=default, explicit ids, select().single()", async () => {
    const one = await ok(db.from("notifications").insert({ user_id: U1, doc_name: "b2", doc_type: "b2", action: "verified" }).select("id, created_at").single());
    await ok(db.from("notifications").insert([
      { user_id: U1, doc_name: "a", doc_type: "t", action: "approved" },
      { user_id: U2, doc_name: "b", doc_type: "t", action: "approved", feedback: "f", doc_id: ID(40) },  // listed but absent: NULL, as in PostgREST
    ]));
    await ok(db.from("notifications").insert([
      { user_id: U1, doc_name: "c", doc_type: "t", action: "approved" },
      { user_id: U1, doc_name: "d", doc_type: "t", action: "approved", read: true },
    ], { defaultToNull: false }));
    await ok(db.from("notifications").insert({ id: ID(9), user_id: U2, doc_name: "e", doc_type: "t", action: "approved", created_at: "2026-10-07T03:00:00.123456+00:00" }));
    await ok(db.from("leads").insert({ kind: "contact", email: "x@example.invalid", name: "n", details: { b: 1, a: [1, { z: true, y: null }] } }));
    await ok(db.from("upload_links").insert({ token_hash: "h2", candidate_user_id: U2, doc_keys: ["cv"], uploaded_keys: [], created_by: null }));
    expect(one.data!.id).toMatch(/^[0-9a-f-]{36}$/);
    await check();
  });

  it("upserts: on the key, on a non-key target (new and existing rows), ignoreDuplicates, composite keys", async () => {
    await ok(db.from("app_settings").upsert({ key: "telegram_silenced", value: "on" }));
    await ok(db.from("candidate_profiles").upsert({ user_id: U1, lang: "de" }, { onConflict: "user_id" }));          // existing: updated_at kept
    await ok(db.from("candidate_profiles").upsert({ user_id: U2, lang: "en" }, { onConflict: "user_id" }));          // new: updated_at generated
    await ok(db.from("candidate_status").upsert({ user_id: U1, b2_complete: null, vaccines: { hepB: true }, updated_at: new Date().toISOString() }, { onConflict: "user_id" }));
    await ok(db.from("employers").upsert({ slug: "uksh", name: "UKSH", address_lines: ["Kiel"] }, { onConflict: "slug" }));
    await ok(db.from("employers").upsert({ slug: "uksh", name: "UKSH Kiel", address_lines: [] }, { onConflict: "slug" }));
    const items = [
      { candidate_user_id: U1, text: "Passport", owner: "candidate", preset_key: "passport", position: 1 },
      { candidate_user_id: U1, text: "CV", owner: "candidate", preset_key: "cv", position: 2 },
    ];
    await ok(db.from("candidate_journey_items").upsert(items, { onConflict: "candidate_user_id,preset_key", ignoreDuplicates: true }));
    await ok(db.from("candidate_journey_items").upsert([...items, { candidate_user_id: U1, text: "B2", owner: "borivon", preset_key: "b2", position: 3 }],
      { onConflict: "candidate_user_id,preset_key", ignoreDuplicates: true }));
    await ok(db.from("organization_members").upsert({ org_id: ORG, sub_admin_email: "Admin2@example.invalid", role: "member" }, { onConflict: "org_id,sub_admin_email" }));
    await ok(db.from("organization_members").upsert({ org_id: ORG, sub_admin_email: "Admin2@example.invalid", role: "owner" }, { onConflict: "org_id,sub_admin_email" }));
    // lib/academyPoints.ts awardPoints: a session's attendance (keyed), then a manual
    // adjustment, whose NULL source_id can never conflict — always a new row.
    const conflict = { onConflict: "candidate_user_id,type,source_kind,source_id" };
    await ok(db.from("academy_point_events").upsert({ candidate_user_id: U1, type: "attendance", points: 10, source_kind: "session", source_id: ID(70) }, { ...conflict, ignoreDuplicates: false }));
    await ok(db.from("academy_point_events").upsert({ candidate_user_id: U1, type: "attendance", points: 4, source_kind: "session", source_id: ID(70) }, { ...conflict, ignoreDuplicates: false }));
    await ok(db.from("academy_point_events").upsert({ candidate_user_id: U1, type: "manual", points: -2, source_kind: "admin", source_id: null }, { ...conflict, ignoreDuplicates: true }).select("id"));
    await ok(db.from("academy_point_events").upsert([
      { candidate_user_id: U2, type: "manual", points: 1, source_kind: "admin", source_id: null },
      { candidate_user_id: U2, type: "manual", points: 2, source_kind: null, source_id: null },
    ], { ...conflict, ignoreDuplicates: true }));
    await check();
    expect(logs.filter((l) => l.includes("fill-"))).toEqual([]);
  });

  it("updates and deletes by complex filters: or/and, in, cs, ilike, not.is, neq, ranges, values with reserved characters", async () => {
    await ok(db.from("notifications").update({ read: true }).or(`doc_name.eq.cv,and(user_id.eq.${U2},action.eq.approved)`));
    await ok(db.from("notifications").update({ feedback: "a,b (c) \"d\" +e" }).in("doc_name", ["Lebenslauf (ü), v2", "passport"]));
    await ok(db.from("notifications").update({ feedback: "%" }).ilike("doc_name", "%LEBENSLAUF (Ü)%"));
    await ok(db.from("notifications").update({ read: false }, { count: "exact" }).not("feedback", "is", null).neq("action", "verified").select("id"));
    await ok(db.from("notifications").delete().gte("created_at", "2026-09-02T00:00:00Z").lt("created_at", "2026-09-03T00:00:00+00:00"));
    await ok(db.from("upload_links").update({ revoked_at: "2026-10-07T00:00:00Z" }).contains("doc_keys", ["passport"]).is("used_at", null));
    await ok(db.from("notifications").delete().eq("user_id", U2).select());
    await check();
  });

  it("the upload-link RPCs, whatever they answer", async () => {
    expect((await ok(db.rpc("claim_upload_key", { p_link_id: LINK, p_key: "passport" }))).data).toEqual(["passport"]);
    expect((await ok(db.rpc("claim_upload_key", { p_link_id: LINK, p_key: "cv" }))).data).toEqual(["cv", "passport"]);
    expect((await ok(db.rpc("claim_upload_key", { p_link_id: LINK, p_key: "cv" }))).data).toBeNull();     // already claimed: still journaled, a no-op again
    await ok(db.rpc("release_upload_key", { p_link_id: LINK, p_key: "passport" }));
    await ok(db.rpc("rl_hit", { p_key: "ip:1", p_window_ms: 60_000 }));                                      // ephemeral: never replayed
    await check();
  });

  it("self-numbered ids (bookings, assistant_commitments…) replay as the ids D1 gave, whatever Supabase's sequence says", async () => {
    // Supabase's sequence is ahead of D1's: a booking was created and deleted
    // there before the copy (the copy only knows rows, not sequences).
    sbDb.exec(`INSERT INTO bookings (id, kind, name, starts_at, ends_at) VALUES (7, 'nurse', 'x', '2026-01-01T00:00:00+00:00', '2026-01-01T01:00:00+00:00'); DELETE FROM bookings WHERE id = 7;`);
    const slot = (h: number) => ({ kind: "nurse", starts_at: `2026-10-10T${h}:00:00Z`, ends_at: `2026-10-10T${h}:30:00Z` });
    const { data: b } = await ok(db.from("bookings").insert({ ...slot(9), name: "A" }).select("id").single());
    await ok(db.from("bookings").update({ calendar_event_id: "ev1" }).eq("id", b!.id));          // app/api/book/route.ts
    await ok(db.from("bookings").insert([{ ...slot(10), name: "B" }, { ...slot(11), name: "C" }]));        // return=minimal: no ids in the answer
    await ok(db.from("bookings").update({ status: "cancelled" }).eq("id", b!.id + 2));
    await ok(db.from("assistant_commitments").upsert(
      [{ owner_user_id: U1, who_email: "w@example.invalid", what: "send CV", source_message_id: "m1" }],
      { onConflict: "owner_user_id,source_message_id,what", ignoreDuplicates: true }));
    await ok(db.from("assistant_commitments").update({ status: "done" }).eq("id", 1));
    await check();
    expect(String(replayed.find((s) => s.url.pathname.endsWith("/bookings") && s.method === "POST")!.body)).toContain(`"id":${b!.id}`);
  });

  it("a body too big for one journal row, reassembled from its parts", async () => {
    // A message with an inline image and emoji, three journal parts long. (An
    // emoji ON a part boundary is the write journal's own test: splitBody.)
    const text = `${"a".repeat(PART_CHARS)}\u{1F600} ü ${"b".repeat(PART_CHARS)}`;
    await ok(db.from("messages").insert({ thread_user_id: U1, sender_user_id: U1, sender_role: "candidate", body: text }));
    await check();
    expect(String(sbDb.prepare(`SELECT body FROM messages`).all()[0].body)).toBe(text);
  });
});
