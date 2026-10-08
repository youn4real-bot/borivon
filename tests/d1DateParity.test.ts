import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";

/**
 * Dates, times and timestamps: every operand spelling the portal (or a caller of
 * it) can put on the wire, held to what live Supabase answers.
 *
 * D1 keeps a timestamptz / date as TEXT and compares it byte for byte, so each
 * spelling must land on the same rows Postgres' input function lands it on —
 * `Z` and `+00:00`, three and six fraction digits, a real offset, no zone, a bare
 * date, a space for the `T`. Supabase is the stale copy since the flip, so only
 * rows whose value is still byte-identical on both sides are compared.
 *
 * READ-ONLY on both sides: Supabase only ever gets GET; the D1 runner refuses any
 * statement that is not a SELECT, and the adapter's passthrough throws.
 *
 *   RUN_D1_PARITY=1 npx vitest run tests/d1DateParity.test.ts
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

type Answer = { status: number; body: unknown };
let liveGet: (path: string) => Promise<Answer>;
let copyGet: (path: string) => Promise<Answer>;

/** Rows of `table` whose `column` is byte-identical on both sides, by id. */
async function stableValues(table: string, column: string, pk = "id"): Promise<Map<string, string | null>> {
  const path = `${table}?select=${pk},${column}&order=${pk}.asc&limit=1000`;
  const [a, b] = await Promise.all([liveGet(path), copyGet(path)]);
  const live = new Map((a.body as Record<string, string | null>[]).map((r) => [String(r[pk]), r[column]]));
  const out = new Map<string, string | null>();
  for (const r of b.body as Record<string, string | null>[]) {
    const id = String(r[pk]);
    if (live.has(id) && live.get(id) === r[column]) out.set(id, r[column]);
  }
  return out;
}

/** One filter on both sides: the ids it finds among the stable rows, or the error code. */
async function both(table: string, pk: string, filter: string, stable: Map<string, unknown>) {
  const path = `${table}?select=${pk}&${filter}&order=${pk}.asc&limit=1000`;
  const [a, b] = await Promise.all([liveGet(path), copyGet(path)]);
  const view = (x: Answer) => x.status >= 400
    ? { status: x.status, code: (x.body as { code?: string })?.code ?? null }
    : { status: x.status, ids: (x.body as Record<string, unknown>[]).map((r) => String(r[pk])).filter((id) => stable.has(id)) };
  return { live: view(a), copy: view(b) };
}

async function pool<T>(items: T[], n: number, work: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await work(items[i++]); }));
}

const OPS = ["eq", "neq", "gt", "gte", "lt", "lte"];

/** Every spelling of the instant `stored` (a `…+00:00` value Postgres printed) worth asking about. */
function timestampSpellings(stored: string): Record<string, string> {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?\+00:00$/.exec(stored)!;
  const [, date, time, frac = ""] = m;
  const at = Date.parse(stored);
  const shifted = (minutes: number) => new Date(at + minutes * 60_000).toISOString().slice(0, 19);
  const f = frac ? `.${frac}` : "";
  return {
    stored,
    jsIso: new Date(at).toISOString(),
    zulu: `${date}T${time}${f}Z`,
    padded6: `${date}T${time}.${frac.padEnd(6, "0")}+00:00`,
    padded7Z: `${date}T${time}.${frac.padEnd(7, "0")}Z`,
    plus2: `${shifted(120)}${f}+02:00`,
    minus0530: `${shifted(-330)}${f}-05:30`,
    plus0200NoColon: `${shifted(120)}${f}+0200`,
    noZone: `${date}T${time}${f}`,
    space: `${date} ${time}${f}+00`,
    dateOnly: date,
    minute: `${date}T${time.slice(0, 5)}`,
  };
}

function dateSpellings(stored: string): Record<string, string> {
  const [y, mo, d] = stored.split("-");
  return {
    stored,
    midnightZ: `${stored}T00:00:00.000Z`,
    jsNoon: `${stored}T12:00:00.000Z`,
    lateWest: `${stored}T23:30:00-05:00`,
    earlyEast: `${stored}T00:30:00+02:00`,
    space: `${stored} 12:00`,
    us: `${Number(mo)}/${Number(d)}/${y}`,
    compact: `${y}${mo}${d}`,
  };
}

