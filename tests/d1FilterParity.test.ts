import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";

/**
 * Filters, byte for byte: the same PostgREST request sent to live Supabase and
 * to the D1 copy through the adapter, and the answers compared — the status, the
 * error body (code, message, details, hint) and the rows, in order.
 *
 * This is the replay of the probe matrix behind the filter pass: case folding
 * of `ilike` on German and French labels, patterns past D1's 50-byte limit,
 * uuid / boolean / integer / numeric / date / timestamptz operands in every
 * spelling Postgres reads or refuses, PostgREST's filter grammar (quoting, the
 * unbalanced paren of the admin search, negated groups, quantifiers, the `is`
 * keywords), array containment, and the operators the adapter answers with
 * Postgres' own error.
 *
 * Three kinds of case:
 *  - "same": both sides must answer identically;
 *  - "refused": grammar the adapter refuses by name on purpose (json-path
 *    filters, jsonb containment, full-text search, regular expressions) — the
 *    copy must say so with a PGRST100 carrying `d1-adapter:`, never answer wrongly;
 *  - "plan": a LIKE pattern ending in a lone backslash. Postgres raises 22025 or
 *    answers [] depending on the index it picks (see likeSegments() in buildSql.ts);
 *    the copy must answer [] and live must answer one of the two.
 *
 * READ-ONLY: the live client refuses anything but GET, and the copy's
 * passthrough throws, so neither side can be written to. Rows are compared as
 * ids only. Values that would be personal data (a candidate's first name) are
 * read from the live project at run time and never printed.
 *
 * Skipped unless RUN_D1_PARITY=1:
 *   RUN_D1_PARITY=1 npx vitest run tests/d1FilterParity.test.ts
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
type Kind = "same" | "refused" | "plan";
type Case = { label: string; table: string; params: [string, string][]; kind?: Kind };

const BS = "\\";
const PK: Record<string, string> = { candidate_profiles: "user_id" };

let liveGet: (path: string) => Promise<Answer>;
let copyGet: (path: string) => Promise<Answer>;
const sample = { docId: "", uploadedAt: "", dueDate: "", attendee: "", firstName: "" };

async function read(res: Response): Promise<Answer> {
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep the text */ }
  return { status: res.status, body };
}

