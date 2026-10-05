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
 *  - bulk insert/upsert also sets `columns="a","b"` (the union of the row keys),
 *    and `defaultToNull: false` adds `Prefer: missing=default`. Both are read
 *    (see the write payload below): with `columns` PostgREST writes rows whose
 *    keys differ, a missing key becoming NULL or the column default.
 *
 * Filter VALUES are a second grammar with its own traps, checked against the
 * live project rather than the docs — see the "filter grammar" section.
 *
 * NEVER throws. ~43 call sites branch on PostgREST error CODES to degrade
 * gracefully when a migration hasn't been run yet (PGRST205 missing table,
 * 42703 / PGRST204 missing column, and message regexes like
 * /column .* does not exist|schema cache/i — see lib/assistantTools.ts:907,1422).
 * A parse failure that throws would 500 instead of degrading, so every failure
 * comes back as a PostgrestError value with those exact codes and phrasings.
 */
import type {
  ColumnMeta, Condition, FilterOp, JsonOp, OrderBy, PostgrestError,
  QueryIntent, Registry, SelectItem, Where,
} from "./types";
import { arrayIn, inputValue, isInputError, pgTypeName } from "./pgInput";
import { resolveRange } from "./range";

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

/**
 * An operator the column's type does not have (`ilike` on a uuid, `cs` on text).
 * Postgres raises 42883 and PostgREST answers it with a 404, hint included.
 */
