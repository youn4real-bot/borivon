/**
 * PostgREST HTTP request → QueryIntent (Supabase → D1 migration, step 3).
 *
 * supabase-js never hands us a JS object: it serialises every
 * `.from("documents").select("*").eq("user_id", x)` chain into an HTTP request
 * at `/rest/v1/documents?select=*&user_id=eq.<x>`. This module reads that back.
 * It is the ONLY place that knows PostgREST's URL grammar — everything after it
 * works off the typed QueryIntent.
 *
 * Fidelity notes, checked against the @supabase/postgrest-js actually installed
 * here (node_modules/@supabase/postgrest-js/src + dist), because THAT is what
 * builds these URLs — not the docs:
 *  - `.single()` sets `Accept: application/vnd.pgrst.object+json`. `.maybeSingle()`
 *    sets NOTHING on the wire any more — it fetches a list and enforces
 *    cardinality client-side (postgrest-js #361). So the 367 maybeSingle call
 *    sites arrive here as ordinary list selects; never expect a header for them,
 *    and never make a 0-row list an error.
 *  - `.range(from,to)` is sent as `offset=`+`limit=` query params, NOT a Range
 *    header. We still read `Range: a-b` because PostgREST itself accepts it.
 *  - `.select()` on a mutation appends `Prefer: return=representation`; without
 *    it a mutation must return nothing (`return=minimal`).
 *  - `.upsert()` always appends `Prefer: resolution=merge-duplicates` (or
 *    `ignore-duplicates`) — that header, not the method, is what distinguishes an
 *    upsert from an insert, since both are POST.
 *  - bulk insert/upsert also sets `columns="a","b"` (the union of the row keys).
 *    We ignore it on purpose: our `values` array already carries those keys, so
 *    re-deriving them downstream is equivalent.
 *
 * NEVER throws. ~43 call sites branch on PostgREST error CODES to degrade
 * gracefully when a migration hasn't been run yet (PGRST205 missing table,
 * 42703 / PGRST204 missing column, and message regexes like
 * /column .* does not exist|schema cache/i — see lib/assistantTools.ts:907,1422).
 * A parse failure that throws would 500 instead of degrading, so every failure
 * comes back as a PostgrestError value with those exact codes and phrasings.
 */
import type {
  ColumnMeta, Condition, FilterOp, Group, OrderBy, PostgrestError,
  QueryIntent, Registry, SelectItem, Where,
} from "./types";

/** The request, already read off the wire — lets the parser stay pure/sync. */
export type RequestParts = {
  method: string;
  /** Absolute URL, or just `/rest/v1/<table>?…` (resolved against a dummy origin). */
  url: string;
  headers: Headers | Record<string, string>;
  /** Already-parsed JSON body (POST/PATCH). `undefined` when there is none. */
  body?: unknown;
};

/* ------------------------------------------------------------------ errors */

function pgErr(code: string, message: string, status: number, details: string | null = null, hint: string | null = null): PostgrestError {
  return { code, message, details, hint, status };
}

/** Missing table → PGRST205 + "schema cache" wording: 19 call sites test for it. */
function errNoTable(table: string): PostgrestError {
  return pgErr("PGRST205", `Could not find the table 'public.${table}' in the schema cache`, 404);
}

/** Missing column in a filter/select/order → 42703 (Postgres undefined_column). */
function errNoColumn(table: string, column: string): PostgrestError {
  return pgErr("42703", `column ${table}.${column} does not exist`, 400);
}

/**
 * Missing column in a WRITE payload → PGRST204, which is what PostgREST answers
 * (it checks the body against its schema cache before touching the table). The
 * schema-tolerant inserts in this codebase key off exactly 42703 *or* PGRST204.
 */
function errNoBodyColumn(table: string, column: string): PostgrestError {
  return pgErr("PGRST204", `Could not find the '${column}' column of '${table}' in the schema cache`, 400);
}