/** `select=<pk>`, the case's own params, then a stable order for the rows. */
function path(c: Case): string {
  const pk = PK[c.table] ?? "id";
  const params: [string, string][] = [["select", pk], ...c.params, ["order", `${pk}.asc`], ["limit", "1000"]];
  return `${c.table}?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;
}

/**
 * The one field the adapter does not reproduce: a 42703's "Perhaps you meant to
 * reference the column …" hint, Postgres' fuzzy column suggestion. Nothing in
 * the codebase reads a hint; the code and message still have to match.
 */
function comparable(a: Answer): Answer {
  const body = a.body as { code?: string; hint?: unknown } | null;
  if (a.status >= 400 && body && body.code === "42703") return { status: a.status, body: { ...body, hint: "(not compared)" } };
  return a;
}

async function check(cases: Case[]): Promise<string[]> {
  const problems: string[] = [];
  for (const c of cases) {
    const p = path(c);
    const [live, copy] = [comparable(await liveGet(p)), comparable(await copyGet(p))];
    const kind = c.kind ?? "same";
    if (kind === "same") {
      if (JSON.stringify(live) !== JSON.stringify(copy)) {
        problems.push(`${c.label}\n    live: ${JSON.stringify(live).slice(0, 400)}\n    copy: ${JSON.stringify(copy).slice(0, 400)}`);
      }
    } else if (kind === "refused") {
      const body = copy.body as { code?: string; details?: string };
      if (copy.status !== 400 || body.code !== "PGRST100" || !String(body.details).startsWith("d1-adapter:")) {
        problems.push(`${c.label}: expected a loud refusal, copy answered ${JSON.stringify(copy).slice(0, 300)}`);
      }
    } else {
      const liveBody = live.body as { code?: string };
      const liveOk = (live.status === 200 && JSON.stringify(live.body) === "[]") || (live.status === 400 && liveBody.code === "22025");
      if (!liveOk || copy.status !== 200 || JSON.stringify(copy.body) !== "[]") {
        problems.push(`${c.label}: live ${JSON.stringify(live).slice(0, 200)} / copy ${JSON.stringify(copy).slice(0, 200)}`);
      }
    }
  }
  return problems;
}

const f = (label: string, table: string, key: string, value: string, kind?: Kind): Case => ({ label, table, params: [[key, value]], kind });

describe.skipIf(!ENABLED)("filters answer exactly like Supabase", () => {
  beforeAll(async () => {
    loadEnv();
    const { getD1 } = await import("../lib/d1/client");
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const runner = await getD1();
    if (!runner) throw new Error("no D1 runner — refusing to run (a passthrough would reach live Supabase)");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    liveGet = async (p) => read(await fetch(`${url}/rest/v1/${p}`, { method: "GET", headers }));
    const bv = makeBvFetch({
      runner,
      passthrough: (async () => { throw new Error("blocked: the copy must never reach Supabase"); }) as unknown as typeof fetch,
    });
    copyGet = async (p) => read(await bv(`${url}/rest/v1/${p}`, { method: "GET", headers }));

    const one = async (p: string) => ((await liveGet(p)).body as Record<string, string>[])[0];
    const doc = await one("documents?select=id,uploaded_at&order=id.asc&limit=1");
    sample.docId = doc.id;
    sample.uploadedAt = doc.uploaded_at;
    sample.dueDate = (await one("assistant_reminders?select=due_date&due_date=not.is.null&order=id.asc&limit=1")).due_date;
    sample.attendee = ((await one("calendar_events?select=attendee_ids&order=id.asc&limit=20")) as unknown as { attendee_ids: string[] }).attendee_ids[0] ?? "";
    sample.firstName = (await one("candidate_profiles?select=first_name&first_name=not.is.null&order=user_id.asc&limit=1")).first_name;
    for (const [k, v] of Object.entries(sample)) if (!v) throw new Error(`no live sample for ${k}`);
  }, 120_000);

  it("ilike folds every letter, in both directions", async () => {
    const d = "documents";
    expect(await check([
      f("umlaut in upper case", d, "file_type", "ilike.%NOTENÜBERSICHT%"),
      f("upper umlaut inside lower text", d, "file_type", "ilike.%notenÜbersicht%"),
      f("circumflex", d, "file_type", "ilike.%DIPLÔME%"),
      f("acute", d, "file_type", "ilike.%BACCALAURÉAT%"),
      f("acute, second word", d, "file_type", "ilike.%EXPÉRIENCE%"),
      f("accent where the data has none", d, "file_type", "ilike.%ÉXPERIENCE%"),
      f("negated", d, "file_type", "not.ilike.%NOTENÜBERSICHT%"),
      f("or() search form", d, "or", "(file_type.ilike.%DIPLÔME%,file_type.ilike.%BACCALAURÉAT%)"),
      f("ß is not SS", d, "file_type", "ilike.%STRASSE%"),
      f("ASCII only", d, "file_type", "ilike.%noten%"),
      f("underscore wildcard", d, "file_type", "ilike.%NOTEN_BERSICHT%"),
      f("escaped underscore", d, "file_type", "ilike.%NOTEN\\_BERSICHT%"),
      f("star wildcard", d, "file_type", "ilike.*noten*"),
      f("quantified", d, "file_type", "ilike(any).{%NOTEN%,%PASS%}"),
      f("ä in chat messages", "messages", "body", "ilike.%GESPRÄCH%"),
      f("ü in chat messages", "messages", "body", "ilike.%ÜBER%"),
      f("ü in a feed post", "feed_posts", "content", "ilike.%LÜBECK%"),
    ])).toEqual([]);
  }, 300_000);

  it("patterns past D1's 50-byte limit are answered, not refused", async () => {
    const d = "documents";
    const label = "Certificat d'exercice de la profession infirmière";
    const pad = "%".repeat(50);
    expect(await check([
      f("the notification resolver's label search", d, "file_type", `ilike.%${label}%`),
      f("same, upper case", d, "file_type", `ilike.%${label.toUpperCase()}%`),
      f("same, case-sensitive", d, "file_type", `like.%${label}%`),
      f("same, case-sensitive upper (no match)", d, "file_type", `like.%${label.toUpperCase()}%`),
      f("exact, 51 bytes with an escape", d, "file_type", `ilike.${label.replace("'", "\\'")}`),
      f("long literal, no match", d, "file_type", `ilike.%${"x".repeat(60)}%`),
      f("negated long", d, "file_type", `not.ilike.%${label}%`),
      f("prefix", d, "file_type", `ilike.ABITUR${pad}`),
      f("suffix", d, "file_type", `ilike.${pad}ÜBERSICHT`),
      f("two middle segments", d, "file_type", `ilike.%NOTEN%BERSICHT${pad}`),
      f("middle segment with _", d, "file_type", `ilike.%N_TEN%BERS_CHT${pad}`),
      f("six middle segments, folded", d, "file_type", `ilike.%N%Ö%T%É%Ü%Ô%${pad}`),
      {
        label: "six `_` middle segments, three negated groups deep, quantified",
        table: d,
        params: [["not.or", `(and(not.or(file_type.not.ilike.%Ö_É%Ü_Ô%Ä_È%À_Ç%Ñ_Ï%Ë_Â${pad},file_type.ilike(all).{%N_TEN%${pad},%NOT%${pad}}),id.not.is.null),file_type.ilike.%BERS_CHT%${pad})`]],
      },
      f("case-sensitive with GLOB metacharacters", d, "file_type", `like.%[*?]%${pad}`),
      f("long quantified", d, "file_type", `ilike(any).{"%${label}%",%PASS%}`),
      f("a long ciEmail()-shaped address", "sub_admins", "email", `ilike.${"a".repeat(40)}\\_long.name@example-hospital.de`),
    ])).toEqual([]);
  }, 300_000);

  it("operands are read by the column's input function", async () => {
    const d = "documents";
    const id = sample.docId;
    const mixed = id.slice(0, 8).toUpperCase() + id.slice(8);
    const at = sample.uploadedAt;
    const due = sample.dueDate;
    expect(await check([
      f("upper-case uuid", d, "id", `eq.${id.toUpperCase()}`),
      f("mixed-case uuid", d, "id", `eq.${mixed}`),
      f("braced uuid", d, "id", `eq.{${id}}`),
      f("upper-case uuid in a list", d, "id", `in.(${id.toUpperCase()})`),
      f("not-a-uuid", d, "id", "eq.not-a-uuid"),
      f("not-a-uuid in a list", d, "id", `in.(${id},not-a-uuid)`),
      f("null on a uuid", d, "user_id", "in.(null)"),
      f("boolean maybe", d, "uploaded_by_admin", "eq.maybe"),
      f("boolean prefix", d, "uploaded_by_admin", "eq.tru"),
      f("integer empty string", "assistant_reminders", "remind_count", "eq."),
      f("integer true", "assistant_reminders", "remind_count", "eq.true"),
      f("integer overflow", "assistant_reminders", "remind_count", "eq.3000000000"),
      f("numeric word", "affiliates", "commission_eur", "gte.abc"),
      f("timestamptz junk", d, "uploaded_at", "gte.not-a-date"),
      f("timestamptz null", d, "uploaded_at", "eq.null"),
      f("space-separated UTC timestamp, eq", d, "uploaded_at", `eq.${at.replace("T", " ")}`),
      f("space-separated UTC timestamp, gte", d, "uploaded_at", `gte.${at.replace("T", " ")}`),
      f("+00 offset", d, "uploaded_at", `eq.${at.replace("+00:00", "+00")}`),
      f("timestamp with a trailing letter", d, "uploaded_at", `eq.${at}x`),
      f("String(new Date()) on the Worker", d, "uploaded_at", "eq.Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)"),
      f("date with a trailing letter", "assistant_reminders", "due_date", `eq.${due}x`),
      f("letter before a date", "assistant_reminders", "due_date", `eq.q ${due}`),
      f("zulu after a date", "assistant_reminders", "due_date", `eq.${due}z`),
      f("unit letter labelling nothing", "assistant_reminders", "due_date", `eq.${due}h`),
      f("unit letter after a time", d, "uploaded_at", `eq.${at.slice(0, 19).replace("T", " ")} y`),
      f("ISO T with a two-digit number", "assistant_reminders", "due_date", `eq.${due}T10`),
      f("ISO T with a fraction", "assistant_reminders", "due_date", `eq.${due}T10.5`),
      f("ISO T with hhmm", "assistant_reminders", "due_date", `eq.${due}T1030`),
      f("ISO T with hhmmss past midnight", "assistant_reminders", "due_date", `eq.${due}T250000`),
      f("German date order", "assistant_reminders", "due_date", "eq.29.05.2004"),
      f("uuid[] element", "calendar_events", "attendee_ids", `cs.{${sample.attendee.toUpperCase()}}`),
    ])).toEqual([]);
  }, 300_000);

  it("PostgREST's filter grammar", async () => {
    const c = "candidate_profiles";
    const name = sample.firstName;
    expect(await check([
      // the unbalanced paren of the admin candidate search
      f("paren ends the value", c, "or", "(first_name.ilike.%a)%,last_name.ilike.%a)%)"),
      f("paren then text", c, "or", "(first_name.ilike.%a)b%,last_name.ilike.%a)b%)"),
      f("two parens", c, "or", "(first_name.ilike.%a))%,last_name.ilike.%a))%)"),
      f("open paren", c, "or", "(first_name.ilike.%(a%,last_name.ilike.%(a%)"),
      f("text after the group", c, "or", "(first_name.ilike.%a)zzz"),
      f("paren inside and()", c, "or", "(and(first_name.ilike.%a)b),last_name.ilike.%a)"),
      f("and() closed early", c, "or", "(and(first_name.ilike.%a)),last_name.ilike.%zz%)"),
      f("unterminated group", c, "or", "(first_name.ilike.%a"),
      f("or without parens", c, "or", "first_name.ilike.%a"),
      // quoting
      f("quoted tree value", c, "or", `(first_name.eq."${name}",first_name.eq.zz)`),
      f("quote not closing the item", c, "or", `(first_name.eq."${name}"x,first_name.eq.zz)`),
      f("quoted top-level value", c, "first_name", `eq."${name}"`),
      f("quoted list item", c, "first_name", `in.("${name}",zz)`),
      f("list item runs to the first paren", c, "first_name", `in.(${name},a)b)`),
      f("quoted status", "documents", "status", 'eq."approved"'),
      f("quoted status, negated", "documents", "status", 'neq."approved"'),
      f("quoted pattern", "documents", "file_type", 'ilike."*PASS*"'),
      // negation, keywords, quantifiers
      f("not.or parameter", "documents", "not.or", "(status.eq.approved,status.eq.pending)"),
      f("not.and inside a tree", "documents", "or", "(not.and(status.eq.approved,uploaded_by_admin.is.true),id.is.null)"),
      f("is.not_null", "documents", "superseded_at", "is.not_null"),
      f("is.NULL", "documents", "superseded_at", "is.NULL"),
      f("is.not.null is no grammar", "documents", "superseded_at", "is.not.null"),
      f("is.unknown on a boolean", "documents", "uploaded_by_admin", "is.unknown"),
      f("is.true on text", "documents", "file_type", "is.true"),
      f("like(all)", "documents", "file_type", "like(all).{%Noten%,%bersicht%}"),
      f("eq(any)", "documents", "file_type", "eq(any).{Notenübersicht,Passeport}"),
      f("gt(all)", "documents", "rotation", "gt(all).{-1,0}"),
      f("neq(any) is no grammar", "documents", "file_type", "neq(any).{a}"),
      f("isdistinct", "documents", "uploaded_by_admin", "isdistinct.true"),
      // operator errors
      f("unknown operator", "documents", "file_type", "foo.x"),
      f("unknown negated operator", "documents", "file_type", "not.foo.x"),
      f("operator with junk", "documents", "file_type", "eqx.x"),
      f("field name with junk", "documents", "file_type- >x", "eq.a"),
      f("range operator on uuid", "documents", "id", "sl.a"),
      f("range operator on text", "documents", "file_type", "adj.a"),
      f("range operator on text[]", "upload_links", "doc_keys", "nxl.{a}"),
      f("fts on a uuid", "documents", "id", "fts.a"),
      f("fts with a language on a date", "assistant_reminders", "due_date", "fts(simple).a"),
      // array containment on text[]
      f("contains the empty array", "upload_links", "doc_keys", "cs.{}"),
      f("does not contain the empty array", "upload_links", "doc_keys", "not.cs.{}"),
      f("contains", "upload_links", "doc_keys", "cs.{langcert}"),
      f("contains, case differs", "upload_links", "doc_keys", "cs.{LANGCERT}"),
      f("overlaps", "upload_links", "doc_keys", "ov.{langcert}"),
      f("contained by", "upload_links", "doc_keys", "cd.{langcert,diploma,x}"),
      f("malformed array", "upload_links", "doc_keys", "cs.{a}x"),
    ])).toEqual([]);
  }, 300_000);

  it("refuses by name what it does not implement, and treats a trailing escape as the non-match it is", async () => {
    expect(await check([
      f("json path filter", "candidate_profiles", "cv_draft->>driverLicense", "eq.unset", "refused"),
      f("json path in a tree", "candidate_profiles", "or", "(cv_draft->>driverLicense.eq.unset,user_id.is.null)", "refused"),
      f("jsonb containment", "candidate_profiles", "cv_draft", 'cs.{"driverLicense":"unset"}', "refused"),
      f("jsonb contained-by", "candidate_profiles", "cv_draft", 'cd.{"driverLicense":"unset"}', "refused"),
      f("full-text search", "messages", "body", "fts.visa", "refused"),
      f("regular expression", "documents", "file_type", "match.^Noten", "refused"),
      f("bit shift on an integer", "documents", "rotation", "sl.1", "refused"),
      f("trailing escape, indexed column", "documents", "file_type", `ilike.noten${BS}`, "plan"),
      f("trailing escape after %", "documents", "file_type", `ilike.%${BS}`, "plan"),
      f("trailing escape, like on an indexed column", "documents", "file_type", `like.Noten${BS}`, "plan"),
      f("trailing escape, no match anywhere", "documents", "file_type", `ilike.zzzz${BS}`, "plan"),
    ])).toEqual([]);
  }, 300_000);
});
