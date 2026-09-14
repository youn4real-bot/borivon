import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Writes, against the D1 copy, held to what live Supabase answers.
 *
 * Supabase may not be written to, so its side is read the only honest way left:
 *  - a typed column's verdict on a value comes from a read-only FILTER on a
 *    column of the same type. Postgres runs the same input function for
 *    `?col=eq.<text>` as json_to_recordset() runs for a written value, so the
 *    error body (code, message, details, hint) must match field for field, and
 *    an accepted spelling must find the same live row as the canonical one;
 *  - a bulk write's rows must come back in the shape a live row of that table has
 *    (key order and JSON types), and every row must land;
 *  - wide or=(…) filters are sent to both sides and compared byte for byte.
 * What no read can show (21000, `columns=` / missing=default, the employers
 * trigger) follows the PostgREST 14.5 and Postgres sources cited in
 * lib/d1/pgrest/buildSql.ts, and tests/pgrestWrites.test.ts runs the same SQL in
 * a real SQLite.
 *
 * SAFETY: live Supabase only ever gets GET. The D1 client's passthrough throws,
 * so it cannot reach Supabase either. Every D1 row written carries the markers
 * below; the suite refuses to start if any row already matches the cleanup, and
 * removes all of them afterwards.
 *
 * Skipped unless RUN_D1_PARITY=1:
 *   RUN_D1_PARITY=1 npx vitest run tests/d1WriteCodecParity.test.ts
 */
const ENABLED = process.env.RUN_D1_PARITY === "1";
const MARK = "d1-write-codec-parity";
const USER = "00000000-0000-4000-8000-0000000c0dec";
const COHORT = "00000000-0000-4000-8000-0000000c0de1";
const PROBE_REMINDER = "00000000-0000-4000-8000-0000000c0de2";
const id = (tag: number, n: number) => `c0dec${tag}00-0000-4000-8000-${String(n).padStart(12, "0")}`;

const CLEANUP: [string, unknown[]][] = [
  [`DELETE FROM "calendar_events" WHERE "title" = ?`, [MARK]],
  [`DELETE FROM "notifications" WHERE "doc_name" = ? AND "doc_id" = ?`, [MARK, USER]],
  [`DELETE FROM "leads" WHERE "name" = ? AND "email" LIKE ?`, [MARK, `${MARK}-%`]],
  [`DELETE FROM "academy_cohort_members" WHERE "cohort_id" = ?`, [COHORT]],
  [`DELETE FROM "candidate_reminders" WHERE "user_id" = ?`, [USER]],
  [`DELETE FROM "assistant_reminders" WHERE "owner_user_id" = ?`, [USER]],
  [`DELETE FROM "candidate_pipeline" WHERE "user_id" = ?`, [USER]],
  [`DELETE FROM "employers" WHERE "name" LIKE ?`, [`${MARK}%`]],
  [`DELETE FROM "affiliate_earnings" WHERE "affiliate_id" = ?`, [USER]],
];
const countOf = (del: string) => del.replace(/^DELETE FROM/, "SELECT count(*) AS n FROM");

function loadEnv() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  process.env.D1_DATABASE_ID ??= "ffb9dcff-a501-4dc2-a94a-e5301e2595f0";
}

type Answer = { status: number; body: unknown };
type Runner = { run(sql: string, params?: unknown[]): Promise<{ results: Record<string, unknown>[] }> };
let db: SupabaseClient;
let runner: Runner;
let liveGet: (path: string) => Promise<Answer>;
let copyGet: (path: string) => Promise<Answer>;

/** PostgREST's four error fields, whichever object carries them. */
const errorFields = (e: unknown) => {
  const x = (e ?? {}) as Record<string, unknown>;
  return { code: x.code, details: x.details ?? null, hint: x.hint ?? null, message: x.message };
};
/** A row's key order and JSON types — its shape, not its values. */
const shape = (row: Record<string, unknown>) => Object.entries(row).map(([k, v]) => [k, v === null ? "null" : Array.isArray(v) ? "array" : typeof v]);