describe.skipIf(!ENABLED)("dates and timestamps answer like Supabase", () => {
  beforeAll(async () => {
    loadEnv();
    const { getD1 } = await import("../lib/d1/client");
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const d1 = await getD1();
    if (!d1) throw new Error("no D1 runner — refusing to run");
    const readOnly = {
      run(sql: string, params?: unknown[]) {
        if (!/^\s*(SELECT|WITH)\b/i.test(sql) || /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA)\b/i.test(sql.replace(/'[^']*'|"[^"]*"/g, ""))) {
          throw new Error(`blocked: this suite is read-only (${sql.slice(0, 40)})`);
        }
        return d1.run(sql, params);
      },
    };
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const bv = makeBvFetch({
      runner: readOnly,
      passthrough: (async () => { throw new Error("blocked: the copy must never reach Supabase"); }) as unknown as typeof fetch,
    });
    const read = async (res: Response): Promise<Answer> => {
      const text = await res.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep the text */ }
      return { status: res.status, body };
    };
    liveGet = async (p) => read(await fetch(`${url}/rest/v1/${p}`, { method: "GET", headers }));
    copyGet = async (p) => read(await bv(`${url}/rest/v1/${p}`, { method: "GET", headers }));
  }, 60_000);

  it.each([
    ["documents", "uploaded_at"],
    ["candidate_profiles", "updated_at", "user_id"],
    ["invite_tokens", "used_at"],
    ["calendar_events", "starts_at"],
  ])("%s.%s: every operand spelling finds the rows Postgres finds", async (table, column, pk = "id") => {
    const stable = await stableValues(table, column, pk);
    const values = [...new Set([...stable.values()].filter((v): v is string => !!v))].sort();
    // One stored value of each fraction width, so every width meets every spelling.
    const byWidth = new Map<number, string>();
    for (const v of values) {
      const w = (/\.(\d+)\+/.exec(v)?.[1] ?? "").length;
      if (!byWidth.has(w)) byWidth.set(w, v);
    }
    const probes: [string, string, string][] = [];
    for (const v of byWidth.values()) {
      for (const [name, spelled] of Object.entries(timestampSpellings(v))) {
        for (const op of OPS) probes.push([`${v} ${name} ${op}`, op, spelled]);
      }
    }
    const diffs: string[] = [];
    await pool(probes, 6, async ([label, op, spelled]) => {
      const r = await both(table, pk, `${column}=${op}.${encodeURIComponent(spelled)}`, stable);
      if (JSON.stringify(r.live) !== JSON.stringify(r.copy)) {
        const brief = (x: typeof r.live) => ("ids" in x ? `${x.ids!.length} rows` : `${x.status} ${x.code}`);
        diffs.push(`${label} (${spelled}): live ${brief(r.live)} vs copy ${brief(r.copy)}`);
      }
    });
    expect(diffs.sort()).toEqual([]);
  }, 600_000);

  it.each([
    ["candidate_profiles", "passport_expiry", "user_id"],
    ["candidate_profiles", "dob", "user_id"],
    ["assistant_reminders", "due_date"],
  ])("%s.%s: every date operand spelling finds the rows Postgres finds", async (table, column, pk = "id") => {
    const stable = await stableValues(table, column, pk);
    const values = [...new Set([...stable.values()].filter((v): v is string => !!v))].sort();
    const picks = [values[0], values[Math.floor(values.length / 2)], values[values.length - 1]];
    const probes: [string, string, string][] = [];
    for (const v of picks) {
      for (const [name, spelled] of Object.entries(dateSpellings(v))) {
        for (const op of OPS) probes.push([`${v} ${name} ${op}`, op, spelled]);
      }
    }
    const diffs: string[] = [];
    await pool(probes, 6, async ([label, op, spelled]) => {
      const r = await both(table, pk, `${column}=${op}.${encodeURIComponent(spelled)}`, stable);
      if (JSON.stringify(r.live) !== JSON.stringify(r.copy)) {
        const brief = (x: typeof r.live) => ("ids" in x ? `${x.ids!.length} rows` : `${x.status} ${x.code}`);
        diffs.push(`${label} (${spelled}): live ${brief(r.live)} vs copy ${brief(r.copy)}`);
      }
    });
    expect(diffs.sort()).toEqual([]);
  }, 600_000);

  it.each([
    ["documents", "superseded_at"],
    ["invite_tokens", "used_at"],
    ["candidate_profiles", "passport_expiry", "user_id"],
    ["telegram_updates", "responded_at", "update_id"],
  ])("%s.%s: NULLs land where Postgres puts them in every order", async (table, column, pk = "id") => {
    const stable = await stableValues(table, column, pk);
    // A sample with NULLs and values, small enough for one `in` list.
    const ids = [...stable.keys()].sort();
    const nulls = ids.filter((id) => stable.get(id) === null).slice(0, 15);
    const set = ids.filter((id) => stable.get(id) !== null).slice(0, 45);
    const list = [...nulls, ...set];
    for (const order of ["asc", "desc", "asc.nullsfirst", "asc.nullslast", "desc.nullsfirst", "desc.nullslast"]) {
      const path = `${table}?select=${column}&${pk}=in.(${list.join(",")})&order=${column}.${order}`;
      const [a, b] = await Promise.all([liveGet(path), copyGet(path)]);
      expect(b.body, `${table}.${column} ${order}`).toEqual(a.body);
    }
  }, 120_000);
});