function errNoOperator(pg: ColumnMeta["pg"], symbol: string): PostgrestError {
  return pgErr("42883", `operator does not exist: ${pgTypeName(pg)} ${symbol} unknown`, 404, null,
    "No operator matches the given name and argument types. You might need to add explicit type casts.");
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

/* ---------------------------------------------------------- select helpers */

/**
 * Split on `sep` at depth 0 only: a select list can carry parens and quoted
 * identifiers. (Filter values have their own grammar below — PostgREST does NOT
 * balance parens there.)
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

/* ------------------------------------------------------- filter grammar ---- */
/*
 * A filter value is NOT decoded the way it looks. Measured against the live
 * project (PostgREST's QueryParams.hs parser), not the docs:
 *
 *  - A top-level value is taken LITERALLY to the end of the parameter:
 *    `status=eq."approved"` compares against the 10 characters `"approved"`.
 *    Only an `in.(…)` list item and a value inside or=/and= may be quoted.
 *  - Inside or=(…) a value ends at the first `,` or `)` — PostgREST does not
 *    balance parentheses. `or=(first_name.ilike.%a)%,last_name.ilike.%a)%)`
 *    is the single filter `first_name ILIKE '%a'`, and whatever follows the
 *    closing `)` is ignored, not an error. The admin class-invite search sends
 *    exactly that shape for a term containing `)`.
 *  - A quote only counts when the closing `"` is followed by `,`, `)` or the
 *    end; a backslash escapes ANY character inside it; `{…}` is kept whole.
 *  - `null` is the four letters n-u-l-l to every operator but `is`: on a uuid
 *    column `eq.null` is a 22P02, on a text column it matches the text "null".
 *  - The operand is then typed by the COLUMN's Postgres input function
 *    (pgInput.ts), which is where 22P02 / 22007 / 22008 come from.
 */

/**
 * Every operator PostgREST's parser knows. A word outside this list is a
 * PGRST100 parse error, as on Supabase; one inside it that D1 cannot answer
 * (full-text search, regular expressions, range adjacency) is refused loudly by
 * name, never answered wrongly.
 */
const PGRST_OPERATORS = [
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "match", "imatch", "is", "isdistinct",
  "in", "cs", "cd", "ov", "sl", "sr", "nxr", "nxl", "adj", "fts", "plfts", "phfts", "wfts",
];
const QUANTIFIABLE = new Set(["eq", "gt", "gte", "lt", "lte", "like", "ilike", "match", "imatch"]);
const FULL_TEXT = new Set(["fts", "plfts", "phfts", "wfts"]);
const IS_VALUES = ["null", "not_null", "true", "false", "unknown"];

const OPERATOR_EXPECTED = "operator (eq, gt, ...)";
const FIELD_EXPECTED = "field name (* or [a..z0..9_$])";
const LOGIC_EXPECTED = "negation operator (not) or logic operator (and, or)";

/**
 * `[not.]<op>[(any|all)].<value>`, read but not yet typed. `list` is set for `in`,
 * `language` for `fts(english)` and its siblings.
 */
type OpExpr = { negate: boolean; op: string; quant?: "any" | "all"; language?: string; value: string; list?: string[] };
/** A filter parsed from the URL, before the registry is consulted. */
type RawFilter = { column: string; jsonPath: boolean; expr: OpExpr };
type RawGroup = { kind: "and" | "or"; negate: boolean; children: RawNode[] };
type RawNode = RawFilter | RawGroup;
/**
 * Where, and against what, a parse failed — the furthest failure wins, like
 * parsec's. `quote` is how parsec prints the unexpected character: `"x"` from a
 * failed match, `'x'` from a failed lookahead (the end-of-item check).
 */
type Failure = { at: number; expecting: string; quote?: "'" };

const isFailure = (x: object): x is Failure => "at" in x;
/** parsec's `spaces` (Haskell isSpace). */
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

/**
 * PostgREST's parse-error body: the parameter value in the message, a 1-based
 * column into the text the parser saw, and what it expected there.
 */
function parseFailure(what: "filter" | "logic tree" | "columns parameter" | "select parameter", shown: string, text: string, f: Failure): PostgrestError {
  const ch = text[f.at];
  const q = f.quote ?? '"';
  const unexpected = ch === undefined ? "end of input" : `${q}${ch}${q}`;
  return pgErr("PGRST100", `"failed to parse ${what} (${shown})" (line 1, column ${f.at + 1})`, 400,
    `unexpected ${unexpected} expecting ${f.expecting}`);
}

/** `"…"` with a backslash escaping any character; null when it never closes. */
function readQuoted(text: string, p: number): { value: string; end: number } | null {
  if (text[p] !== '"') return null;
  let value = "";
  for (let q = p + 1; q < text.length; q++) {
    const c = text[q];
    if (c === "\\") {
      if (q + 1 >= text.length) return null;
      value += text[++q];
      continue;
    }
    if (c === '"') return { value, end: q + 1 };
    value += c;
  }
  return null;
}

/** Everything up to the next `,` or `)`. */
function readBare(text: string, p: number): { value: string; end: number } {
  let q = p;
  while (q < text.length && text[q] !== "," && text[q] !== ")") q++;
  return { value: text.slice(p, q), end: q };
}

const endsItem = (text: string, q: number) => q === text.length || text[q] === "," || text[q] === ")";

/** An `in.(…)` element: quoted only if the quote closes right before `,` / `)`. */
function readListItem(text: string, p: number): { value: string; end: number } {
  const quoted = readQuoted(text, p);
  return quoted && endsItem(text, quoted.end) ? quoted : readBare(text, p);
}

/** A value inside or=(…): quoted, a whole `{…}` array literal, or bare. */
function readTreeValue(text: string, p: number): { value: string; end: number } {
  const quoted = readQuoted(text, p);
  if (quoted && endsItem(text, quoted.end)) return quoted;
  if (text[p] === "{") {
    let q = p + 1;
    while (q < text.length && text[q] !== "{" && text[q] !== "}") q++;
    if (text[q] === "}") return { value: text.slice(p, q + 1), end: q + 1 };
  }
  return readBare(text, p);
}

/**
 * Why `[not.]<op>` failed at `start`, positioned the way PostgREST reports it.
 *
 * Parsec's `string` reports a mismatch at the position it STARTED from, so an
 * operator name only moves the error forward when the whole name is there:
 * `eqx.x` fails after `eq` (column 3), but `foo.x` fails at the `f` (column 1),
 * even though `fts` shares that first letter — both checked live.
 */
function operatorFailure(text: string, start: number, negated: boolean): Failure {
  let at = start;
  for (const op of PGRST_OPERATORS) if (text.startsWith(op, start)) at = Math.max(at, start + op.length);
  if (!negated && text.startsWith("not", start) && start + 3 >= at) return { at: start + 3, expecting: "delimiter (.)" };
  if (at === start) return { at, expecting: negated ? OPERATOR_EXPECTED : `"not" or ${OPERATOR_EXPECTED}` };
  return { at, expecting: OPERATOR_EXPECTED };
}

/**
 * `[not.]<op>[(any|all)].<value>` starting at `pos`. A top-level value runs to
 * the end of the parameter; inside a logic tree it stops at `,` / `)`.
 */
function parseOpExpr(text: string, pos: number, inTree: boolean): { expr: OpExpr; end: number } | Failure {
  let p = pos;
  const negate = text.startsWith("not.", p);
  if (negate) p += 4;
  const name = /^[a-z]+/.exec(text.slice(p))?.[0] ?? "";
  if (!PGRST_OPERATORS.includes(name)) return operatorFailure(text, p, negate);
  let q = p + name.length;
  let quant: "any" | "all" | undefined;
  let language: string | undefined;
  if (text[q] === "(" && QUANTIFIABLE.has(name)) {
    const m = /^\((any|all)\)/.exec(text.slice(q));
    if (!m) return { at: q + 1, expecting: '"all" or "any"' };
    quant = m[1] as "any" | "all";
    q += m[0].length;
  } else if (text[q] === "(" && FULL_TEXT.has(name)) {
    const close = text.indexOf(")", q);          // fts(english)
    if (close < 0) return { at: text.length, expecting: '")"' };
    language = text.slice(q + 1, close);
    q = close + 1;
  }
  if (text[q] !== ".") return operatorFailure(text, p, negate);
  q++;

  if (name === "in") {
    while (isSpace(text[q])) q++;
    if (text[q] !== "(") return { at: q, expecting: '"("' };
    q++;
    while (isSpace(text[q])) q++;
    const list: string[] = [];
    const start = q;
    for (;;) {
      const item = readListItem(text, q);
      list.push(item.value);
      q = item.end;
      if (text[q] === ",") { q++; continue; }
      if (text[q] === ")") { q++; break; }
      return { at: q, expecting: '"," or ")"' };
    }
    return { expr: { negate, op: name, value: text.slice(start, q - 1), list }, end: q };
  }

  if (name === "is") {
    // Case-insensitive keywords; top level ignores what follows, like PostgREST.
    const rest = text.slice(q).toLowerCase();
    const keyword = IS_VALUES.find((k) => rest.startsWith(k));
    if (!keyword) {
      let best = 0;
      for (const k of IS_VALUES) { let n = 0; while (n < k.length && rest[n] === k[n]) n++; best = Math.max(best, n); }
      return { at: q + best, expecting: "isVal: (null, not_null, true, false, unknown)" };
    }
    return { expr: { negate, op: name, value: keyword }, end: q + keyword.length };
  }

  const extras = { ...(quant ? { quant } : {}), ...(language !== undefined ? { language } : {}) };
  if (!inTree) return { expr: { negate, op: name, ...extras, value: text.slice(q) }, end: text.length };
  const v = readTreeValue(text, q);
  return { expr: { negate, op: name, ...extras, value: v.value }, end: v.end };
}

/**
 * A column name inside a logic tree: letters, digits, `_`, `$`, spaces (trimmed)
 * and inner `-`, or a quoted identifier. Returns where it ended.
 */
function readFieldName(text: string, p: number): { name: string; end: number } | null {
  if (text[p] === '"') {
    const quoted = readQuoted(text, p);
    return quoted ? { name: quoted.value, end: quoted.end } : null;
  }
  const nameChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_ $]/u.test(c);
  let q = p;
  while (nameChar(text[q]) || (text[q] === "-" && q > p && text[q + 1] !== ">" && nameChar(text[q + 1]))) q++;
  const name = text.slice(p, q).trim();
  return name ? { name, end: q } : null;
}

