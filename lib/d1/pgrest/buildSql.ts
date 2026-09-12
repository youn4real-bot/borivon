/**
 * QueryIntent → SQLite SQL + bound params for D1 (PostgREST→D1 adapter, step 3).
 *
 *   Request → parseRequest() → QueryIntent → **buildSql()** → {sql, params} → D1
 *
 * Pure: no network, no D1 client, no clock. Everything it needs about the
 * database comes from the generated registry (d1/types.json) — which is also
 * the only thing that makes an identifier legal. A table or column that isn't
 * in the registry is never emitted, so no caller-supplied text can reach the
 * SQL text; values are ALWAYS bound parameters.
 *
 * The whole job is preserving behaviour the 1,261 `.from(...)` call sites
 * already depend on. SQLite differs from Postgres in four ways that bite here,
 * and each one is emulated rather than ignored:
 *
 *  1. NULL ordering is REVERSED. Postgres: nulls sort last in ASC, first in
 *     DESC. SQLite: nulls sort first in ASC, last in DESC. So every ORDER BY on
 *     a nullable column gets an explicit `(col IS NULL)` term — otherwise e.g.
 *     `.order("uploaded_at", { ascending: false })` would surface rows with no
 *     timestamp at the BOTTOM instead of the top.
 *  2. LIKE has no default escape character. Postgres' is backslash, which
 *     lib/admin-auth's ciEmail() relies on (`first_last@x.com` must not act as
 *     a wildcard). So every LIKE gets `ESCAPE '\'`.
 *  3. LIKE case-folds ASCII by default — that IS Postgres' `ilike`, but it is
 *     NOT Postgres' `like`. Case-sensitive `like` is emitted as GLOB with the
 *     pattern translated (see likePatternToGlob).
 *  4. Every value is TEXT/INTEGER/REAL. Timestamps are ISO strings compared
 *     lexicographically, arrays/jsonb are JSON text, booleans are 0/1 — so a
 *     filter parameter has to be encoded exactly the way d1/export-data.mjs
 *     wrote the row, or `.eq()` silently misses. That codec is decode.ts's
 *     encodeValue(); encodeParam() below only re-spells timestamps for it.
 *
 * And one D1 limit shapes the SQL: a statement may bind at most 100 parameters,
 * so an `in` list travels as a single JSON array (see the `in` case).
 *
 * Out of scope on purpose (measured against the real codebase): embedded
 * joins, !inner, text search, csv, explain, aggregates, rpc.
 */

import type {
  BuiltQuery, ColumnMeta, Condition, OrderBy, PgType,
  PostgrestError, QueryIntent, Registry, SelectItem, TableMeta, Where,
} from "./types";
// decode.ts owns the value codec and the output-key rule for both directions.
// Re-deriving either here would be a second copy of a rule that has to agree
// byte-for-byte with the rows d1/export-data.mjs already wrote — and a
// disagreement is invisible: the filter simply stops matching. Both imports are
// pure functions; nothing else of decode.ts is used.
import { encodeValue, selectOutputKey } from "./decode";

/* ────────────────────────────── errors ─────────────────────────────── */

const pgErr = (code: string, message: string, status: number, hint: string | null = null): PostgrestError =>
  ({ code, message, details: null, hint, status });

/** PostgREST's "you forgot to run the migration" answer — 4 routes branch on it. */
const missingTable = (table: string): PostgrestError =>
  pgErr("PGRST205", `Could not find the table 'public.${table}' in the schema cache`, 404);

/**
 * Unknown column → 42703 (Postgres' undefined_column), NOT PostgREST's newer
 * PGRST204. Deliberate: the schema-tolerant branches in this codebase test for
 * both (lib/assistantTools.ts) except one that tests 42703 alone
 * (app/api/portal/admin/organizations/[id]/route.ts:92, the required_doc_keys
 * degrade). 42703 keeps every one of them working; PGRST204 would break that one.
 * The message still matches the `/column .* does not exist/i` fallbacks.
 */
const missingColumn = (table: string, column: string): PostgrestError =>
  pgErr("42703", `column "${column}" of relation "${table}" does not exist`, 400);

/** Thrown internally so the recursive builders stay readable; caught in buildSql. */
class BuildError extends Error {
  constructor(readonly pg: PostgrestError) { super(pg.message); }
}
const fail = (e: PostgrestError): never => { throw new BuildError(e); };

export function isPostgrestError(x: BuiltQuery | PostgrestError): x is PostgrestError {
  return typeof (x as PostgrestError).code === "string";
}

