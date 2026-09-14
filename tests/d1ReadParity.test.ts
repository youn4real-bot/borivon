import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { D1Runner } from "../lib/d1/client";

/**
 * Reads answer exactly like Supabase: the select list (arrow paths, a star among
 * other items), ORDER BY on text columns, and the window — limit, offset, Range,
 * count, HEAD, the 1000-row cap and `.single()`. Each request goes to live
 * PostgREST and through the adapter as raw HTTP, and status, Content-Range and
 * the parsed body must be identical.
 *
 * READ-ONLY on Supabase: GET and HEAD only. The one D1 write is the row cap's:
 * 1,100 rate_limits rows under this run's own key prefix, deleted in afterAll.
 * Rows of candidate tables are compared, never printed — a failure names the
 * request, not the data.
 *
 * Not compared: ORDER BY documents.status (two documents are approved live and
 * still pending in the copy), and the fuzzy "Perhaps you meant…" hint Postgres
 * adds to a 42703.
 *
 *   RUN_D1_PARITY=1 npx vitest run tests/d1ReadParity.test.ts
 */
const ENABLED = process.env.RUN_D1_PARITY === "1";

function loadEnv() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  process.env.D1_DATABASE_ID ??= "ffb9dcff-a501-4dc2-a94a-e5301e2595f0";
}

type Answer = { status: number; range: string | null; body: unknown };
type Case = [method: "GET" | "HEAD", path: string, headers?: Record<string, string>];
type Fetch = (method: string, path: string, headers?: Record<string, string>) => Promise<Answer>;

let live: Fetch;
let copy: Fetch;
let liveDb: SupabaseClient;
let copyDb: SupabaseClient;
let runner: D1Runner;
const PREFIX = `d1rp:${crypto.randomBytes(4).toString("hex")}:`;

async function answer(res: Response, method: string): Promise<Answer> {
  const text = method === "HEAD" ? "" : await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* not JSON: compare the text */ }
  return { status: res.status, range: res.headers.get("content-range"), body };
}