/** `<column>[->key…]`: the column, whether an arrow followed it, and where it ended. */
function parseFieldPath(text: string, pos: number): { column: string; jsonPath: boolean; end: number } | Failure {
  const field = readFieldName(text, pos);
  if (!field) return { at: pos, expecting: FIELD_EXPECTED };
  let q = field.end;
  let jsonPath = false;
  while (text.startsWith("->", q)) {
    jsonPath = true;
    q += text.startsWith("->>", q) ? 3 : 2;
    const index = /^-?\d+/.exec(text.slice(q));
    const key = readFieldName(text, q) ?? (index ? { name: "", end: q + index[0].length } : null);
    if (!key) return { at: q, expecting: FIELD_EXPECTED };
    q = key.end;
  }
  return { column: field.name, jsonPath, end: q };
}

/** `<column>[->key…].<op-expr>` inside a logic tree. */
function parseTreeFilter(text: string, pos: number): { node: RawNode; end: number } | Failure {
  let q = pos;
  while (isSpace(text[q])) q++;
  const field = parseFieldPath(text, q);
  if (isFailure(field)) return field;
  q = field.end;
  while (isSpace(text[q])) q++;
  if (text[q] !== ".") return { at: q, expecting: "delimiter (.)" };
  const parsed = parseOpExpr(text, q + 1, true);
  if (isFailure(parsed)) return parsed;
  return { node: { column: field.column, jsonPath: field.jsonPath, expr: parsed.expr }, end: parsed.end };
}

/** `[not.]and(…)` / `[not.]or(…)`. */
function parseTreeGroup(text: string, pos: number): { node: RawNode; end: number } | Failure {
  let q = pos;
  while (isSpace(text[q])) q++;
  const negate = text.startsWith("not.", q);
  if (negate) q += 4;
  let kind: "and" | "or";
  if (text.startsWith("and", q)) { kind = "and"; q += 3; }
  else if (text.startsWith("or", q)) { kind = "or"; q += 2; }
  else return { at: q, expecting: LOGIC_EXPECTED };
  while (isSpace(text[q])) q++;
  if (text[q] !== "(") return { at: q, expecting: '"("' };
  q++;
  const children: RawNode[] = [];
  for (;;) {
    while (isSpace(text[q])) q++;
    const child = parseTree(text, q);
    if (isFailure(child)) return child;
    children.push(child.node);
    q = child.end;
    while (isSpace(text[q])) q++;
    if (text[q] === ",") { q++; continue; }
    if (text[q] === ")") { q++; break; }
    return { at: q, expecting: '"," or ")"' };
  }
  while (isSpace(text[q])) q++;
  return { node: { kind, negate, children }, end: q };
}