/** Syntax we cannot read → PGRST100, PostgREST's own parse-failure code. */
function errParse(what: string, details: string): PostgrestError {
  return pgErr("PGRST100", `failed to parse ${what}`, 400, details);
}

/** Grammar we deliberately never implemented (joins, fts, casts…). Loud on purpose. */
function errUnsupported(details: string): PostgrestError {
  return pgErr("PGRST100", "failed to parse request", 400, `d1-adapter: ${details}`);
}

/** Callers get a union back; this is the cheap discriminator. */
export function isPgrestError(x: QueryIntent | PostgrestError): x is PostgrestError {
  return typeof (x as PostgrestError).code === "string";
}

/* ------------------------------------------------------ registry lookups -- */

/**
 * Own-property lookup — the ONLY way this module may consult the registry or a
 * request body.
 *
 * Both come from JSON.parse, so both inherit Object.prototype: a bare
 * `columns[name]` answers "yes, that exists" for `constructor`, `__proto__`,
 * `toString`, `valueOf`… and waves an identifier the schema never had straight
 * past the gate. `/rest/v1/constructor?select=id` then threw a TypeError
 * (`registry["constructor"].columns` is undefined) — a 500 out of a module whose
 * whole contract is that it never throws — and `?__proto__=eq.1`, or a body of
 * `{"__proto__": 1}` (JSON.parse makes that an ORDINARY own key, unlike the
 * object literal), reached the SQL builder as a real column and died at D1
 * instead of returning the PGRST205 / 42703 / PGRST204 the ~43 schema-tolerant
 * call sites branch on.
 */
function own<T>(obj: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

/* ------------------------------------------------------- value decoding ---- */

/**
 * Split on `sep` at depth 0 only: `in.(…)` lists and nested `and(…)` groups put
 * commas inside parens, and postgrest-js double-quotes any `in` value containing
 * `,` `(` `)` (PostgrestReservedCharsRegexp) instead of escaping it.
 */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quoted = false, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === "\\" && i + 1 < s.length) { cur += c + s[++i]; continue; }
      if (c === '"') quoted = false;
      cur += c;
      continue;
    }
    if (c === '"') { quoted = true; cur += c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const NUMERIC_PG = new Set(["integer", "bigint", "numeric"]);
/** No leading zeros / plus signs: `phone=eq.0612345678` must stay a string. */
const CANONICAL_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * One PostgREST scalar → a JS value.
 *
 * Quoting decides literalness: `"true"` is the text "true", bare `true` is the
 * boolean. Type coercion is registry-driven rather than shape-driven, because
 * shape alone lies — a text column holding "0612345678" or "true" would get
 * silently turned into a number/boolean and stop matching its row.
 */
function decodeScalar(raw: string, col?: ColumnMeta): unknown {
  // Deliberately NOT trimmed: PostgREST compares the bytes it was given, so
  // `.eq("name", " John ")` must keep its spaces. Incidental whitespace is
  // trimmed where the grammar allows it instead (group items, select, order).
  const t = raw;
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  // `.eq(col, null)` serialises to `eq.null`; Postgres then compares against NULL
  // and matches nothing. Decoding to JS null reproduces that (SQLite `= NULL` is
  // also never true) — `.is()` remains the only way to test for NULL.
  if (t === "null") return null;
  if ((t === "true" || t === "false") && col?.pg === "boolean") return t === "true";
  if (col && NUMERIC_PG.has(col.pg) && CANONICAL_NUMBER.test(t)) {
    const n = Number(t);
    // bigint ids beyond 2^53 would round; leave those as text (SQLite applies the
    // column's numeric affinity to a bound string, so the comparison still works).
    if (Number.isFinite(n) && (col.pg === "numeric" || Number.isSafeInteger(n))) return n;
  }
  return t;
}

/** `{a,b}` (Postgres array literal, what `.contains()` sends for a text[]). */
function decodeArrayLiteral(raw: string): unknown {
  const t = raw.trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    // A jsonb `.contains({k:v})` arrives as JSON.stringify output — valid JSON,
    // which `{a,b}` never is, so this tells the two apart without guessing.
    try { return JSON.parse(t); } catch { /* array literal below */ }
    const inner = t.slice(1, -1);
    if (inner.trim() === "") return [];
    return splitTop(inner, ",").map((v) => decodeScalar(v));
  }
  try { return JSON.parse(t); } catch { return t; }
}