/** Every case on both sides, four at a time; the labels of those that differ. */
async function mismatches(cases: Case[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < cases.length; i += 4) {
    await Promise.all(cases.slice(i, i + 4).map(async ([method, path, headers = {}]) => {
      const [a, b] = await Promise.all([live(method, path, headers), copy(method, path, headers)]);
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${method} ${path} ${JSON.stringify(headers)} → live ${a.status} ${a.range}, copy ${b.status} ${b.range}`);
    }));
  }
  return out;
}

describe.skipIf(!ENABLED)("reads answer exactly like Supabase", () => {
  beforeAll(async () => {
    loadEnv();
    const { getD1 } = await import("../lib/d1/client");
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const d1 = await getD1();
    if (!d1) throw new Error("no D1 runner — refusing to run");
    runner = d1;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const base = { apikey: key, Authorization: `Bearer ${key}` };
    live = async (method, path, headers = {}) => {
      if (method !== "GET" && method !== "HEAD") throw new Error("Supabase is read-only here");
      return answer(await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...base, ...headers } }), method);
    };
    const bv = makeBvFetch({ runner, passthrough: (async () => { throw new Error("blocked: this test must never reach Supabase"); }) as unknown as typeof fetch });
    copy = async (method, path, headers = {}) => answer(await bv(`${url}/rest/v1/${path}`, { method, headers: { ...base, ...headers } }), method);
    liveDb = createClient(url, key);
    copyDb = createClient(url, key, { global: { fetch: bv } });
  });

  afterAll(async () => {
    if (!runner) return;
    await runner.run(`DELETE FROM rate_limits WHERE substr(bucket_key, 1, length(?1)) = ?1`, [PREFIX]);
    const left = await runner.run(`SELECT COUNT(*) AS n FROM rate_limits WHERE substr(bucket_key, 1, length(?1)) = ?1`, [PREFIX]);
    expect(Number(left.results[0].n)).toBe(0);
  });

  it("arrow selects: `->` apart from `->>`, index-ending names, non-JSON columns, errors", async () => {
    const cp = (sel: string) => `candidate_profiles?select=${sel}&order=user_id.asc`;
    const cases: Case[] = [
      // the three real call sites' shape, byte for byte
      cp("user_id,b2_stage,b2_failed,b2_exam_date,cv_langs:cv_draft->langs"),
      ...["user_id,cv_draft->langs", "user_id,cv_draft->>langs", "user_id,cv_draft->postalCode", "user_id,cv_draft->>postalCode",
        "user_id,cv_draft->langs->0", "user_id,cv_draft->langs->>0", "user_id,cv_draft->0", "user_id,cv_draft->langs->0->name",
        "user_id,cv_draft->langs->-1", "user_id,cv_draft->langs->-1->>level", "user_id,x:cv_draft->langs->0", "user_id,cv_draft->langs->-99",
        "user_id,cv_draft->langs->99", "user_id,cv_draft->langs->name", "user_id,cv_draft->city->0", "user_id,cv_draft->city->-1",
        "user_id,cv_draft->city->>0", "user_id,cv_draft->city->1", "user_id,cv_draft->missing", "user_id,cv_draft->>missing",
        "user_id,first_name->a", "user_id,x:first_name->a", "user_id,first_name->>0", "user_id,first_name->0", "user_id,first_name->-1",
        "user_id,first_name->1", 'user_id,cv_draft->"postalCode"', 'user_id,cv_draft->>"langs"', "user_id,passport_confirmed_fields->0",
        "user_id,passport_confirmed_fields->>0", "user_id,dob->0", "user_id,dob->>0", "user_id,cv_draft->>eduEntries",
        "user_id,cv_draft->workEntries->0->>from"].map(cp),
      "app_settings?select=key,value->x&key=eq.bot_quiet", "app_settings?select=key,value->>x&key=eq.bot_quiet",
      "app_settings?select=key,value->0,v:value->>0,w:value->-1&key=eq.bot_quiet",
      "documents?select=id,x:user_id->a&order=id.asc&limit=3", "documents?select=id,x:user_id->>0&order=id.asc&limit=3",
      "documents?select=id,uploaded_by_admin->0&order=id.asc&limit=3", "documents?select=id,b:uploaded_by_admin->>0,c:uploaded_by_admin->1&order=id.asc&limit=3",
      "documents?select=id,uploaded_at->>a&order=id.asc&limit=3", "documents?select=id,uploaded_at->>0,t:uploaded_at->0&order=id.asc&limit=3",
      "organizations?select=id,required_doc_keys->0,required_doc_keys->>1&order=id.asc", "organizations?select=id,last:required_doc_keys->-1&order=id.asc",
      "upload_links?select=id,doc_keys->>0,uploaded_keys->>0&order=id.asc&limit=20", "upload_links?select=id,a:doc_keys->0,b:doc_keys->-1,c:doc_keys->x,d:doc_keys->>-2&order=id.asc",
      "phase_slots?select=id,z:candidate_signature_zone->>0,form_fields->>0&order=id.asc",
      "organizations?select=id,v:vaccine_req->>masern,w:vaccine_req&order=id.asc", "organizations?select=id,v:vaccine_req->masern,x:vaccine_req->masern->0,y:vaccine_req->>masern&order=id.asc",
      "phase_slots?select=id,candidate_signature_zone->>page->x&order=id.asc", "phase_slots?select=id,candidate_signature_zone->>page->0&order=id.asc",
      "phase_slots?select=id,candidate_signature_zone->>page->>x&order=id.asc", "phase_slots?select=id,position->0,p:position->>0,q:position->-1&order=id.asc&limit=3",
      "employers?select=id,address_lines->>0,address_lines->1,a:address_lines->>-1&order=id.asc",
      "classroom_events?select=id,value->seconds,value->>seconds,t:value->test,u:value->>test,v:value->seconds->0,w:value->test->-1,x:value->test->1&order=id.asc&limit=30",
      "classroom_events?select=id,y:value->>seconds->x&order=id.asc&limit=3", "classroom_events?select=id,x:value->-x&limit=1",
      'booking_availability?select=week->1,a:week->"1",b:week->01,c:week->-0,d:week->>2,e:blackout_dates->0,f:blackout_dates->>0',
      "booking_availability?select=w:week->%221%22->0,x:week->%221%22->>-1,y:week->>%221%22",
      "phase_doc_order?select=a:order_keys->0,b:order_keys->>0,c:order_keys->-1,d:order_keys->-100,e:order_keys->>-1",
      "calendar_events?select=id,a:attendee_ids->0,b:attendee_ids->>0,c:attendee_ids->-1&order=id.asc",
      ...["a:order_keys->2147483647", "a:order_keys->2147483648", "a:order_keys->>2147483648", "a:order_keys->-2147483649",
        "a:order_keys->>0->1", "a:order_keys->>0->>1", "a:order_keys->>0->2147483648", "a:order_keys->", "a:order_keys->>",
        "a:order_keys->-", "order_keys->-", 'a:order_keys->""', 'a:order_keys->"a"b', 'a:order_keys->"0"',
        "order_keys->0,order_keys", "order_keys,order_keys->0", "*,*"].map((s) => `phase_doc_order?select=${s}`),
      ...["key,*", "*,key", "*,v:value->0", "v:value->0,*", "key,value->0->0->-1", "key,k:key->01,j:key->+0,l:key->-01",
        "key,key->a$b,key->_x,key->1a2,key->%C3%BC", "key,x:value->a%20->b", "key,value->%22a.b%22", "key,v:value->-0"]
        .map((s) => `app_settings?select=${s}&key=eq.bot_quiet`),
      ...["key,value->,key", "key,value->a,", "key,value->%3E", "key,value->(x", "key,value->a%2Cb", "id,"].map((s) => `app_settings?select=${s}`),
      "nosuchtable?select=a->", "documents?select=id,org:organizations(name)&limit=-1", "documents?select=id,nope->a&limit=1",
    ].map((c): Case => (typeof c === "string" ? ["GET", c] : c));
    expect(await mismatches(cases)).toEqual([]);
  }, 900_000);

  it("text ORDER BY: Postgres' collation, every direction and NULL placement, windows", async () => {
    const cases: Case[] = [];
    for (const [t, c, pk] of [
      ["documents", "file_type", "id"], ["documents", "file_name", "id"], ["candidate_profiles", "issuing_authority", "user_id"],
      ["candidate_profiles", "city_of_residence", "user_id"], ["candidate_profiles", "first_name", "user_id"],
      ["admin_checklist_items", "created_by", "id"], ["admin_checklist_items", "text", "id"], ["employers", "name", "id"],
      ["organizations", "name", "id"], ["phase_slots", "phase", "id"], ["phase_slots", "label", "id"],
    ]) {
      for (const o of [`${c}.asc,${pk}.asc`, `${c}.desc,${pk}.asc`, `${c}.asc.nullsfirst,${pk}.desc`, `${c}.desc.nullslast,${pk}.asc`]) {
        cases.push(["GET", `${t}?select=${pk}&order=${o}`]);
      }
      cases.push(["GET", `${t}?select=${pk}&order=${c}.asc,${pk}.asc&offset=3&limit=7`]);
      cases.push(["GET", `${t}?select=${pk}&order=${c}.desc,${pk}.desc&limit=5`, { Prefer: "count=exact" }]);
    }
    cases.push(
      ["GET", "documents?select=id,file_type&order=uploaded_by_admin.desc,file_type.asc,uploaded_at.desc,id.asc&limit=50"],
      ["GET", "documents?select=file_type&order=file_type.asc"],
      ["GET", "employers?select=id,name&order=name.asc"],
      ["GET", "documents?select=id&order=file_type.asc,id.asc&limit=1", { Accept: "application/vnd.pgrst.object+json" }],
      ["GET", "documents?select=id&order=file_type.asc,id.asc&offset=5000", { Prefer: "count=exact" }],
      ["HEAD", "documents?select=id&order=file_type.asc&limit=5", { Prefer: "count=exact" }],
    );
    expect(await mismatches(cases)).toEqual([]);
  }, 900_000);

  it("the window: limit, offset, Range, count, HEAD and .single()", async () => {
    const C = { Prefer: "count=exact" };
    const d = "documents?select=id&order=id.asc";
    const cases: Case[] = [
      ["GET", `${d}&limit=5`, C], ["GET", `${d}&offset=10&limit=5`, C], ["GET", `${d}&offset=761&limit=10`, C], ["GET", `${d}&offset=762&limit=10`, C],
      ["GET", `${d}&offset=5000&limit=20`, C], ["GET", `${d}&offset=10`, C], ["GET", `${d}&limit=0`, C], ["GET", d, C], ["GET", `${d}&limit=2000`, C],
      ["GET", `${d}&limit=0`], ["GET", `${d}&offset=5000`], ["GET", `${d}&limit=0&offset=5000`, C],
      ["HEAD", "documents?select=id", C], ["HEAD", "documents?select=id"], ["HEAD", "documents?select=id&limit=5", C], ["HEAD", "documents?select=id&offset=5000&limit=5", C],
      ["HEAD", "documents?select=id&offset=10", C], ["HEAD", "documents?select=id&limit=0", C], ["HEAD", "documents?select=id&limit=5"], ["HEAD", "documents?select=id&offset=5000"],
      ["HEAD", "documents?select=id&limit=abc", C], ["HEAD", "documents?select=id&limit=-1", C], ["HEAD", "documents?select=id", { Range: "0-4", ...C }],
      ["GET", "documents?select=id&id=eq.00000000-0000-0000-0000-000000000000", C],
      ["GET", "documents?select=id&id=eq.00000000-0000-0000-0000-000000000000&offset=1", C],
      ["GET", "documents?select=id&id=eq.00000000-0000-0000-0000-000000000000&offset=1"],
      ["HEAD", "nosuchtable?select=id"], ["HEAD", "documents?select=id&id=eq.bad", C],
      ["GET", "nosuchtable?limit=-1"], ["GET", "documents?select=nope&limit=-1"], ["GET", "documents?order=nope.asc&limit=-1"],
      ["GET", "documents?id=eq.bad&limit=-1"], ["GET", "documents?or=(&limit=-1"], ["GET", "nosuchtable?select=id", { Range: "5-2" }],
      ["GET", "documents?select=id&offset=99999999999999999999&id=eq.bad"], ["GET", `${d}&limit&offset=5`],
    ];
    for (const v of ["abc", "", "3.5", "1e2", "3abc", "%203", "3%20", "%2B3", "0x3", "0X3", "0o3", "0O3", "0b11", "(3)", "(%203%20)", "((3))", "03", "-0", "-3", "(-3)", "-%203", "-(3)", "(-0)",
      "99999999999999999999", "9223372036854775807", "9223372036854775808", "%20-3", "3e0", "%EF%BC%93", "3%09", "%0A3", "NaN", "Infinity", "0x", "1_0", "--3", "3-",
      "%C2%A03", "%EF%BB%BF3", "+3", "(%20-%20(3))", "-0x3", "0xA"]) {
      cases.push(["GET", `${d}&limit=${v}`]);
    }
    for (const v of ["abc", "", "-5", "(5)", "0x5", "%205", "-0", "99999999999999999999", "9223372036854775807", "9223372036854775808", "3.5", "(-5)", "760", "761", "762", "0x8000000000000000"]) {
      cases.push(["GET", `${d}&offset=${v}`], ["GET", `${d}&offset=${v}`, C]);
    }
    for (const q of ["limit=abc&offset=5", "limit=3&offset=abc", "offset=-2&limit=3", "offset=-5&limit=10", "offset=-2&limit=0", "limit=0&offset=5", "limit=-0&offset=5",
      "limit=NaN&offset=NaN", "limit=abc&offset=abc", "offset=-5&limit=3", "limit=-3&offset=10", "limit=1&limit=2", "offset=1&offset=2&limit=2", "limit=abc&limit=2", "limit=2&limit=abc",
      "offset=755&limit=99999999999999999999", "offset=9223372036854775807&limit=1", "offset=9223372036854775806&limit=2", "limit=9223372036854775807&offset=1",
      "limit=2&limit", "limit=2&limit=", "offset=759&offset", "limit=&offset=5", "offset=-0x5&limit=10"]) {
      cases.push(["GET", `${d}&${q}`], ["GET", `${d}&${q}`, C]);
    }
    for (const r of ["0-4", "10-", "5-2", "abc", "-5", "0-4,6-8", "items=0-4", "00-04", "0-99999999999999999999", "3-3", "760-770", "761-770", "762-770", "5000-5010", "0-"]) {
      cases.push(["GET", d, { Range: r }], ["GET", d, { Range: r, ...C }]);
    }
    for (const [q, r] of [["limit=2", "0-4"], ["limit=2", "3-10"], ["offset=10", "0-4"], ["offset=2&limit=2", "0-4"], ["limit=10", "3-5"], ["limit=abc", "0-4"], ["limit=0", "0-4"], ["offset=-1", "0-4"]]) {
      cases.push(["GET", `${d}&${q}`, { Range: r, ...C }]);
    }
    cases.push(
      ["HEAD", "documents?select=id", { Range: "0-4" }], ["HEAD", "documents?select=id", { Range: "5-2" }],
      ["GET", "app_settings?select=key&key=eq.zzz-no-such-key", { Accept: "application/vnd.pgrst.object+json" }],
      ["GET", "app_settings?select=key&order=key&limit=2", { Accept: "application/vnd.pgrst.object+json" }],
      ["GET", "app_settings?select=key&key=eq.bot_quiet", { Accept: "application/vnd.pgrst.object+json", ...C }],
      ["GET", "app_settings?select=key&order=key&offset=5000", { Accept: "application/vnd.pgrst.object+json", ...C }],
      ["GET", "app_settings?select=key&order=key&limit=0", { Accept: "application/vnd.pgrst.object+json", ...C }],
      ["GET", "app_settings?select=key&order=key&limit=-1", { Accept: "application/vnd.pgrst.object+json" }],
      ["HEAD", "app_settings?select=key&key=eq.zzz-no-such-key", { Accept: "application/vnd.pgrst.object+json" }],
      ["HEAD", "app_settings?select=key&key=eq.bot_quiet", { Accept: "application/vnd.pgrst.object+json", ...C }],
      ["GET", "documents?select=id&order=id&offset=900&limit=5", { Accept: "application/vnd.pgrst.object+json", ...C }],
      ["GET", "documents?select=id&order=id&limit=1", { Accept: "application/vnd.pgrst.object+json", ...C }],
    );
    expect(await mismatches(cases)).toEqual([]);
  }, 900_000);

  it("through supabase-js: a page with its total, an offset past it, .single()'s message", async () => {
    const shape = (r: { data: unknown; error: unknown; count: number | null; status: number; statusText: string }) =>
      JSON.stringify({ data: r.data, error: r.error, count: r.count, status: r.status, statusText: r.statusText });
    const both = async (q: (db: SupabaseClient) => PromiseLike<{ data: unknown; error: unknown; count: number | null; status: number; statusText: string }>) =>
      [shape(await q(liveDb)), shape(await q(copyDb))];
    for (const q of [
      (db: SupabaseClient) => db.from("documents").select("id", { count: "exact" }).order("id").range(0, 4),
      (db: SupabaseClient) => db.from("documents").select("id", { count: "exact" }).order("id").limit(5),
      (db: SupabaseClient) => db.from("documents").select("id", { count: "exact" }).order("id").range(5000, 5019),
      (db: SupabaseClient) => db.from("documents").select("id", { count: "exact", head: true }).limit(5),
      (db: SupabaseClient) => db.from("app_settings").select("key").eq("key", "does-not-exist").single(),
      (db: SupabaseClient) => db.from("app_settings").select("key").order("key").limit(2).single(),
      (db: SupabaseClient) => db.from("does_not_exist").select("id", { count: "exact", head: true }),
    ]) {
      const [a, b] = await both(q);
      expect(b).toBe(a);
    }
  }, 300_000);

  it("the 1000-row cap: live on rate_limits, and the adapter on 1,100 rows of its own", async () => {
    await runner.run(`INSERT INTO rate_limits (bucket_key, window_start) SELECT ?1 || value, 0 FROM json_each(?2)`,
      [PREFIX, JSON.stringify(Array.from({ length: 1100 }, (_, i) => i))]);
    // rate_limits holds different rows on each side, so compare what the cap decides:
    // the status, the page's positions, and how many rows came back.
    const C = { Prefer: "count=exact" };
    const shape = (x: Answer) => ({ status: x.status, page: x.range?.split("/")[0], rows: Array.isArray(x.body) ? x.body.length : x.body });
    for (const [query, headers] of [
      ["select=bucket_key", {}], ["select=bucket_key", C], ["select=bucket_key&limit=1001", C], ["select=bucket_key&limit=5000", C],
      ["select=bucket_key&order=bucket_key.asc&limit=2000", C], ["select=bucket_key", { Range: "0-1999", ...C }],
      ["select=bucket_key&offset=100&limit=1500", {}],
    ] as [string, Record<string, string>][]) {
      const [a, b] = await Promise.all([live("GET", `rate_limits?${query}`, headers), copy("GET", `rate_limits?${query}`, headers)]);
      expect(shape(b), `${query} ${JSON.stringify(headers)}`).toEqual(shape(a));
    }
    const [ha, hb] = await Promise.all([live("HEAD", "rate_limits?select=bucket_key&offset=100", {}), copy("HEAD", "rate_limits?select=bucket_key&offset=100", {})]);
    expect(hb).toEqual(ha);   // 100-1099/*
  }, 300_000);
});