/**
 * One logic-tree item: a filter is tried first and a group second, and when
 * both fail the one that got further is reported (a tie means an empty item,
 * where PostgREST lists both expectations).
 */
function parseTree(text: string, pos: number): { node: RawNode; end: number } | Failure {
  const filter = parseTreeFilter(text, pos);
  if (!isFailure(filter)) return filter;
  const group = parseTreeGroup(text, pos);
  if (!isFailure(group)) return group;
  if (filter.at !== group.at) return filter.at > group.at ? filter : group;
  return { at: filter.at, expecting: `${FIELD_EXPECTED}, ${LOGIC_EXPECTED}` };
}

/**
 * `columns="title","description"` → the column names. An item is a quoted
 * identifier or a bare field name, as inside a logic tree; a repeated name
 * counts once, since PostgREST keeps the columns as a set.
 */
function parseColumns(raw: string): string[] | PostgrestError {
  const names: string[] = [];
  let p = 0;
  for (;;) {
    while (isSpace(raw[p])) p++;
    const field = readFieldName(raw, p);
    if (!field) return parseFailure("columns parameter", raw, raw, { at: p, expecting: FIELD_EXPECTED });
    if (!names.includes(field.name)) names.push(field.name);
    p = field.end;
    while (isSpace(raw[p])) p++;
    if (p === raw.length) return names;
    if (raw[p] !== ",") return parseFailure("columns parameter", raw, raw, { at: p, expecting: '","' });
    p++;
  }
}

/* ------------------------------------------------------ filter semantics --- */

/**
 * A parsed filter → a Condition, checked the way Postgres checks it once the
 * query reaches the database: the column must exist (42703), the operator must
 * exist for its type (42883 / 42725 / 42804), and the operand must be valid
 * input for that type (22P02 / 22007 / 22008 / 22009) — then it is handed on in
 * the spelling the copy stores.
 */