describe.skipIf(!ENABLED)("writes answer like Supabase, against the D1 copy", () => {
  beforeAll(async () => {
    loadEnv();
    const { getD1 } = await import("../lib/d1/client");
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const d1 = await getD1();
    if (!d1) throw new Error("no D1 runner — refusing to run (a passthrough would reach live Supabase)");
    runner = d1;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const bv = makeBvFetch({
      runner: d1,
      passthrough: (async () => { throw new Error("blocked: the copy must never reach Supabase"); }) as unknown as typeof fetch,
    });
    db = createClient(url, key, { global: { fetch: bv } });
    const read = async (res: Response): Promise<Answer> => {
      const text = await res.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep the text */ }
      return { status: res.status, body };
    };
    liveGet = async (p) => read(await fetch(`${url}/rest/v1/${p}`, { method: "GET", headers }));
    copyGet = async (p) => read(await bv(`${url}/rest/v1/${p}`, { method: "GET", headers }));
    for (const [sql, params] of CLEANUP) {
      const n = Number((await d1.run(countOf(sql), params)).results[0]?.n);
      if (n !== 0) throw new Error(`rows this suite did not write already match its cleanup: ${sql}`);
    }
  }, 120_000);

  afterAll(async () => {
    if (!runner) return;
    for (const [sql, params] of CLEANUP) await runner.run(sql, params);
    for (const [sql, params] of CLEANUP) {
      const n = Number((await runner.run(countOf(sql), params)).results[0]?.n);
      if (n !== 0) throw new Error(`cleanup left ${n} row(s): ${sql}`);
    }
  }, 120_000);

  it("lands every row of a call-site-sized bulk write, in order, in a live row's shape", async () => {
    // app/api/portal/calendar/route.ts: a 52-week recurring event, 10 columns a row.
    const base = { title: MARK, description: "", image_url: "", link_url: "", location: "", vip_only: false, attendee_ids: [USER.toUpperCase()], created_by: USER };
    const rows = Array.from({ length: 52 }, (_, i) => ({ ...base, starts_at: new Date(Date.UTC(2031, 0, 6, 9) + i * 7 * 864e5).toISOString(), ends_at: null }));
    const select = "id, title, description, starts_at, ends_at, location, link_url, attendee_ids";
    const made = await db.from("calendar_events").insert(rows).select(select);
    expect(made.error).toBeNull();
    const events = made.data as Record<string, unknown>[];
    expect(events.map((e) => e.starts_at)).toEqual(rows.map((r) => r.starts_at.replace(".000Z", "+00:00")));
    expect(events[0].attendee_ids).toEqual([USER]);                         // uuid_in prints lowercase
    const reread = await db.from("calendar_events").select(select).eq("title", MARK).order("starts_at");
    expect(reread.data).toEqual(events);
    const live = await liveGet(`calendar_events?select=${select.replace(/ /g, "")}&ends_at=is.null&limit=1`);
    const liveRow = (live.body as Record<string, unknown>[])[0];
    if (liveRow) expect(shape(events[0])).toEqual(shape({ ...liveRow, attendee_ids: liveRow.attendee_ids ?? [] }));

    // calendar/route.ts notifyAttendees: 150 tagged recipients, 7 columns a row.
    const notes = Array.from({ length: 150 }, (_, i) => ({ user_id: id(1, i), doc_id: USER, doc_name: MARK, doc_type: "event_invite", action: "event_invite", feedback: null, read: false }));
    const notified = await db.from("notifications").insert(notes);
    expect(notified.error).toBeNull();
    expect((await db.from("notifications").select("id", { count: "exact", head: true }).eq("doc_name", MARK)).count).toBe(150);

    // lib/assistantTools.ts createLeadsBatch: the 50 leads its schema allows.
    const leads = Array.from({ length: 50 }, (_, i) => ({ kind: "person", name: MARK, email: `${MARK}-${i}@example.invalid`, phone: "", message: "", details: i % 2 ? { cohort: "B2" } : {} }));
    const added = await db.from("leads").insert(leads).select("id, details");
    expect(added.error).toBeNull();
    expect((added.data as { details: unknown }[]).map((l) => l.details)).toEqual(leads.map((l) => l.details));

    // app/api/portal/academy/admin/route.ts add_members: a 200-candidate cohort, then a merge and a re-add.
    const members = (from: number, n: number, level: string) =>
      Array.from({ length: n }, (_, i) => ({ cohort_id: COHORT, candidate_user_id: id(2, from + i), current_level: level, status: "active" }));
    const target = { onConflict: "cohort_id,candidate_user_id" };
    expect((await db.from("academy_cohort_members").upsert(members(0, 200, "A1"), { ...target, ignoreDuplicates: false })).error).toBeNull();
    const merged = await db.from("academy_cohort_members").upsert(members(198, 3, "B1"), { ...target, ignoreDuplicates: false }).select("candidate_user_id, current_level");
    expect(merged.data).toEqual([198, 199, 200].map((n) => ({ candidate_user_id: id(2, n), current_level: "B1" })));
    const readded = await db.from("academy_cohort_members").upsert(members(200, 2, "C1"), { ...target, ignoreDuplicates: true }).select("candidate_user_id");
    expect(readded.data).toEqual([{ candidate_user_id: id(2, 201) }]);
    expect((await db.from("academy_cohort_members").select("cohort_id", { count: "exact", head: true }).eq("cohort_id", COHORT)).count).toBe(202);
  }, 300_000);

  it("refuses an upsert that reaches one row twice with Postgres' 21000, and writes nothing", async () => {
    const row = { cohort_id: COHORT, candidate_user_id: id(3, 1), current_level: "A1", status: "active" };
    const r = await db.from("academy_cohort_members")
      .upsert([row, { ...row, current_level: "B1" }], { onConflict: "cohort_id,candidate_user_id", ignoreDuplicates: false })
      .select("candidate_user_id");
    expect(r.status).toBe(500);
    expect(errorFields(r.error)).toEqual({
      code: "21000",
      details: null,
      hint: "Ensure that no rows proposed for insertion within the same command have duplicate constrained values.",
      message: "ON CONFLICT DO UPDATE command cannot affect row a second time",
    });
    expect((await db.from("academy_cohort_members").select("cohort_id").eq("candidate_user_id", id(3, 1))).data).toEqual([]);
  }, 120_000);

  it("writes rows whose keys differ: NULL for the missing key, or its default under missing=default", async () => {
    const rows = [{ user_id: USER, kind: MARK, items: [] }, { user_id: USER, items: [] }];
    const nulls = await db.from("candidate_reminders").insert(rows).select("kind");
    expect(nulls.error?.code).toBe("23502");                                // kind is NOT NULL, as in Postgres
    const defaults = await db.from("candidate_reminders").insert(rows, { defaultToNull: false }).select("kind, sent_at");
    expect(defaults.error).toBeNull();
    expect((defaults.data as { kind: string }[]).map((d) => d.kind)).toEqual([MARK, "documents"]);
  }, 120_000);

  it("reads every written value with the column's input function, exactly as Postgres does", async () => {
    const live = async (table: string, col: string, text: string) => liveGet(`${table}?select=${col}&${col}=eq.${encodeURIComponent(text)}&limit=1`);
    const doc = ((await liveGet("documents?select=id,uploaded_at&uploaded_at=not.is.null&order=id.asc&limit=1")).body as Record<string, string>[])[0];
    const due = ((await liveGet("assistant_reminders?select=due_date&due_date=not.is.null&order=id.asc&limit=1")).body as Record<string, string>[])[0].due_date;
    expect((await db.from("assistant_reminders").insert({ id: PROBE_REMINDER, owner_user_id: USER, text: MARK })).error).toBeNull();
    expect((await db.from("affiliate_earnings").insert({ affiliate_id: USER, candidate_user_id: USER })).error).toBeNull();

    const problems: string[] = [];
    // [column, value written, the live column of the same type that judges it]
    const cases: [string, unknown, [string, string]][] = [
      ["due_date", "29.05.2004", ["assistant_reminders", "due_date"]],
      ["due_date", "", ["assistant_reminders", "due_date"]],
      ["due_date", "1990", ["assistant_reminders", "due_date"]],
      ["due_date", "2026-02-30", ["assistant_reminders", "due_date"]],
      ["due_date", true, ["assistant_reminders", "due_date"]],
      ["due_at", "not a date", ["documents", "uploaded_at"]],
      ["due_at", 5, ["documents", "uploaded_at"]],
      ["candidate_user_id", "abc", ["documents", "user_id"]],
      ["candidate_user_id", 5, ["documents", "user_id"]],
      ["remind_count", 2.5, ["assistant_reminders", "remind_count"]],
      ["remind_count", 3000000000, ["assistant_reminders", "remind_count"]],
      ["remind_count", true, ["assistant_reminders", "remind_count"]],
      ["remind_count", "", ["assistant_reminders", "remind_count"]],
      ["done", "maybe", ["assistant_reminders", "done"]],
      ["done", 2, ["assistant_reminders", "done"]],
    ];
    for (const [col, value, [liveTable, liveCol]] of cases) {
      const verdict = await live(liveTable, liveCol, typeof value === "string" ? value : JSON.stringify(value));
      const copy = await db.from("assistant_reminders").update({ [col]: value }).eq("id", PROBE_REMINDER).select(col);
      const same = verdict.status === copy.status && JSON.stringify(errorFields(verdict.body)) === JSON.stringify(errorFields(copy.error));
      if (verdict.status < 400 || !same) problems.push(`${col} = ${JSON.stringify(value)}: live ${JSON.stringify(verdict)} / copy ${copy.status} ${JSON.stringify(copy.error ?? copy.data)}`);
    }
    // numeric, and an element of a uuid[] column
    for (const value of ["abc", true]) {
      const verdict = await live("affiliate_earnings", "amount_eur", String(value));
      const copy = await db.from("affiliate_earnings").update({ amount_eur: value }).eq("affiliate_id", USER).select("amount_eur");
      if (verdict.status !== copy.status || JSON.stringify(errorFields(verdict.body)) !== JSON.stringify(errorFields(copy.error))) {
        problems.push(`amount_eur = ${JSON.stringify(value)}: live ${JSON.stringify(verdict)} / copy ${JSON.stringify(copy.error)}`);
      }
    }
    {
      const verdict = await liveGet(`calendar_events?select=id&attendee_ids=cs.${encodeURIComponent("{not-a-uuid}")}&limit=1`);
      const copy = await db.from("calendar_events").insert({ title: MARK, starts_at: "2031-01-01T00:00:00Z", attendee_ids: ["not-a-uuid"] });
      if (verdict.status !== copy.status || JSON.stringify(errorFields(verdict.body)) !== JSON.stringify(errorFields(copy.error))) {
        problems.push(`attendee_ids element: live ${JSON.stringify(verdict)} / copy ${JSON.stringify(copy.error)}`);
      }
    }

    // Accepted spellings: live must find the same row by the variant as by the
    // stored value, and the copy must store exactly that stored value.
    const [y, m, d] = due.split("-");
    const at = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?\+00:00$/.exec(doc.uploaded_at)!;
    const shifted = new Date(`${at[1]}T${at[2]}:${at[3]}:${at[4]}Z`).getTime() + 2 * 3600e3;
    const plus2 = `${new Date(shifted).toISOString().slice(0, 19)}${at[5] ?? ""}+02:00`;
    const accepted: [string, unknown, string, [string, string]][] = [
      ["due_date", `${y}-${Number(m)}-${Number(d)}`, due, ["assistant_reminders", "due_date"]],
      ["due_date", `${m}/${d}/${y}`, due, ["assistant_reminders", "due_date"]],
      ["due_date", Number(`${y}${m}${d}`), due, ["assistant_reminders", "due_date"]],
      ["due_at", doc.uploaded_at.replace("T", " "), doc.uploaded_at, ["documents", "uploaded_at"]],
      ["due_at", doc.uploaded_at.replace("+00:00", "+00"), doc.uploaded_at, ["documents", "uploaded_at"]],
      ["due_at", plus2, doc.uploaded_at, ["documents", "uploaded_at"]],
      ["candidate_user_id", doc.id.toUpperCase(), doc.id, ["documents", "id"]],
      ["candidate_user_id", `{${doc.id}}`, doc.id, ["documents", "id"]],
    ];
    for (const [col, value, stored, [liveTable, liveCol]] of accepted) {
      const byVariant = await live(liveTable, liveCol, typeof value === "string" ? value : JSON.stringify(value));
      const byStored = await live(liveTable, liveCol, stored);
      const copy = await db.from("assistant_reminders").update({ [col]: value }).eq("id", PROBE_REMINDER).select(col).single();
      const liveSame = byVariant.status === 200 && JSON.stringify(byVariant.body) === JSON.stringify(byStored.body) && (byStored.body as unknown[]).length === 1;
      const copyValue = (copy.data as Record<string, unknown> | null)?.[col];
      if (!liveSame || copyValue !== stored) problems.push(`${col} = ${JSON.stringify(value)}: live ${JSON.stringify(byVariant)} vs ${JSON.stringify(byStored)} / copy ${JSON.stringify(copy.error ?? copyValue)}`);
    }
    expect(problems).toEqual([]);

    // Values whose canonical form no live row can show: the Postgres literal of a
    // JSON number or boolean in a text column (populate_scalar), stored as TEXT.
    for (const [value, text] of [[5, "5"], [true, "true"], [2.5, "2.5"]] as const) {
      const r = await db.from("assistant_reminders").update({ text: value }).eq("id", PROBE_REMINDER).select("text").single();
      expect(r.data).toEqual({ text });
      const disk = (await runner.run(`SELECT typeof("text") AS t, "text" AS v FROM "assistant_reminders" WHERE "id" = ?`, [PROBE_REMINDER])).results[0];
      expect(disk).toEqual({ t: "text", v: text });
    }
    const integer = await db.from("assistant_reminders").update({ remind_count: " 7 ", done: "yes" }).eq("id", PROBE_REMINDER).select("remind_count, done").single();
    expect(integer.data).toEqual({ remind_count: 7, done: true });
  }, 300_000);

  it("stores a bare date in a timestamptz column as that midnight, which filters then find", async () => {
    // lib/assistantWrites.ts writeMilestone() writes visa_date as YYYY-MM-DD.
    expect((await db.from("candidate_pipeline").insert({ user_id: USER })).error).toBeNull();
    const r = await db.from("candidate_pipeline").update({ visa_date: "2026-03-04" }).eq("user_id", USER).select("visa_date").single();
    expect(r.data).toEqual({ visa_date: "2026-03-04T00:00:00+00:00" });
    for (const [op, value] of [["eq", "2026-03-04T00:00:00+00:00"], ["eq", "2026-03-04"], ["gte", "2026-03-04T00:00:00Z"]] as const) {
      const found = await db.from("candidate_pipeline").select("user_id").eq("user_id", USER).filter("visa_date", op, value);
      expect(found.data, `${op}.${value}`).toEqual([{ user_id: USER }]);
    }
    expect((await liveGet("candidate_pipeline?select=user_id&visa_date=eq.2026-03-04&limit=1")).status).toBe(200);
  }, 120_000);

  it("hands back the updated_at an employers update stored, and counts one row", async () => {
    const made = await db.from("employers").insert({ name: MARK, address_lines: [] }).select("id, updated_at").single();
    expect(made.error).toBeNull();
    const { id: employer, updated_at: before } = made.data as { id: string; updated_at: string };
    await new Promise((r) => setTimeout(r, 1100));
    // app/api/portal/admin/employers/route.ts:216, the admin PATCH.
    const updated = await db.from("employers").update({ name: `${MARK} renamed` }).eq("id", employer).select().single();
    const stored = await db.from("employers").select("updated_at").eq("id", employer).single();
    expect((updated.data as { updated_at: string }).updated_at).toBe((stored.data as { updated_at: string }).updated_at);
    expect((updated.data as { updated_at: string }).updated_at).not.toBe(before);
    const counted = await db.from("employers").update({ notes: MARK }, { count: "exact" }).eq("id", employer);
    expect(counted.count).toBe(1);
  }, 120_000);

  it("answers an or=(…) of 100 and more conditions exactly like Supabase", async () => {
    const label = ((await liveGet("documents?select=file_type&file_type=not.is.null&order=id.asc&limit=1")).body as { file_type: string }[])[0].file_type;
    for (const n of [99, 100, 150, 500]) {
      const terms = Array.from({ length: n - 1 }, (_, i) => `file_type.eq.zz-${i}`);
      const p = `documents?select=id&or=(${[...terms, `file_type.eq."${label}"`].map(encodeURIComponent).join(",")})&order=id.asc&limit=3`;
      const [a, b] = [await liveGet(p), await copyGet(p)];
      expect(a.status, `n=${n}`).toBe(200);
      expect(JSON.stringify(b), `n=${n}`).toBe(JSON.stringify(a));
    }
  }, 300_000);
});