const SUPPORTED_OPS = new Set<FilterOp>(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "cs"]);

/**
 * `eq.approved` / `not.in.(1,2)` / `is.null` → a Condition.
 * `expr` is the part after `<column>=`, already URL-decoded by URLSearchParams.
 */
function parseFilterExpr(table: string, registry: Registry, column: string, expr: string): Condition | PostgrestError {
  const col = own(registry[table].columns, column);
  if (!col) return errNoColumn(table, column);

  let rest = expr;
  let negate = false;
  if (rest.startsWith("not.")) { negate = true; rest = rest.slice(4); }

  const dot = rest.indexOf(".");
  if (dot < 0) return errParse(`filter (${column}=${expr})`, "expected <op>.<value>");
  const opName = rest.slice(0, dot);
  let value = rest.slice(dot + 1);

  if (!SUPPORTED_OPS.has(opName as FilterOp)) {
    return errUnsupported(`operator '${opName}' is not implemented (filter ${column}=${expr})`);
  }
  const op = opName as FilterOp;

  if (op === "in") {
    if (!(value.startsWith("(") && value.endsWith(")"))) {
      return errParse(`filter (${column}=${expr})`, "in expects a parenthesised list");
    }
    const inner = value.slice(1, -1);
    // `.in("id", [])` sends `in.()`. Keep it as [] — an empty match, not an error.
    const items = inner.trim() === "" ? [] : splitTop(inner, ",").map((v) => decodeScalar(v, col));
    return { kind: "cmp", column, op, value: items, ...(negate ? { negate } : {}) };
  }

  if (op === "is") {
    // PostgREST only ever sends `is.null|true|false`; `.not("c","is",null)` puts the
    // negation in front (`not.is.null`). Hand-written `or=(…)` strings sometimes
    // carry `is.not.null` instead, so accept that spelling too (XOR the negations).
    if (value.startsWith("not.")) { negate = !negate; value = value.slice(4); }
    if (value === "null") return { kind: "cmp", column, op, value: null, ...(negate ? { negate } : {}) };
    if (value === "true" || value === "false") {
      return { kind: "cmp", column, op, value: value === "true", ...(negate ? { negate } : {}) };
    }
    return errParse(`filter (${column}=${expr})`, "is expects null, true or false");
  }

  if (op === "cs") {
    return { kind: "cmp", column, op, value: decodeArrayLiteral(value), ...(negate ? { negate } : {}) };
  }

  if (op === "like" || op === "ilike") {
    const quoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
    const pattern = decodeScalar(value, col);
    // PostgREST accepts `*` as an alias for `%` in unquoted patterns; this codebase
    // writes `%…%`, but a user-typed `*` must behave the same here as on Supabase.
    const text = typeof pattern === "string" && !quoted ? pattern.replace(/\*/g, "%") : pattern;
    return { kind: "cmp", column, op, value: text, ...(negate ? { negate } : {}) };
  }

  return { kind: "cmp", column, op, value: decodeScalar(value, col), ...(negate ? { negate } : {}) };
}

/**
 * `or=(a.eq.1,and(b.is.null,c.in.(x,y)))` → a Group tree. The outer parens are
 * already stripped by the caller; children may nest and()/or() to any depth.
 */