/* ─────────────────────────── value encoding ────────────────────────── */

/**
 * An ISO timestamp in any spelling → the same instant spelled in UTC, which is
 * the only thing encodeValue() knows how to render into the stored form.
 *
 * SQLite's only comparison on TEXT is lexicographic, so the spelling IS the
 * ordering. A JavaScript `new Date().toISOString()` ends in 'Z', which sorts
 * ABOVE every digit — `.gte("starts_at", nowISO)` against a stored
 * `…+00:00` would wrongly drop every row inside the same second — and a
 * non-UTC offset (`…19:25+02:00`) compares as if it were two hours later than
 * it is. Both have to be re-spelled before the comparison.
 *
 * A value that is ALREADY UTC comes back byte-for-byte, deliberately: the copy
 * holds two fraction widths — imported rows are Postgres-trimmed (`.155+00:00`)
 * while rows written by a D1 column DEFAULT are 6-digit (`.155000+00:00`) — and
 * re-rendering either one would stop it matching the other. lib/reminderFire.ts:82
 * does exactly that round trip (`.eq("due_at", r.due_at)`).
 */
export function normalizeTimestamp(value: string): string {
  const trimmed = value.trim();
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|z|[+-]\d{2}:?\d{2})?$/.exec(trimmed);
  if (!m) return value;                       // date-only, or not a timestamp — leave it exactly as given
  const [, date, time, frac = "", off] = m;
  const hms = time.length === 5 ? `${time}:00` : time;     // Postgres always prints seconds
  const zone = off === "z" ? "Z" : off;
  if (zone === "Z" || /^[+-]00:?00$/.test(zone ?? "")) {
    // Already UTC → byte-for-byte, unless the spelling first had to be repaired
    // (missing `:00`, lowercase z) for the codec to recognise it as an instant.
    return zone === off && hms === time ? trimmed : `${date}T${hms}${frac}${zone}`;
  }
  // No offset at all = Postgres would read it in the session timezone, which is
  // UTC on Supabase.
  if (!off) return `${date}T${hms}${frac}Z`;
  const sign = off[0] === "-" ? -1 : 1;
  const digits = off.replace(/[^\d]/g, "");
  const shiftMs = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
  const utc = new Date(`${date}T${hms}.000Z`).getTime() - shiftMs;
  if (!Number.isFinite(utc)) return value;
  return `${new Date(utc).toISOString().slice(0, 19)}${frac}Z`;
}

/**
 * A JS value as a D1 bound parameter, encoded the way the row was STORED.
 *
 * The encoding itself is decode.ts's encodeValue() — the adapter's single value
 * codec, which mirrors d1/export-data.mjs's encodeParam(), the function that
 * actually wrote every row now in D1 (Postgres-trimmed fractions, booleans as
 * 0/1, jsonb/arrays as JSON text, `'yes'::boolean`-style literals). A second
 * copy of those rules living here would drift, and a drift is silent: the
 * filter just stops matching the rows it was written against.
 *
 * The only step added on top is the UTC re-spelling above, which has to happen
 * BEFORE encodeValue() sees the string (it renders `Z` values and passes
 * offset values through).
 */
export function encodeParam(value: unknown, pg?: PgType): unknown {
  if (pg === "timestamptz" && typeof value === "string") return encodeValue(normalizeTimestamp(value), pg);
  return encodeValue(value, pg);
}

/**
 * Postgres LIKE pattern → SQLite GLOB pattern.
 *
 * SQLite's LIKE case-folds ASCII and cannot be made case-sensitive per-query
 * (case_sensitive_like is a connection-wide pragma), so it can express `ilike`
 * but never `like`. GLOB is case-sensitive; it just spells its wildcards
 * differently, and its literals need bracket-escaping.
 */
export function likePatternToGlob(pattern: string): string {
  const literal = (c: string) => (c === "*" || c === "?" || c === "[" ? `[${c}]` : c);
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) { out += literal(pattern[++i]); continue; } // Postgres' escape char
    if (c === "%") { out += "*"; continue; }
    if (c === "_") { out += "?"; continue; }
    out += literal(c);
  }
  return out;
}

/* ───────────────────────────── identifiers ─────────────────────────── */

/** Quote an identifier. Only ever called on names verified against the registry. */
const qi = (name: string) => `"${name.replace(/"/g, '""')}"`;

type Ctx = { table: string; meta: TableMeta; params: unknown[] };