function resolveFilter(table: string, registry: Registry, f: RawFilter): Condition | PostgrestError {
  const col = own(registry[table].columns, f.column);
  if (!col) return errNoColumn(table, f.column);
  const { negate, op, quant, value, list } = f.expr;
  const leaf = { kind: "cmp" as const, column: f.column, ...(negate ? { negate: true } : {}) };

  if (f.jsonPath) {
    // PostgREST answers `col->key` / `col->>key` filters (via to_jsonb for a
    // non-json column). Reporting them as 42703 — what this used to do — is the
    // one wrong answer that is actively harmful: 42703 is how this codebase
    // recognises "migration not run", so a JSON filter would be swallowed by a
    // fail-open branch. A partial emulation would diverge silently on number
    // and object rendering; refuse by name until one is really needed.
    return errUnsupported(`json path filter on '${f.column}' is not implemented`);
  }

  const typed = (raw: string) => inputValue(raw, col.pg);

  switch (op) {
    case "in": {
      // PostgREST turns a single empty element into `= ANY('{}')`: `in.()` and
      // `in.("")` match nothing, and neither is typed (no 22P02 on a uuid).
      const items = list!.length === 1 && list![0] === "" ? [] : list!;
      const values: unknown[] = [];
      for (const item of items) {
        const r = typed(item);
        if (isInputError(r)) return r.error;
        values.push(r.value);
      }
      return { ...leaf, op: "in", value: values };
    }

    case "is": {
      if (value === "null" || value === "not_null") {
        const flipped = negate !== (value === "not_null");
        return { kind: "cmp", column: f.column, op: "is", value: null, ...(flipped ? { negate: true } : {}) };
      }
      if (col.pg !== "boolean") {
        return pgErr("42804", `argument of IS ${value.toUpperCase()} must be type boolean, not type ${pgTypeName(col.pg)}`, 400);
      }
      // For a boolean, IS UNKNOWN is exactly IS NULL.
      return { ...leaf, op: "is", value: value === "unknown" ? null : value === "true" };
    }

    case "like":
    case "ilike":
    case "match":
    case "imatch": {
      const symbol = { like: "~~", ilike: "~~*", match: "~", imatch: "~*" }[op];
      if (col.pg !== "text") return errNoOperator(col.pg, symbol);
      if (op === "match" || op === "imatch") return errUnsupported(`operator '${op}' is not implemented (filter ${f.column}=${op}.${value})`);
      // PostgREST maps `*` to `%` over the whole operand, quoted or not — before
      // a quantified operand is even read as an array.
      const pattern = value.replace(/\*/g, "%");
      if (!quant) return { ...leaf, op, value: pattern };
      const patterns = arrayIn(pattern, (t) => ({ value: t }));
      if (isInputError(patterns)) return patterns.error;
      return { ...leaf, op, quant, value: patterns.value };
    }

    case "cs":
    case "cd":
    case "ov": {
      if (col.pg === "text[]" || col.pg === "uuid[]") {
        const r = typed(value);
        if (isInputError(r)) return r.error;
        return { ...leaf, op, value: r.value };
      }
      if (col.pg === "jsonb" && op !== "ov") {
        // jsonb `@>` / `<@` is recursive key/value containment, not the element
        // test the array operators use; answering it with the array SQL returned
        // no rows where Postgres returns them. Nothing here filters jsonb that way.
        return errUnsupported(`jsonb containment '${op}' is not implemented (filter ${f.column}=${op}.${value})`);
      }
      if (op === "cd") {
        return pgErr("42725", `operator is not unique: ${pgTypeName(col.pg)} <@ unknown`, 400, null,
          "Could not choose a best candidate operator. You might need to add explicit type casts.");
      }
      return errNoOperator(col.pg, op === "cs" ? "@>" : "&&");
    }

    case "sl": case "sr": case "nxr": case "nxl": case "adj": {
      // Range operators, and no column here is a range: Postgres answers "operator
      // does not exist" for every type (checked live against all eleven), except
      // `<<` / `>>` on an integer, which resolve to the bit shift and then fail as
      // a non-boolean condition with wording that depends on where in the tree the
      // filter sits ("argument of WHERE / AND / NOT…") — that one is refused by name.
      if ((op === "sl" || op === "sr") && (col.pg === "integer" || col.pg === "bigint")) {
        return errUnsupported(`operator '${op}' on ${col.pg} is not implemented (filter ${f.column}=${op}.${value})`);
      }
      return errNoOperator(col.pg, { sl: "<<", sr: ">>", nxr: "&<", nxl: "&>", adj: "-|-" }[op]);
    }

    case "fts": case "plfts": case "phfts": case "wfts": {
      // Full-text search needs Postgres' dictionaries and stemming; nothing here
      // uses it, so on text and jsonb (where to_tsvector exists) it is refused by
      // name. On every other type Postgres cannot even find to_tsvector — that
      // answer needs no engine, so it is given exactly (checked live).
      if (col.pg === "text" || col.pg === "jsonb") {
        return errUnsupported(`operator '${op}' is not implemented (filter ${f.column}=${op}.${value})`);
      }
      const args = f.expr.language !== undefined ? `unknown, ${pgTypeName(col.pg)}` : pgTypeName(col.pg);
      return pgErr("42883", `function to_tsvector(${args}) does not exist`, 404, null,
        "No function matches the given name and argument types. You might need to add explicit type casts.");
    }

    default: {
      // eq neq gt gte lt lte isdistinct — optionally (any) / (all).
      if (quant) {
        if (col.pg === "text[]" || col.pg === "uuid[]") return pgErr("42704", `could not find array type for data type ${pgTypeName(col.pg)}`, 400);
        if (col.pg === "jsonb") return errUnsupported(`quantified operator '${op}(${quant})' on jsonb is not implemented`);
        const items = arrayIn(value, typed);
        if (isInputError(items)) return items.error;
        // `= ANY(list)` is `IN (list)` exactly, NULL elements and the empty list included.
        if (op === "eq" && quant === "any") return { ...leaf, op: "in", value: items.value };
        return { ...leaf, op: op as FilterOp, quant, value: items.value };
      }
      const r = typed(value);
      if (isInputError(r)) return r.error;
      return { ...leaf, op: op as FilterOp, value: r.value };
    }
  }
}

function resolveNode(table: string, registry: Registry, node: RawNode): Where | PostgrestError {
  if (!("children" in node)) return resolveFilter(table, registry, node);
  const children: Where[] = [];
  for (const child of node.children) {
    const w = resolveNode(table, registry, child);
    if ("code" in w) return w;
    children.push(w);
  }
  return { kind: node.kind, children, ...(node.negate ? { negate: true } : {}) };
}

/* --------------------------------------------------------------- select ---- */

/*
 * A select item is `[alias:]field[->key|->>key|->n …]`, or `*` (QueryParams.hs
 * pFieldSelect, pJsonPath). The arrow path used to be collapsed into one string
 * with `->>` read as `->` — which answered the TEXT operator with parsed JSON —
 * and named after its literal last segment, so `cv_draft->langs->0` came back
 * under `0`. It is read here step by step, as PostgREST reads it:
 *
 *  - an operand is an index when it is `-?digits` followed by the next arrow, a
 *    cast, an aggregate or the end; otherwise it is a key — a quoted string, or
 *    any run of characters but `(-:.,>)` (inner dashes joined, ends trimmed);
 *  - `*` may sit among other items (`*,x:cv_draft->langs`): every column, plus
 *    the rest. Collapsing the list to `*` dropped `x`.
 */