function parseGroup(kind: "and" | "or", inner: string, table: string, registry: Registry): Group | PostgrestError {
  const children: Where[] = [];
  for (const raw of splitTop(inner, ",")) {
    const item = raw.trim();
    if (item === "") return errParse(`filter (${kind}=(${inner}))`, "empty condition");

    const nested = /^(and|or)\((.*)\)$/.exec(item);
    if (nested) {
      const sub = parseGroup(nested[1] as "and" | "or", nested[2], table, registry);
      if ("code" in sub) return sub;
      children.push(sub);
      continue;
    }
    if (/^not\.(and|or)\(/.test(item)) {
      // A negated GROUP has no representation in Where (only leaves carry `negate`),
      // and nothing in this codebase emits one. Fail loudly rather than silently
      // dropping the negation and returning too many rows.
      return errUnsupported(`negated group '${item}' is not implemented`);
    }

    const dot = item.indexOf(".");
    if (dot < 0) return errParse(`filter (${kind}=(${inner}))`, `expected <column>.<op>.<value>, got '${item}'`);
    const cond = parseFilterExpr(table, registry, item.slice(0, dot), item.slice(dot + 1));
    if ("code" in cond) return cond;
    children.push(cond);
  }
  return { kind, children };
}

/* --------------------------------------------------------------- select ---- */

/**
 * `"user_id, b2_stage, cv_langs:cv_draft->langs"` → SelectItem[].
 * Aliases and the single json-path form are the only shapes this codebase uses;
 * embedded resources (`org:organizations(name)`) are out of scope by measurement.
 */
function parseSelect(raw: string, table: string, registry: Registry): SelectItem[] | "*" | PostgrestError {
  const text = raw.trim();
  if (text === "" || text === "*") return "*";

  const items: SelectItem[] = [];
  for (const piece of splitTop(text, ",")) {
    let part = piece.trim();
    if (part === "") continue;
    if (part === "*") return "*"; // `*` anywhere means "every column"
    if (part.includes("(")) return errUnsupported(`embedded resource '${part}' is not implemented`);
    if (part.includes("::")) return errUnsupported(`cast '${part}' is not implemented`);

    let alias: string | undefined;
    const colon = part.indexOf(":");
    if (colon > 0) { alias = part.slice(0, colon).trim(); part = part.slice(colon + 1).trim(); }

    let jsonPath: string | undefined;
    // `->` and `->>` differ only in the returned type; this codebase reads the one
    // `cv_draft->langs` and json-parses it either way, so they collapse here.
    const m = /^(.*?)->>?(.*)$/.exec(part);
    if (m) {
      part = m[1].trim();
      jsonPath = m[2].trim().replace(/->>/g, "->").replace(/"/g, "");
      // PostgREST names an un-aliased json path after its last key.
      if (!alias) alias = jsonPath.split("->").pop()!.trim();
    }

    // postgrest-js keeps double quotes around identifiers that need them
    // (`select('"odd name"')`) — the registry stores the bare name.
    if (part.length >= 2 && part.startsWith('"') && part.endsWith('"')) part = part.slice(1, -1);

    if (!own(registry[table].columns, part)) return errNoColumn(table, part);
    items.push({ column: part, ...(alias ? { alias } : {}), ...(jsonPath ? { jsonPath } : {}) });
  }
  return items.length ? items : "*";
}

/* ---------------------------------------------------------------- order ---- */

/** `order=created_at.desc.nullslast,id.asc` → OrderBy[]. */
function parseOrder(raw: string, table: string, registry: Registry): OrderBy[] | PostgrestError {
  const out: OrderBy[] = [];
  for (const piece of raw.split(",")) {
    const part = piece.trim();
    if (part === "") continue;
    const [column, ...mods] = part.split(".");
    if (!own(registry[table].columns, column)) return errNoColumn(table, column);

    // Defaults mirror Postgres: ASC, and nulls-position left undefined so the SQL
    // builder can apply Postgres' own rule (NULLS LAST for asc, FIRST for desc).
    let ascending = true;
    let nullsFirst: boolean | undefined;
    for (const mod of mods) {
      if (mod === "asc") ascending = true;
      else if (mod === "desc") ascending = false;
      else if (mod === "nullsfirst") nullsFirst = true;
      else if (mod === "nullslast") nullsFirst = false;
      else return errParse(`order (${part})`, `unknown modifier '${mod}'`);
    }
    out.push({ column, ascending, ...(nullsFirst === undefined ? {} : { nullsFirst }) });
  }
  return out;
}

/* --------------------------------------------------------------- headers --- */

function headerOf(headers: Headers | Record<string, string>, name: string): string | null {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, string>)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

function parseNonNegativeInt(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/* ----------------------------------------------------------------- main ---- */

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

/**
 * The pure core: no network, no D1, no async. Everything the adapter decides
 * about a request is decided here, so it can be unit-tested request-by-request.
 */
export function parseParts(parts: RequestParts, registry: Registry): QueryIntent | PostgrestError {
  const method = (parts.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method)) {
    return pgErr("PGRST101", `Method ${method} not allowed`, 405);
  }

  let url: URL;
  try { url = new URL(parts.url, "http://d1.local"); }
  catch { return errParse("url", `not a URL: ${parts.url}`); }

  const segments = url.pathname.split("/").filter(Boolean);
  const rawTable = segments[segments.length - 1] ?? "";
  if (segments[segments.length - 2] === "rpc") {
    return errUnsupported("rpc is handled outside parseRequest");
  }
  // `url.pathname` keeps its percent-escapes, and a malformed one (`/rest/v1/%zz`)
  // makes decodeURIComponent throw a URIError. A thrown parser is a 500; a table
  // nobody can name is simply a table that isn't there.
  let table: string;
  try { table = decodeURIComponent(rawTable); }
  catch { return errNoTable(rawTable); }
  if (!table || !own(registry, table)) return errNoTable(table);

  /* headers → cardinality / count / returning / conflict resolution */
  const accept = headerOf(parts.headers, "Accept") ?? "";
  const prefer = headerOf(parts.headers, "Prefer") ?? "";
  const singleObject = accept.includes("application/vnd.pgrst.object+json");
  // With that Accept header PostgREST 406s (PGRST116) on 0 or >1 rows — that IS
  // `.single()`. `.maybeSingle()` never sends it (see the header comment).
  const requireExactlyOne = singleObject;
  // "planned"/"estimated" are approximations of the same COUNT; D1 has nothing
  // cheaper than an exact count, and nothing in this codebase asks for them.
  const count = /count=(exact|planned|estimated)/.test(prefer) ? ("exact" as const) : undefined;
  const resolution = /resolution=(merge|ignore)-duplicates/.exec(prefer);

  const isMutation = method === "POST" || method === "PATCH" || method === "DELETE";
  const action: QueryIntent["action"] =
    method === "POST" ? (resolution ? "upsert" : "insert")
      : method === "PATCH" ? "update"
        : method === "DELETE" ? "delete"
          : "select";

  // A mutation returns rows only when `.select()` was chained (return=representation);
  // a plain select always returns its rows.
  const returning: QueryIntent["returning"] =
    !isMutation || /return=representation/.test(prefer) ? "representation" : "minimal";

  /* select list */
  const rawSelect = url.searchParams.get("select");
  const select = parseSelect(rawSelect ?? "*", table, registry);
  if (typeof select === "object" && !Array.isArray(select)) return select;

  /* filters: every non-reserved param is a column (or a logical group) */
  const where: Where[] = [];
  for (const [key, raw] of url.searchParams) {
    if (RESERVED_PARAMS.has(key)) continue;
    if (key === "or" || key === "and") {
      const inner = raw.trim().startsWith("(") && raw.trim().endsWith(")") ? raw.trim().slice(1, -1) : raw.trim();
      const group = parseGroup(key, inner, table, registry);
      if ("code" in group) return group;
      where.push(group);
      continue;
    }
    // `instruments.order=…` / `instruments.limit=…` only exist for embedded
    // resources, which we don't support — better a 400 than silently ignoring them.
    if (key.includes(".")) return errUnsupported(`referenced-table parameter '${key}' is not implemented`);
    const cond = parseFilterExpr(table, registry, key, raw);
    if ("code" in cond) return cond;
    where.push(cond);
  }

  /* order / limit / offset */
  let order: OrderBy[] = [];
  const rawOrder = url.searchParams.get("order");
  if (rawOrder !== null) {
    const parsed = parseOrder(rawOrder, table, registry);
    if (!Array.isArray(parsed)) return parsed;
    order = parsed;
  }

  let limit: number | undefined;
  let offset: number | undefined;
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit !== null) {
    const n = parseNonNegativeInt(rawLimit);
    if (n === null) return errParse("limit", `expected a non-negative integer, got '${rawLimit}'`);
    limit = n;
  }
  const rawOffset = url.searchParams.get("offset");
  if (rawOffset !== null) {
    const n = parseNonNegativeInt(rawOffset);
    if (n === null) return errParse("offset", `expected a non-negative integer, got '${rawOffset}'`);
    offset = n;
  }
  // postgrest-js sends .range() as offset+limit, but PostgREST also honours a
  // `Range: from-to` header (inclusive, 0-based). Explicit params win.
  if (limit === undefined && offset === undefined) {
    const range = /^(\d+)-(\d*)$/.exec((headerOf(parts.headers, "Range") ?? "").trim());
    if (range) {
      offset = Number(range[1]);
      if (range[2] !== "") limit = Number(range[2]) - offset + 1;
      if (limit !== undefined && limit < 0) return errParse("range", `'${range[0]}' ends before it starts`);
    }
  }

  const intent: QueryIntent = {
    action, table, select, where, order,
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    ...(singleObject ? { singleObject, requireExactlyOne } : {}),
    ...(count ? { count } : {}),
    ...(method === "HEAD" ? { head: true } : {}),
    returning,
  };

  /* upsert target (only a POST can be one — the same header on a read means nothing) */
  if (resolution && action === "upsert") {
    intent.ignoreDuplicates = resolution[1] === "ignore";
    const rawConflict = url.searchParams.get("on_conflict");
    if (rawConflict) {
      const cols = rawConflict.split(",").map((c) => c.trim()).filter(Boolean);
      for (const c of cols) if (!own(registry[table].columns, c)) return errNoColumn(table, c);
      intent.onConflict = cols;
    }
    // No on_conflict → PostgREST falls back to the table's primary key; the SQL
    // builder reads registry[table].pk, so we deliberately leave it unset.
  }

  /* write payload */
  if (method === "POST" || method === "PATCH") {
    const body = parts.body;
    if (body === undefined || body === null) return pgErr("PGRST102", "Empty or invalid json", 400, "missing request body");
    const rows = Array.isArray(body) ? body : [body];
    if (method === "PATCH" && Array.isArray(body)) {
      return pgErr("PGRST102", "Empty or invalid json", 400, "update expects a single object");
    }
    for (const row of rows) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        return pgErr("PGRST102", "Empty or invalid json", 400, "expected an object or an array of objects");
      }
      for (const key of Object.keys(row)) {
        if (!own(registry[table].columns, key)) return errNoBodyColumn(table, key);
      }
    }
    intent.values = rows as Record<string, unknown>[];
  }

  return intent;
}

/**
 * Entry point for the adapter: reads the body off the Request, then parses.
 * Async only because `Request.text()` is — all the logic lives in parseParts().
 */
export async function parseRequest(request: Request, registry: Registry): Promise<QueryIntent | PostgrestError> {
  const method = request.method.toUpperCase();
  let body: unknown;
  if (method === "POST" || method === "PATCH") {
    let text: string;
    try { text = await request.text(); }
    catch { return pgErr("PGRST102", "Empty or invalid json", 400, "could not read the request body"); }
    if (text.trim() === "") {
      // PostgREST treats an empty body as invalid for writes; keep the same code so
      // callers see a 400 rather than a silent no-op insert.
      return pgErr("PGRST102", "Empty or invalid json", 400, "empty request body");
    }
    try { body = JSON.parse(text); }
    catch { return pgErr("PGRST102", "Empty or invalid json", 400, "body is not valid JSON"); }
  }
  return parseParts({ method, url: request.url, headers: request.headers, body }, registry);
}