function requireColumn(ctx: Ctx, name: string): ColumnMeta {
  const col = ctx.meta.columns[name];
  if (!col) fail(missingColumn(ctx.table, name));
  return col!;
}

/**
 * PostgREST's arrow path → an SQLite JSON path. `cv_langs:cv_draft->langs` is
 * the one form this codebase uses, but parseRequest hands the whole tail over
 * for a chained `col->a->b`, so every segment is walked.
 *
 * Each segment is a KEY, never a path expression — PostgREST's `->` takes an
 * object key or an array index and nothing else, so a key that happens to be
 * spelled `$.x` must be looked up literally (Postgres returns NULL for it) and
 * can never turn into an SQLite "JSON path error" at run time.
 */
function jsonPath(key: string): string {
  return key.split(/->>?/).map((raw) => raw.trim()).filter((s) => s !== "").reduce((path, seg) => {
    if (/^\d+$/.test(seg)) return `${path}[${seg}]`;                       // `col->0` — array index
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(seg) ? `${path}.${seg}` : `${path}."${seg.replace(/"/g, '\\"')}"`;
  }, "$");
}

/**
 * The requested output columns. Also used for a mutation's RETURNING, so it
 * MUST be called at the point the clause is emitted — it pushes params (the
 * json path) and those have to land in SQL-text order.
 *
 * The output name comes from decode.ts's selectOutputKey(), which is also what
 * decodeRows() reads the row back under. Computing it here instead would
 * silently drop a column the moment the two rules disagree — an un-aliased
 * `col->langs` is `langs` to PostgREST, and decode gives a json-path item no
 * fallback to the source column (that would hand a caller the whole CV draft
 * instead of the one key it asked for).
 */
function selectList(ctx: Ctx, select: SelectItem[] | "*"): string {
  if (select === "*" || select.length === 0) return "*";   // `.select()` after a mutation = return everything
  return select.map((item: SelectItem) => {
    requireColumn(ctx, item.column);
    const ref = qi(item.column);
    const key = selectOutputKey(item);
    if (item.jsonPath === undefined) {
      return key !== item.column ? `${ref} AS ${qi(key)}` : ref;
    }
    // Bound, not interpolated: the path is caller text like any other value.
    ctx.params.push(jsonPath(item.jsonPath));
    return `json_extract(${ref}, ?) AS ${qi(key)}`;
  }).join(", ");
}

/* ─────────────────────────────── WHERE ─────────────────────────────── */