/** A select item as written, before the registry is consulted. */
type RawJsonOp = { arrow: "->" | "->>"; key: string } | { arrow: "->" | "->>"; indexText: string };
type RawSelectItem =
  | { star: true }
  | { column: string; alias?: string; ops: RawJsonOp[]; unsupported?: string };

const SELECT_ITEM_EXPECTED = '"...", field name (* or [a..z0..9_$]), "*" or "count()"';
const JSON_OPERAND_EXPECTED = '"-", digit or any non reserved character different from: .,>()';
const ITEM_END_EXPECTED = '"->>", "->", "::", ".", ")", "," or end of input';
const NO_OPERATOR_HINT = "No operator matches the given name and argument types. You might need to add explicit type casts.";
// Constructed, not written as literals: the tree compiles below ES2020.
const INT4_MIN = BigInt(-2147483648);
const INT4_MAX = BigInt(2147483647);

/** postgrest-js keeps double quotes around identifiers that need them; the registry stores the bare name. */
const unquoteIdent = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

/** One item spanning text[from, to). Positions stay absolute, so an error's column is the parameter's. */
function parseSelectItem(text: string, from: number, to: number): RawSelectItem | Failure {
  let p = from;
  while (p < to && isSpace(text[p])) p++;
  let end = to;
  while (end > p && isSpace(text[end - 1])) end--;
  if (p === end) return { at: p, expecting: SELECT_ITEM_EXPECTED };
  if (text.slice(p, end) === "*") return { star: true };

  // `alias:` — one colon (two are a cast), before any arrow.
  const arrowAt = text.indexOf("->", p);
  const head = text.slice(p, arrowAt >= p && arrowAt < end ? arrowAt : end);
  const colon = head.search(/(?<!:):(?!:)/);
  let alias: string | undefined;
  if (colon > 0) {
    alias = unquoteIdent(head.slice(0, colon).trim());
    p += colon + 1;
    while (p < end && isSpace(text[p])) p++;
  }

  // The field: a quoted identifier, or everything up to an arrow, a cast, an aggregate or a paren.
  let q = p;
  let column: string;
  const quoted = text[q] === '"' ? readQuoted(text.slice(0, end), q) : null;
  if (quoted) {
    column = quoted.value;
    q = quoted.end;
  } else {
    while (q < end && !text.startsWith("->", q) && !text.startsWith("::", q) && text[q] !== "." && text[q] !== "(") q++;
    column = unquoteIdent(text.slice(p, q).trim());
  }

  const ops: RawJsonOp[] = [];
  while (q < end && text.startsWith("->", q)) {
    const arrow = text.startsWith("->>", q) ? "->>" : "->";
    q += arrow.length;
    const index = /^(-?)(\d+)/.exec(text.slice(q, end));
    if (index) {
      const after = q + index[0].length;
      if (after === end || text.startsWith("->", after) || text.startsWith("::", after) || text[after] === ".") {
        // PostgREST keeps the sign it read (`+` when there was none): Postgres
        // quotes exactly that text when the cast to int overflows.
        ops.push({ arrow, indexText: `${index[1] || "+"}${index[2]}` });
        q = after;
        continue;
      }
    }
    // A key can't start with `-`, so the index parse that failed after it is the
    // furthest failure (live: `value->-x` is `unexpected "x" expecting digit`).
    if (text[q] === "-" && !index) return { at: q + 1, expecting: "digit" };
    if (text[q] === '"') {
      const key = readQuoted(text.slice(0, end), q);
      if (!key) return { at: end, expecting: '"\\""' };
      ops.push({ arrow, key: key.value });
      q = key.end;
      continue;
    }
    const segments: string[] = [];
    for (;;) {
      const start = q;
      while (q < end && !"(-:.,>)".includes(text[q])) q++;
      if (q === start) return { at: q, expecting: JSON_OPERAND_EXPECTED };
      segments.push(text.slice(start, q).trim());
      if (text[q] === "-" && text[q + 1] !== ">") { q++; continue; }
      break;
    }
    ops.push({ arrow, key: segments.join("-") });
  }

  // What is left: a paren, a cast or an aggregate (all refused by name once the
  // request is known to be valid), or nothing at all.
  const written = text.slice(from, to).trim();
  let unsupported: string | undefined;
  if (text[q] === "(") unsupported = `embedded resource '${written}' is not implemented`;
  else if (text.startsWith("::", q)) unsupported = `cast '${written}' is not implemented`;
  else if (text[q] === ".") unsupported = `aggregate '${written}' is not implemented`;
  else if (q < end) return { at: q, expecting: ITEM_END_EXPECTED, quote: "'" };
  return { column, ...(alias !== undefined ? { alias } : {}), ops, ...(unsupported ? { unsupported } : {}) };
}

/** `?select=` → its items, syntax only: PostgREST reports a malformed select before it looks for the table. */
function parseSelectSyntax(raw: string): RawSelectItem[] | PostgrestError {
  if (raw.trim() === "") return [];
  const items: RawSelectItem[] = [];
  let from = 0;
  for (const piece of splitTop(raw, ",")) {
    const item = parseSelectItem(raw, from, from + piece.length);
    if (isFailure(item)) return parseFailure("select parameter", raw, raw, item);
    items.push(item);
    from += piece.length + 1;
  }
  return items;
}

/**
 * The items against the table, left to right as Postgres analyses a target
 * list: the column must exist (42703), and each arrow must be an operator
 * Postgres has. After `->>` the value is text, and `text -> …` does not exist
 * (42883, which PostgREST answers with a 404); an index is cast to int, so one
 * past int4 is a 22003 quoting the digits. The missing operator is found first
 * (live: `->>0->2147483648` is the 42883).
 */
function resolveSelect(items: RawSelectItem[], table: string, registry: Registry): SelectItem[] | "*" | PostgrestError {
  if (items.length === 0 || (items.length === 1 && "star" in items[0])) return "*";
  const out: SelectItem[] = [];
  for (const item of items) {
    if ("star" in item) { out.push({ column: "*" }); continue; }
    if (item.unsupported) return errUnsupported(item.unsupported);
    if (!own(registry[table].columns, item.column)) return errNoColumn(table, item.column);
    const ops: JsonOp[] = [];
    for (let i = 0; i < item.ops.length; i++) {
      const op = item.ops[i];
      if (i > 0 && item.ops[i - 1].arrow === "->>") {
        return pgErr("42883", `operator does not exist: text ${op.arrow} ${"key" in op ? "unknown" : "integer"}`, 404, null, NO_OPERATOR_HINT);
      }
      if ("key" in op) { ops.push({ arrow: op.arrow, key: op.key }); continue; }
      const n = BigInt(op.indexText);
      if (n < INT4_MIN || n > INT4_MAX) return pgErr("22003", `value "${op.indexText}" is out of range for type integer`, 400);
      ops.push({ arrow: op.arrow, index: Number(n) });
    }
    out.push({ column: item.column, ...(item.alias !== undefined ? { alias: item.alias } : {}), ...(ops.length ? { jsonPath: ops } : {}) });
  }
  return out;
}

/* ---------------------------------------------------------------- order ---- */