function conditionSql(ctx: Ctx, c: Condition): string {
  const col = requireColumn(ctx, c.column);
  const ref = qi(c.column);
  const push = (v: unknown) => { ctx.params.push(v); };
  let expr: string;

  switch (c.op) {
    case "eq":  expr = `${ref} = ?`;  push(encodeParam(c.value, col.pg)); break;
    case "neq": expr = `${ref} <> ?`; push(encodeParam(c.value, col.pg)); break;
    case "gt":  expr = `${ref} > ?`;  push(encodeParam(c.value, col.pg)); break;
    case "gte": expr = `${ref} >= ?`; push(encodeParam(c.value, col.pg)); break;
    case "lt":  expr = `${ref} < ?`;  push(encodeParam(c.value, col.pg)); break;
    case "lte": expr = `${ref} <= ?`; push(encodeParam(c.value, col.pg)); break;

    case "is": {
      // `is.null` is the only NULL test that survives three-valued logic, and
      // `is.true` on a NULL column is FALSE (not NULL) — SQLite's `IS` matches
      // that exactly, including under `not.`.
      if (c.value === null || c.value === undefined) return c.negate ? `${ref} IS NOT NULL` : `${ref} IS NULL`;
      if (typeof c.value !== "boolean") {
        fail(pgErr("PGRST100", `unexpected "${String(c.value)}" expecting null, true or false`, 400));
      }
      expr = `${ref} IS ?`; push(c.value ? 1 : 0);
      break;
    }

    case "in": {
      const list = Array.isArray(c.value) ? c.value : [c.value];
      // `col = ANY('{}')` is FALSE in Postgres even for a NULL col — so an
      // empty list matches nothing, and `not.in.()` matches EVERY row. A bare
      // `0` reproduces both (SQLite's `IN ()` is an extension; don't rely on it).
      if (list.length === 0) { expr = "0"; break; }
      // The whole list travels as ONE bound parameter (a JSON array) instead of
      // one placeholder per item: **D1 allows only 100 bound parameters per
      // statement** (d1/import.mjs caps itself at 90 for the same reason), and
      // `.in("user_id", scope.visibleIds)` — lib/assistantTools.ts:209 and the
      // admin panels — routinely carries more ids than that. A placeholder list
      // would die at D1 with "too many SQL variables" once a sub-admin's scope
      // grew past 100 candidates. Items are still encoded per column type, so
      // affinity works exactly as it did with placeholders.
      expr = `${ref} IN (SELECT value FROM json_each(?))`;
      push(JSON.stringify(list.map((v) => encodeParam(v, col.pg))));
      break;
    }

    // Patterns are NOT run through encodeParam: they are patterns, not values
    // (a pattern for a jsonb column must not be JSON.stringify'd).
    case "like":  expr = `${ref} GLOB ?`; push(likePatternToGlob(String(c.value))); break;
    case "ilike": expr = `${ref} LIKE ? ESCAPE '\\'`; push(String(c.value)); break;

    case "cs": {
      // `uploaded_keys @> '{key}'` (app/api/portal/u/[token]/route.ts:166 — the
      // only containment filter in the codebase). The array is JSON text in D1,
      // so containment = every needle appears in json_each(col). The CASE keeps
      // Postgres' three-valued logic: `NULL @> x` is NULL, so `.not(col,cs,…)`
      // must EXCLUDE a NULL column rather than include it.
      // A NULL *element* inside the stored array is filtered out of the haystack
      // first: `'b' NOT IN ('a', NULL)` is NULL, not true, so a missing needle
      // would stop counting as missing and containment would answer true for an
      // array that plainly doesn't contain it.
      const needles = Array.isArray(c.value) ? c.value : [c.value];
      expr = `(CASE WHEN ${ref} IS NULL THEN NULL ELSE NOT EXISTS (`
        + `SELECT 1 FROM json_each(?) AS needle WHERE needle.value NOT IN (`
        + `SELECT value FROM json_each(${ref}) WHERE value IS NOT NULL)`
        + `) END)`;
      push(JSON.stringify(needles));
      break;
    }

    default:
      fail(pgErr("PGRST100", `unknown operator "${String((c as Condition).op)}"`, 400));
      expr = "0";
  }

  // `not.` wraps the whole comparison, which is also how Postgres treats it:
  // NOT(NULL) stays NULL, so a NULL column is excluded either way.
  return c.negate ? `NOT (${expr})` : expr;
}

function whereNode(ctx: Ctx, node: Where): string {
  if ((node as Condition).kind === "cmp") return conditionSql(ctx, node as Condition);
  const group = node as { kind: "and" | "or"; children: Where[] };
  const parts = group.children.map((child) => whereNode(ctx, child)).filter(Boolean);
  if (parts.length === 0) return group.kind === "and" ? "1" : "0";
  return `(${parts.join(group.kind === "and" ? " AND " : " OR ")})`;
}

function whereClause(ctx: Ctx, where: Where[]): string {
  if (!where.length) return "";
  return ` WHERE ${where.map((w) => whereNode(ctx, w)).join(" AND ")}`;
}

/* ──────────────────────── ORDER BY / LIMIT ─────────────────────────── */

function orderClause(ctx: Ctx, order: OrderBy[]): string {
  if (!order.length) return "";
  const terms: string[] = [];
  for (const o of order) {
    const col = requireColumn(ctx, o.column);
    // Postgres' default is NULLS LAST for ASC, NULLS FIRST for DESC. SQLite's
    // is the exact opposite, so a nullable column always gets the explicit term.
    const nullsFirst = o.nullsFirst ?? !o.ascending;
    if (col.nullable) terms.push(`(${qi(o.column)} IS NULL) ${nullsFirst ? "DESC" : "ASC"}`);
    // Supabase's text columns sort under en_US.UTF-8 (case-insensitive-ish);
    // SQLite's default is raw byte order, which would file "Zahra" before
    // "ahmed" in every candidate list. NOCASE is the closest available match.
    // Only plain text — uuid/date/timestamptz are ASCII-fixed and index-backed.
    const collate = col.pg === "text" ? " COLLATE NOCASE" : "";
    terms.push(`${qi(o.column)}${collate} ${o.ascending ? "ASC" : "DESC"}`);
  }
  return ` ORDER BY ${terms.join(", ")}`;
}

function limitClause(ctx: Ctx, intent: QueryIntent): string {
  const check = (n: number | undefined, what: string) => {
    if (n === undefined) return undefined;
    if (!Number.isInteger(n) || n < 0) fail(pgErr("PGRST103", `Requested range not satisfiable (${what} ${n})`, 416));
    return n;
  };
  const limit = check(intent.limit, "limit");
  const offset = check(intent.offset, "offset");
  let sql = "";
  if (limit !== undefined) { sql += " LIMIT ?"; ctx.params.push(limit); }
  // SQLite has no bare OFFSET — it only parses as part of a LIMIT clause.
  if (offset) {
    if (limit === undefined) sql += " LIMIT -1";
    sql += " OFFSET ?";
    ctx.params.push(offset);
  }
  return sql;
}

/* ───────────────────────────── statements ──────────────────────────── */

function buildSelect(ctx: Ctx, intent: QueryIntent): BuiltQuery {
  // head:true is only ever paired with count:"exact" here (19 call sites): the
  // body is empty and the total comes from Content-Range, so limit/order are
  // irrelevant and the count must span ALL matching rows, not just the page.
  // (A count WITHOUT head needs both the page and the total — build the second
  // query as buildSql({ ...intent, head: true }, registry) and run the two.)
  if (intent.head) {
    return { sql: `SELECT COUNT(*) AS "count" FROM ${qi(ctx.table)}${whereClause(ctx, intent.where)}`, params: ctx.params };
  }
  // NOTE: .single()/.maybeSingle() deliberately do NOT add `LIMIT 1` — PostgREST
  // fails with PGRST116 when more than one row matches, and that only works if
  // the executor can SEE the second row. Detecting it is respond()'s job.
  const sql = `SELECT ${selectList(ctx, intent.select)} FROM ${qi(ctx.table)}`
    + whereClause(ctx, intent.where)
    + orderClause(ctx, intent.order)
    + limitClause(ctx, intent);
  return { sql, params: ctx.params };
}

/**
 * PostgREST answers an empty bulk insert / an empty PATCH body with success and
 * no rows. A query that matches nothing keeps that contract (and the column
 * shape) instead of handing D1 invalid SQL.
 */
function noOpQuery(ctx: Ctx, intent: QueryIntent): BuiltQuery {
  const list = intent.returning === "representation" ? selectList(ctx, intent.select) : "*";
  return { sql: `SELECT ${list} FROM ${qi(ctx.table)} WHERE 0`, params: ctx.params };
}

function returningClause(ctx: Ctx, intent: QueryIntent): string {
  if (intent.returning !== "representation") return "";
  return ` RETURNING ${selectList(ctx, intent.select)}`;
}

/**
 * A mutation may not carry limit/offset.
 *
 * PostgREST refuses one too (a limited UPDATE/DELETE needs an explicit order),
 * and SQLite cannot express it at all without an ORDER BY + rowid subquery. The
 * point of refusing rather than dropping the clause is that dropping it makes
 * the statement hit EVERY matching row: `.delete().eq(…).limit(1)` would go
 * from deleting one row to deleting all of them. Nothing in the codebase sends
 * this today (checked), so the loud failure costs nothing.
 *
 * `order` on a mutation IS dropped, silently and safely: it only decides the
 * order of the returned representation, and no call site reads a mutation's
 * rows in order.
 */
function rejectPagedMutation(intent: QueryIntent): void {
  if (intent.limit === undefined && intent.offset === undefined) return;
  fail(pgErr("PGRST109", `limit/offset is not allowed for ${intent.action.toUpperCase()}`, 400,
    "Filter the rows you mean to change instead"));
}

/** Payload columns must exist, and must not be database-computed. */
function requireWritable(ctx: Ctx, name: string): ColumnMeta {
  const col = requireColumn(ctx, name);
  if (col.generated) {
    // e.g. messages.has_attachment. Postgres raises 428C9 here; without this
    // check D1 would answer with an opaque "cannot INSERT into generated column".
    fail(pgErr("428C9", `cannot insert into column "${name}"`, 400, "Column is generated and can only be updated to DEFAULT"));
  }
  return col;
}