/** `order=created_at.desc.nullslast,id.asc` → OrderBy[], syntax only (the columns are checked later). */
function parseOrder(raw: string): OrderBy[] | PostgrestError {
  const out: OrderBy[] = [];
  for (const piece of raw.split(",")) {
    const part = piece.trim();
    if (part === "") continue;
    const [column, ...mods] = part.split(".");

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

/**
 * Every value of `name` in the query string, in order. URLSearchParams alone
 * can't say this: it reads a bare `limit` as `limit=`, and PostgREST tells them
 * apart — a key with no `=` has no value and is skipped (live: `limit=2&limit`
 * is 2 rows), while `limit=` is a value it cannot read.
 */
function rawValues(url: URL, name: string): string[] {
  const out: string[] = [];
  for (const piece of url.search.slice(1).split("&")) {
    if (!piece.includes("=")) continue;
    for (const [key, value] of new URLSearchParams(piece)) if (key === name) out.push(value);
  }
  return out;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
/** A window bound as the number the SQL binds; past 2^53 no table has the rows, so the clamp changes no answer. */
const toSafeNumber = (n: bigint) => (n > MAX_SAFE ? Number.MAX_SAFE_INTEGER : Number(n));

/* ----------------------------------------------------------------- main ---- */

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const LOGIC_PARAMS = new Set(["or", "and", "not.or", "not.and"]);

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

  /* the request, in the order Supabase fails */
  // Which of two problems a request reports depends on the stage that finds it
  // (all measured live). First the SYNTAX, in PostgREST's own order — order,
  // logic trees, select, filters (QueryParams.hs parse). Then the range:
  // `nosuchtable?limit=-1` is a 416, not a 404. Then the table (PGRST205). Only
  // then what Postgres analyses: the select list's columns and arrows, each
  // filter's column and operand in turn, and the order's columns.
  const rawOrder = url.searchParams.get("order");
  const orderSyntax = rawOrder === null ? [] : parseOrder(rawOrder);
  const selectSyntax = parseSelectSyntax(url.searchParams.get("select") ?? "*");

  // Filters keep their parameter order for resolution; a syntax error is held
  // back only so that a logic tree's can win over a plain filter's.
  const rawFilters: RawNode[] = [];
  let logicError: PostgrestError | null = null;
  let filterError: PostgrestError | null = null;
  for (const [key, raw] of url.searchParams) {
    if (RESERVED_PARAMS.has(key)) continue;
    if (LOGIC_PARAMS.has(key)) {
      // PostgREST glues the name in front (`or(…)`) and parses that; text after
      // the group's closing `)` is ignored, not rejected.
      const text = key + raw;
      const tree = parseTree(text, 0);
      if (isFailure(tree)) logicError ??= parseFailure("logic tree", raw, text, tree);
      else rawFilters.push(tree.node);
      continue;
    }
    // `instruments.order=…` / `instruments.limit=…` only exist for embedded
    // resources, which we don't support — better a 400 than silently ignoring them.
    if (key.includes(".")) { filterError ??= errUnsupported(`referenced-table parameter '${key}' is not implemented`); continue; }
    const expr = parseOpExpr(raw, 0, false);
    if (isFailure(expr)) { filterError ??= parseFailure("filter", raw, raw, expr); continue; }
    // The key is read with the same field grammar as a tree item, and whatever
    // follows the name is ignored: live, `file_type- >x=eq.a` is a 42703 for the
    // column `file_type-`. A key that is no field name at all stays whole, so it
    // still comes back as the column that does not exist.
    const field = parseFieldPath(key, 0);
    rawFilters.push(isFailure(field)
      ? { column: key, jsonPath: false, expr: expr.expr }
      : { column: field.column, jsonPath: field.jsonPath, expr: expr.expr });
  }
  if (!Array.isArray(orderSyntax)) return orderSyntax;
  if (logicError) return logicError;
  if (!Array.isArray(selectSyntax)) return selectSyntax;
  if (filterError) return filterError;

  // `limit=` / `offset=` / `Range:` → PostgREST's window, or its PGRST103 (range.ts).
  // postgrest-js sends .range() as offset+limit; the header is read on GET only.
  const window = resolveRange({
    limits: rawValues(url, "limit"),
    offsets: rawValues(url, "offset"),
    header: method === "GET" ? headerOf(parts.headers, "Range") : null,
  });
  if ("code" in window) return window;

  if (!table || !own(registry, table)) return errNoTable(table);

  const select = resolveSelect(selectSyntax, table, registry);
  if (typeof select === "object" && !Array.isArray(select)) return select;

  const where: Where[] = [];
  for (const node of rawFilters) {
    const resolved = resolveNode(table, registry, node);
    if ("code" in resolved) return resolved;
    where.push(resolved);
  }

  for (const o of orderSyntax) if (!own(registry[table].columns, o.column)) return errNoColumn(table, o.column);
  const order = orderSyntax;

  // A window that pages nothing (no limit, offset 0, no Range) leaves both unset.
  let limit: number | undefined;
  let offset: number | undefined;
  let offsetText: string | undefined;
  if (!window.all) {
    if (window.limit !== null) limit = toSafeNumber(window.limit);
    if (window.offset > BigInt(0)) {
      offset = toSafeNumber(window.offset);
      if (window.offset > MAX_SAFE) offsetText = window.offset.toString();
    }
  }

  const intent: QueryIntent = {
    action, table, select, where, order,
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    ...(offsetText === undefined ? {} : { offsetText }),
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
    // `columns=` changes how PostgREST reads the body (ApiRequest/Payload.hs
    // getPayload): the rows are taken as they are — no columns derived from
    // their keys, no "All object keys must match" — and only the listed columns
    // are written. A key outside the list is ignored rather than refused, and a
    // listed column the table lacks is the PGRST204 a body key would have been.
    const rawColumns = url.searchParams.get("columns");
    let columns: string[] | undefined;
    if (rawColumns !== null && rawColumns.trim() !== "") {
      const parsed = parseColumns(rawColumns);
      if (!Array.isArray(parsed)) return parsed;
      columns = parsed;
    }
    for (const row of rows) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        return pgErr("PGRST102", "Empty or invalid json", 400, "expected an object or an array of objects");
      }
      if (columns) continue;
      for (const key of Object.keys(row)) {
        if (!own(registry[table].columns, key)) return errNoBodyColumn(table, key);
      }
    }
    for (const c of columns ?? []) if (!own(registry[table].columns, c)) return errNoBodyColumn(table, c);
    intent.values = rows as Record<string, unknown>[];
    if (columns) intent.columns = columns;
    if (method === "POST" && /missing=default/.test(prefer)) intent.missingDefault = true;
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