function buildInsert(ctx: Ctx, intent: QueryIntent): BuiltQuery {
  const rows = intent.values ?? [];
  if (rows.length === 0) return noOpQuery(ctx, intent);

  const cols = Object.keys(rows[0]);
  if (cols.length === 0) {
    if (rows.length > 1) fail(pgErr("PGRST102", "All object keys must match", 400));
    // `.insert({})` — let every default fire. No ON CONFLICT clause even for an
    // upsert: SQLite's grammar has no upsert-clause after DEFAULT VALUES, and a
    // payload with no columns has nothing to merge anyway.
    return { sql: `INSERT INTO ${qi(ctx.table)} DEFAULT VALUES${returningClause(ctx, intent)}`, params: ctx.params };
  }
  // PostgREST refuses a bulk insert whose objects don't share one key set
  // (PGRST102) rather than guessing a NULL for the missing ones — the guess
  // would overwrite a column default. Same here.
  //
  // The key sets are joined on NUL rather than a comma because a column name is
  // caller text: `{"a,b": 1}` must not compare equal to `{"a": 1, "b": 1}`. It
  // has to be written as the \u-escape — a raw NUL byte in the source makes git,
  // grep and every review tool treat this file as binary.
  const key = cols.slice().sort().join("\u0000");
  for (const row of rows) {
    if (Object.keys(row).slice().sort().join("\u0000") !== key) fail(pgErr("PGRST102", "All object keys must match", 400));
  }
  const metas = cols.map((c) => requireWritable(ctx, c));

  const tuple = `(${cols.map(() => "?").join(", ")})`;
  let sql = `INSERT INTO ${qi(ctx.table)} (${cols.map(qi).join(", ")}) VALUES ${rows.map(() => tuple).join(", ")}`;
  for (const row of rows) cols.forEach((c, i) => ctx.params.push(encodeParam(row[c], metas[i].pg)));

  if (intent.action === "upsert") {
    // PostgREST falls back to the primary key when on_conflict is absent.
    const target = intent.onConflict?.length ? intent.onConflict : ctx.meta.pk;
    if (!target.length) {
      fail(pgErr("42P10", "there is no unique or exclusion constraint matching the ON CONFLICT specification", 400));
    }
    for (const c of target) requireColumn(ctx, c);
    sql += ` ON CONFLICT (${target.map(qi).join(", ")}) `;
    sql += intent.ignoreDuplicates
      ? "DO NOTHING"                                       // Prefer: resolution=ignore-duplicates
      : `DO UPDATE SET ${cols.map((c) => `${qi(c)} = excluded.${qi(c)}`).join(", ")}`;
  }
  return { sql: sql + returningClause(ctx, intent), params: ctx.params };
}

function buildUpdate(ctx: Ctx, intent: QueryIntent): BuiltQuery {
  rejectPagedMutation(intent);
  const payload = intent.values?.[0] ?? {};
  const cols = Object.keys(payload);
  if (cols.length === 0) return noOpQuery(ctx, intent);   // empty PATCH body = no-op, like PostgREST
  const sets = cols.map((c) => {
    const col = requireWritable(ctx, c);
    ctx.params.push(encodeParam(payload[c], col.pg));
    return `${qi(c)} = ?`;
  });
  // Param order follows SQL text: SET, then WHERE, then RETURNING.
  const sql = `UPDATE ${qi(ctx.table)} SET ${sets.join(", ")}`
    + whereClause(ctx, intent.where)
    + returningClause(ctx, intent);
  return { sql, params: ctx.params };
}

function buildDelete(ctx: Ctx, intent: QueryIntent): BuiltQuery {
  rejectPagedMutation(intent);
  const sql = `DELETE FROM ${qi(ctx.table)}${whereClause(ctx, intent.where)}${returningClause(ctx, intent)}`;
  return { sql, params: ctx.params };
}

/* ─────────────────────────────── entry ─────────────────────────────── */

export function buildSql(intent: QueryIntent, registry: Registry): BuiltQuery | PostgrestError {
  const meta = registry[intent.table];
  if (!meta) return missingTable(intent.table);
  const ctx: Ctx = { table: intent.table, meta, params: [] };
  try {
    switch (intent.action) {
      case "select": return buildSelect(ctx, intent);
      case "insert":
      case "upsert": return buildInsert(ctx, intent);
      case "update": return buildUpdate(ctx, intent);
      case "delete": return buildDelete(ctx, intent);
      default:       return pgErr("PGRST100", `unsupported action "${String(intent.action)}"`, 400);
    }
  } catch (e) {
    if (e instanceof BuildError) return e.pg;
    // Anything else is a bug in here, and a throw would escape lib/d1/bvFetch.ts
    // (which only wraps the D1 call itself) as a rejected fetch — supabase-js
    // turns that into an exception at the call site instead of the `{ error }`
    // every route already handles. XX000 + 500 is errors.ts's own unknown
    // bucket, so the failure arrives in the shape callers can branch on.
    return pgErr("XX000", e instanceof Error ? e.message : "Unknown query build error", 500);
  }
}
