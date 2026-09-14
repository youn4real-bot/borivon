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
 *  3. LIKE case-folds ASCII only. That is not Postgres' `like`, which is
 *     case-sensitive (emitted as GLOB, see likePatternToGlob), and only half of
 *     its `ilike`, which folds every Unicode letter (see ilikeFold).
 *  4. Every value is TEXT/INTEGER/REAL. Timestamps are ISO strings compared
 *     lexicographically, arrays/jsonb are JSON text, booleans are 0/1 — so a
 *     filter parameter has to be encoded exactly the way d1/export-data.mjs
 *     wrote the row, or `.eq()` silently misses. That codec is decode.ts's
 *     encodeValue(); encodeParam() below only re-spells timestamps for it. And
 *     since SQLite checks no types at all, a WRITTEN value is first read by the
 *     column's Postgres input function (pgInput.ts writeInput) — which is what
 *     refuses a `29.05.2004` date the way Supabase does.
 *
 * Two D1 limits shape the SQL. A statement may bind at most 100 parameters, so an
 * `in` list and a bulk write each travel as one JSON array (the `in` case,
 * buildInsert), and a filter still past the limit has its operands packed
 * (fitParams). An expression may nest at most 100 levels, so a long AND/OR chain
 * is halved (joinLogic).
 *
 * Out of scope on purpose (measured against the real codebase): embedded
 * joins, !inner, text search, csv, explain, aggregates, rpc.
 */

import type {
  BuiltQuery, ColumnMeta, Condition, FilterOp, Group, OrderBy, PgType,
  PostgrestError, QueryIntent, Registry, SelectItem, TableMeta, Where,
} from "./types";
// decode.ts owns the value codec and the output-key rule for both directions.
// Re-deriving either here would be a second copy of a rule that has to agree
// byte-for-byte with the rows d1/export-data.mjs already wrote — and a
// disagreement is invisible: the filter simply stops matching. Both imports are
// pure functions; nothing else of decode.ts is used.
import { encodeValue, selectOutputKey } from "./decode";
// The write half of Postgres' type checking: what a column's input function makes
// of a payload value, or the 22P02 / 22007 / 22008 it refuses it with.
import { isInputError, writeInput } from "./pgInput";

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
 * A value that is ALREADY UTC keeps its fraction digits exactly, deliberately:
 * the copy holds two fraction widths — imported rows are Postgres-trimmed
 * (`.155+00:00`) while rows written by a D1 column DEFAULT are 6-digit
 * (`.155000+00:00`) — and re-rendering either one would stop it matching the
 * other. lib/reminderFire.ts:82 does exactly that round trip
 * (`.eq("due_at", r.due_at)`). Only the SPELLING of UTC is repaired around
 * those digits: a space for the `T` (`2026-09-12 06:28:29+00:00` sorted below
 * its own row, so `.eq` missed and `.gte` over-matched), psql's `+00`, `-00:00`.
 */
export function normalizeTimestamp(value: string): string {
  const trimmed = value.trim();
  const m = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/.exec(trimmed);
  if (!m) return value;                       // date-only, or not a timestamp — leave it exactly as given
  const [, date, time, frac = "", off] = m;
  const hms = time.length === 5 ? `${time}:00` : time;     // Postgres always prints seconds
  if (off === "Z" || off === "z" || /^[+-]00(:?00)?$/.test(off ?? "")) {
    // `Z` stays `Z` (encodeValue trims its fraction the way PostgREST prints a
    // JS toISOString); a numeric zero offset becomes the stored `+00:00`.
    return `${date}T${hms}${frac}${off === "Z" || off === "z" ? "Z" : "+00:00"}`;
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

/**
 * Non-ASCII lowercase letters that are ALSO the lowercase of something other
 * than their own uppercase form (which upperFormsOf finds by itself): the
 * Å / Ω / ϴ signs, ẞ, the titlecase digraphs and the Greek capitals with
 * prosgegrammeni. Derived by scanning U+0080–U+10FFFF with
 * String.prototype.toLowerCase, so it is complete for the Unicode tables V8
 * ships — the scan itself costs ~35 ms, too much to repeat in a Worker.
 */
const EXTRA_UPPER_FORMS: Record<number, number[]> = (() => {
  const table: Record<number, number[]> = {
    0xdf: [0x1e9e], 0xe5: [0x212b], 0x1c6: [0x1c5], 0x1c9: [0x1c8], 0x1cc: [0x1cb], 0x1f3: [0x1f2],
    0x3b8: [0x3f4], 0x3c9: [0x2126], 0x1fb3: [0x1fbc], 0x1fc3: [0x1fcc], 0x1ff3: [0x1ffc],
  };
  for (const base of [0x1f80, 0x1f90, 0x1fa0]) for (let i = 0; i < 8; i++) table[base + i] = [base + 8 + i];
  return table;
})();

const singleCodePoint = (s: string): number | null => {
  const cps = Array.from(s);
  return cps.length === 1 ? cps[0].codePointAt(0)! : null;
};

/** Postgres' lower() maps one character to one character; `İ` → `i̇` (two) is left alone. */
const lowerOf = (cp: number): number => singleCodePoint(String.fromCodePoint(cp).toLowerCase()) ?? cp;

/** Every character whose lowercase is `lower`, other than `lower` itself. */
function upperFormsOf(lower: number): number[] {
  const forms: number[] = [];
  const upper = singleCodePoint(String.fromCodePoint(lower).toUpperCase());
  if (upper !== null && upper !== lower && lowerOf(upper) === lower) forms.push(upper);
  for (const extra of EXTRA_UPPER_FORMS[lower] ?? []) if (!forms.includes(extra)) forms.push(extra);
  return forms;
}

/** Each fold nests one replace(); past this a statement risks D1's expression-depth limit. */
const MAX_ILIKE_FOLDS = 40;

/**
 * Postgres' ILIKE lowercases BOTH sides with lower() before matching — every
 * Unicode letter, one character at a time (like.c Generic_Text_IC_like).
 * SQLite's LIKE folds ASCII only, so `ilike.%NOTENÜBERSICHT%` matched 45
 * documents on Supabase and none here, and any German or French search typed
 * in the other case came back silently empty (the bot's searchMessages, the
 * class-invite name search).
 *
 * The pattern is lowercased here. The column cannot be — SQLite's lower() is
 * ASCII-only too — so for each non-ASCII letter the pattern contains, the
 * column's uppercase forms of that letter are replace()d with it first. A letter
 * the pattern does not contain can only ever meet a wildcard, where case does
 * not matter, so nothing else needs folding; ASCII stays with LIKE's own fold.
 *
 * Not GLOB with `[üÜ]` classes: D1 refuses any LIKE/GLOB pattern over 50 bytes
 * (see D1_MAX_PATTERN_BYTES) and a class per letter would triple the length;
 * this keeps the pattern exactly as long as the caller's.
 *
 * Only one-to-one mappings count, as in Postgres: `ß` never matches `SS`. The
 * single fold INTO ASCII (U+212A KELVIN SIGN → k) is deliberately left out: it
 * would add a replace() to every e-mail lookup for a character no row holds.
 *
 * Returns null when the pattern needs more folds than a statement can nest.
 */
export function ilikeFold(ref: string, pattern: string): { column: string; pattern: string } | null {
  let lowered = "";
  const letters: number[] = [];
  for (const ch of pattern) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) { lowered += ch; continue; }
    const lower = lowerOf(cp);
    lowered += String.fromCodePoint(lower);
    if (lower >= 0x80 && !letters.includes(lower)) letters.push(lower);
  }
  let column = ref;
  let folds = 0;
  for (const lower of letters) {
    for (const upper of upperFormsOf(lower)) {
      if (++folds > MAX_ILIKE_FOLDS) return null;
      // Code points, not caller text: safe to write into the SQL.
      column = `replace(${column}, char(${upper}), char(${lower}))`;
    }
  }
  return { column, pattern: lowered };
}

/* ── LIKE patterns D1 cannot run ─────────────────────────────────────────── */

/**
 * D1 refuses any LIKE or GLOB pattern longer than 50 BYTES with "LIKE or GLOB
 * pattern too complex" — SQLite's LIKE_PATTERN_LENGTH limit, lowered on D1 and
 * not adjustable per query. Measured on the real database: 25 × `ü` (50 bytes)
 * runs, while 26 × `ü` (52 bytes) and 49 ASCII letters + `ü` (51 bytes) fail,
 * for LIKE and GLOB alike and whatever the text is. Postgres has no such limit,
 * and the portal reaches it: the notification → document resolver
 * (app/api/portal/admin/notifications/[id]/doc/route.ts) searches
 * `%Certificat d'exercice de la profession infirmière%` — 53 bytes, 4 rows on
 * Supabase and a 500 here — and lib/admin-auth's ciEmail() of any address past
 * ~48 bytes would have locked that sub-admin out.
 */
export const D1_MAX_PATTERN_BYTES = 50;

/** UTF-8 length, the unit D1's limit counts in (a lone surrogate binds as U+FFFD, 3 bytes). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** One `%`-free stretch of a LIKE pattern: its literal runs, each at a character offset. */
export type LikeSegment = { literals: { text: string; offset: number; length: number }[]; length: number };

/**
 * A Postgres LIKE pattern split at its `%` wildcards, escapes resolved the way
 * like_match.c resolves them: a backslash makes ANY following character literal,
 * `_` is one character, and a run of `%` is one `%`. Lengths are in characters,
 * which is what both Postgres' matcher and SQLite's substr()/length() count.
 *
 * null for a pattern that ends in a lone backslash. Postgres can never match
 * one: it either raises 22025 "LIKE pattern must not end with escape character"
 * or answers false, and WHICH depends on the plan — its matcher only raises once
 * it reaches the backslash with text left over, and an index on the column turns
 * an exact-prefix pattern into an index condition that never runs the matcher at
 * all. Measured live: `documents.file_type` (indexed) answers `like.Noten\` with
 * 200 [] and `ilike.noten\` with 22025, `candidate_profiles.first_name`
 * (unindexed) raises on `like.A\`. Neither answer can be predicted from the
 * request, so the pattern is treated as the non-match it always is.
 */
export function likeSegments(pattern: string): LikeSegment[] | null {
  const chars = Array.from(pattern);
  const segments: LikeSegment[] = [];
  let segment: LikeSegment = { literals: [], length: 0 };
  let run = "";
  let runStart = 0;
  let runLength = 0;
  const flush = () => {
    if (runLength) segment.literals.push({ text: run, offset: runStart, length: runLength });
    run = "";
    runLength = 0;
  };
  for (let i = 0; i < chars.length; i++) {
    let c = chars[i];
    if (c === "%") {
      flush();
      segments.push(segment);
      segment = { literals: [], length: 0 };
      while (chars[i + 1] === "%") i++;
      continue;
    }
    if (c === "_") { flush(); segment.length++; continue; }
    if (c === "\\") {
      if (i + 1 >= chars.length) return null;
      c = chars[++i];
    }
    if (!runLength) runStart = segment.length;
    run += c;
    runLength++;
    segment.length++;
  }
  flush();
  segments.push(segment);
  return segments;
}

/** SQL text travelling with its bound values, so nesting fragments can never reorder the params. */
type Fragment = { sql: string; params: unknown[] };

/**
 * Tagged template for Fragments. A Fragment part is spliced in with its params;
 * a string or number part is written into the SQL verbatim, so it may only ever
 * be a column reference, an alias or a count this module computed — never caller
 * text, which goes through bind().
 */
function sql(strings: TemplateStringsArray, ...parts: (Fragment | string | number)[]): Fragment {
  let text = strings[0];
  const params: unknown[] = [];
  parts.forEach((part, i) => {
    if (typeof part === "object") { text += part.sql; params.push(...part.params); }
    else text += String(part);
    text += strings[i + 1];
  });
  return { sql: text, params };
}
const bind = (value: unknown): Fragment => ({ sql: "?", params: [value] });
const joinFragments = (list: Fragment[], separator: string): Fragment =>
  ({ sql: list.map((f) => f.sql).join(separator), params: list.flatMap((f) => f.params) });

/**
 * Each middle segment nests one more correlated subquery, and SQLite adds up the
 * expression heights of every enclosing level while it resolves them, against
 * D1's limit of 100 ("Expression tree is too large"). Measured on the real
 * database: 6 middle segments run — even with 40 folded letters, `_` segments
 * and the filter three negated groups deep — and 7 fail, whatever the pattern.
 */
const MAX_LIKE_MIDDLE_SEGMENTS = 6;

/**
 * A LIKE match with no LIKE in it, for patterns D1 would refuse: `subject` (the
 * column, already case-folded for ilike) is taken apart with substr() and
 * instr(), which have no length limit.
 *
 * The first segment must sit at the start, the last at the end, and each middle
 * segment is placed at its LEFTMOST fit after the one before. Every segment has
 * a fixed length (a literal or `_` is one character), so the leftmost placement
 * always leaves the most room for what follows — no backtracking is ever needed,
 * which is the same argument Postgres' matcher relies on when it gives up early.
 *
 * A middle segment with one literal is found with instr(); one with several
 * literals separated by `_` can only be found by trying positions, which a
 * recursive CTE does. The column is bound once, in a FROM-subquery, so a long
 * fold chain is not repeated per comparison and does not count towards the
 * depth of the expression around it. NULL stays NULL, as for LIKE.
 */
function substrLikeSql(subject: string, segments: LikeSegment[]): Fragment {
  const V = `"like$v"`;
  const n = `length(${V})`;
  const last = segments.length - 1;
  const at = (start: string, segment: LikeSegment): Fragment[] =>
    segment.literals.map((lit) => sql`substr(${V}, ${start} + ${lit.offset}, ${lit.length}) = ${bind(lit.text)}`);

  const conditions: Fragment[] = [];
  if (last === 0) {
    conditions.push(sql`${n} = ${segments[0].length}`, ...at("1", segments[0]));
  } else {
    const shortest = segments.reduce((sum, s) => sum + s.length, 0);
    conditions.push(sql`${n} >= ${shortest}`, ...at("1", segments[0]), ...at(`${n} - ${segments[last].length - 1}`, segments[last]));
    const middle = segments.slice(1, last);
    if (middle.length) {
      const end = `${n} - ${segments[last].length}`;          // last character a middle segment may use
      const place = (i: number, cursor: string): Fragment => {
        if (i === middle.length) return sql`1`;
        const segment = middle[i];
        const fits = (p: string) => `${p} + ${segment.length - 1} <= ${end}`;
        const P = `"like$p${i}"`;
        let leftmost: Fragment;
        if (segment.literals.length === 0) {
          leftmost = sql`CASE WHEN ${fits(cursor)} THEN ${cursor} END`;
        } else if (segment.literals.length === 1) {
          // instr() finds the literal at or after `cursor + offset`; the segment
          // starts `offset` characters before it.
          const lit = segment.literals[0];
          const O = `"like$o${i}"`;
          leftmost = sql`(SELECT CASE WHEN ${O} > 0 AND ${fits(`${cursor} + ${O} - 1`)} THEN ${cursor} + ${O} - 1 END FROM (SELECT instr(substr(${V}, ${cursor} + ${lit.offset}), ${bind(lit.text)}) AS ${O}))`;
        } else {
          const S = `"like$s${i}"`;
          leftmost = sql`(WITH RECURSIVE ${S}(q) AS (SELECT ${cursor} UNION ALL SELECT q + 1 FROM ${S} WHERE ${fits("q + 1")}) SELECT min(q) FROM ${S} WHERE ${fits("q")} AND ${joinFragments(at("q", segment), " AND ")})`;
        }
        return sql`(SELECT CASE WHEN ${P} IS NULL THEN 0 ELSE ${place(i + 1, `${P} + ${segment.length}`)} END FROM (SELECT ${leftmost} AS ${P}))`;
      };
      conditions.push(place(0, String(segments[0].length + 1)));
    }
  }
  return sql`(SELECT CASE WHEN ${V} IS NULL THEN NULL ELSE ${joinFragments(conditions, " AND ")} END FROM (SELECT ${subject} AS ${V}))`;
}

const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * `ref LIKE pattern` / `ref ILIKE pattern` with Postgres' semantics, as SQL D1
 * will run. A pattern that fits D1's limit is plain GLOB (like) or LIKE (ilike,
 * after ilikeFold); a longer one becomes substrLikeSql(). `maxPatternBytes` is
 * only lowered by tests, to run the substr form against short patterns too.
 */
export function likeSql(ref: string, pattern: string, caseInsensitive: boolean, maxPatternBytes = D1_MAX_PATTERN_BYTES): Fragment | PostgrestError {
  const segments = likeSegments(pattern);
  if (!segments) return sql`(CASE WHEN ${ref} IS NULL THEN NULL ELSE 0 END)`;
  const unsupported = (details: string): PostgrestError =>
    ({ code: "PGRST100", message: "failed to parse request", details: `d1-adapter: ${details}`, hint: null, status: 400 });
  // Nothing in the codebase sends more than one middle segment (every search is
  // `%term%` with `%` stripped or escaped); this only bounds a hand-built pattern.
  const tooDeep = (s: LikeSegment[]) => s.length - 2 > MAX_LIKE_MIDDLE_SEGMENTS
    ? unsupported(`a LIKE pattern over ${maxPatternBytes} bytes with more than ${MAX_LIKE_MIDDLE_SEGMENTS + 1} '%' wildcards is not implemented`)
    : null;

  if (!caseInsensitive) {
    const glob = likePatternToGlob(pattern);
    if (utf8Bytes(glob) <= maxPatternBytes) return sql`${ref} GLOB ${bind(glob)}`;
    return tooDeep(segments) ?? substrLikeSql(ref, segments);
  }
  const folded = ilikeFold(ref, pattern);
  if (!folded) return unsupported(`ilike pattern folds more than ${MAX_ILIKE_FOLDS} distinct non-ASCII letters`);
  if (utf8Bytes(folded.pattern) <= maxPatternBytes) return sql`${folded.column} LIKE ${bind(folded.pattern)} ESCAPE '\\'`;
  // SQLite's lower() folds ASCII only (checked on D1: lower('Ü') is 'Ü'), which
  // is exactly the half ilikeFold leaves to LIKE — so the column is lowered on top
  // of the fold, the pattern is lowered to match, and every comparison can then
  // be an exact one. Both mappings are one character to one, so no position moves.
  const lowered = likeSegments(asciiLower(folded.pattern))!;
  return tooDeep(lowered) ?? substrLikeSql(`lower(${folded.column})`, lowered);
}

/** One comparison of `ref` with one operand — shared by plain and quantified filters. */
function comparisonSql(ctx: Ctx, col: ColumnMeta, ref: string, op: FilterOp, value: unknown): string {
  const push = (v: unknown) => { ctx.params.push(v); };
  switch (op) {
    case "eq":  push(encodeParam(value, col.pg)); return `${ref} = ?`;
    case "neq": push(encodeParam(value, col.pg)); return `${ref} <> ?`;
    case "gt":  push(encodeParam(value, col.pg)); return `${ref} > ?`;
    case "gte": push(encodeParam(value, col.pg)); return `${ref} >= ?`;
    case "lt":  push(encodeParam(value, col.pg)); return `${ref} < ?`;
    case "lte": push(encodeParam(value, col.pg)); return `${ref} <= ?`;
    // IS DISTINCT FROM: NULL-safe and never NULL itself — SQLite spells it IS NOT.
    case "isdistinct": push(encodeParam(value, col.pg)); return `${ref} IS NOT ?`;

    // Patterns are NOT run through encodeParam: they are patterns, not values
    // (a pattern for a jsonb column must not be JSON.stringify'd). A NULL element
    // of a quantified list stays NULL, so its comparison is NULL as in Postgres.
    case "like":
    case "ilike": {
      if (value === null) { push(null); return op === "like" ? `${ref} GLOB ?` : `${ref} LIKE ? ESCAPE '\\'`; }
      const built = likeSql(ref, String(value), op === "ilike");
      if ("code" in built) return fail(built);
      ctx.params.push(...built.params);
      return built.sql;
    }
    default:
      return fail(pgErr("PGRST100", `unknown operator "${String(op)}"`, 400));
  }
}

function conditionSql(ctx: Ctx, c: Condition): string {
  const col = requireColumn(ctx, c.column);
  const ref = qi(c.column);
  const push = (v: unknown) => { ctx.params.push(v); };
  let expr: string;

  if (c.quant) {
    // `gt(all).{1,2}` / `ilike(any).{…}`: one comparison per element, combined
    // the way Postgres combines ANY / ALL — plain OR / AND over three-valued
    // results, so a NULL element leaves a non-match NULL rather than false. An
    // empty list is false for ANY and true for ALL. (`eq(any)` arrives as `in`.)
    const list = Array.isArray(c.value) ? c.value : [c.value];
    const parts = list.map((v) => comparisonSql(ctx, col, ref, c.op, v));
    expr = parts.length === 0 ? (c.quant === "any" ? "0" : "1") : `(${joinLogic(parts, c.quant === "any" ? " OR " : " AND ")})`;
    return c.negate ? `NOT ${expr}` : expr;
  }

  switch (c.op) {
    case "eq": case "neq": case "gt": case "gte": case "lt": case "lte":
    case "isdistinct": case "like": case "ilike":
      expr = comparisonSql(ctx, col, ref, c.op, c.value);
      break;

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
      // A NULL needle is never "found" (arrayfuncs.c array_contain_compare), so
      // `@> '{a,NULL}'` is false for every non-NULL array — json_each would
      // instead drop it through `NULL NOT IN (…)` and answer true.
      if (needles.some((v) => v === null)) { expr = `(CASE WHEN ${ref} IS NULL THEN NULL ELSE 0 END)`; break; }
      expr = `(CASE WHEN ${ref} IS NULL THEN NULL ELSE NOT EXISTS (`
        + `SELECT 1 FROM json_each(?) AS needle WHERE needle.value NOT IN (`
        + `SELECT value FROM json_each(${ref}) WHERE value IS NOT NULL)`
        + `) END)`;
      push(JSON.stringify(needles));
      break;
    }

    case "cd": {
      // `col <@ '{…}'`: every element of the stored array is in the list. A NULL
      // element of the column is never contained, NULLs in the list match nothing,
      // and an empty stored array is contained in anything.
      const list = Array.isArray(c.value) ? c.value : [c.value];
      expr = `(CASE WHEN ${ref} IS NULL THEN NULL ELSE NOT EXISTS (`
        + `SELECT 1 FROM json_each(${ref}) AS elem WHERE elem.value IS NULL OR elem.value NOT IN (`
        + `SELECT value FROM json_each(?) WHERE value IS NOT NULL)`
        + `) END)`;
      push(JSON.stringify(list));
      break;
    }

    case "ov": {
      // `col && '{…}'`: at least one non-NULL element in common.
      const list = Array.isArray(c.value) ? c.value : [c.value];
      expr = `(CASE WHEN ${ref} IS NULL THEN NULL ELSE EXISTS (`
        + `SELECT 1 FROM json_each(${ref}) AS elem WHERE elem.value IS NOT NULL AND elem.value IN (`
        + `SELECT value FROM json_each(?) WHERE value IS NOT NULL)`
        + `) END)`;
      push(JSON.stringify(list));
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

/**
 * The longest AND / OR chain written flat.
 *
 * SQLite parses `a OR b OR c …` as a left-deep tree, one level per term, and D1
 * refuses any expression more than 100 levels deep ("Expression tree is too
 * large"). Supabase answers an or=(…) of 100, 150 or 500 conditions with 200; D1
 * refused the same filter from the 100th. A longer chain is halved into
 * parenthesised groups instead — the same three-valued result, since AND and OR
 * are associative, at a depth that grows with log2 (measured on D1: 3,000 terms
 * run). Chains this short stay flat, so the SQL of every filter the codebase
 * sends today is unchanged.
 */
const MAX_FLAT_TERMS = 8;

/** `parts` joined with `op`, split into balanced groups past MAX_FLAT_TERMS. Left-to-right order — and so param order — is kept. */
function joinLogic(parts: string[], op: " AND " | " OR "): string {
  if (parts.length <= MAX_FLAT_TERMS) return parts.join(op);
  const half = Math.ceil(parts.length / 2);
  return `(${joinLogic(parts.slice(0, half), op)})${op}(${joinLogic(parts.slice(half), op)})`;
}

function whereNode(ctx: Ctx, node: Where): string {
  if ((node as Condition).kind === "cmp") return conditionSql(ctx, node as Condition);
  const group = node as Group;
  const parts = group.children.map((child) => whereNode(ctx, child)).filter(Boolean);
  const sql = parts.length === 0
    ? (group.kind === "and" ? "1" : "0")
    : `(${joinLogic(parts, group.kind === "and" ? " AND " : " OR ")})`;
  // `not.and(…)`: NOT over the whole group, three-valued like Postgres.
  return group.negate ? `NOT ${sql}` : sql;
}

function whereClause(ctx: Ctx, where: Where[]): string {
  if (!where.length) return "";
  return ` WHERE ${joinLogic(where.map((w) => whereNode(ctx, w)), " AND ")}`;
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

/**
 * The D1 schema's own function defaults in SQL — d1/gen-schema.mjs nowExpr() and
 * UUID_EXPR character for character (tests/pgrestWrites.test.ts pins both to
 * d1/schema.sql). A write needs them wherever Postgres fills in a value that a
 * SQLite statement cannot leave to the column: a key missing from one row under
 * `Prefer: missing=default`, and the now() of a BEFORE UPDATE trigger.
 */
const nowSql = (modifier?: string) => `(strftime('%Y-%m-%dT%H:%M:%f','now'${modifier ? `,'${modifier}'` : ""}) || '000+00:00')`;
const UUID_SQL = "(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || "
  + "substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))";
const sqlLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * A column's default (the registry keeps Postgres' text of it) as the SQLite
 * expression d1/gen-schema.mjs translateDefault() wrote into d1/schema.sql. `NULL`
 * for a column without one; null for a default no SQLite expression reproduces.
 */
export function columnDefaultSql(col: ColumnMeta): string | null {
  const def = col.default;
  if (def === null || def === undefined) return "NULL";
  if (def === "now()") return nowSql();
  if (def === "gen_random_uuid()") return UUID_SQL;
  if (typeof def === "boolean") return def ? "1" : "0";
  if (typeof def === "number") return String(def);
  if (typeof def !== "string") return null;
  const interval = /^\(now\(\) \+ '([^']+)'::interval\)$/.exec(def);
  if (interval) {
    // Digits and a unit word only, so the modifier is safe to write into the SQL.
    const hms = /^(\d+):(\d+):(\d+)$/.exec(interval[1]);
    if (hms) return nowSql(`+${Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])} seconds`);
    const unit = /^(\d+) (second|minute|hour|day|month|year)s?$/.exec(interval[1]);
    return unit ? nowSql(`+${unit[1]} ${unit[2]}s`) : null;
  }
  if (col.pg === "text[]" || col.pg === "uuid[]") return def === "{}" ? "'[]'" : null;
  if (col.pg === "jsonb") return sqlLiteral(def);
  if (/\(|::/.test(def)) return null;
  if ((col.pg === "integer" || col.pg === "bigint" || col.pg === "numeric") && /^-?\d+(\.\d+)?$/.test(def)) return def;
  return sqlLiteral(def);
}

/**
 * Columns a Postgres BEFORE UPDATE trigger sets to now() on every update.
 *
 * d1/schema.sql ports employers_set_updated_at as an AFTER UPDATE trigger — SQLite
 * cannot assign NEW — which stamps the row with a second UPDATE once the first has
 * run. So the row UPDATE … RETURNING handed back still carried the OLD timestamp:
 * the admin employers PATCH (app/api/portal/admin/employers/route.ts) answered
 * with the pre-edit updated_at while the table held the new one. And the nested
 * UPDATE counted in D1's rows-affected, so `count: "exact"` said 2 for one row.
 * Setting the column in the statement itself puts the new value in RETURNING and
 * makes the trigger's `WHEN NEW.updated_at IS OLD.updated_at` false, so it stays
 * quiet. Postgres' trigger overwrites whatever the caller sent; so does this.
 * tests/pgrestWrites.test.ts checks every trigger of that shape in d1/schema.sql
 * is listed here.
 */
export const UPDATE_STAMPS: Record<string, string> = { employers: "updated_at" };

function stampColumn(ctx: Ctx): string | undefined {
  const col = Object.prototype.hasOwnProperty.call(UPDATE_STAMPS, ctx.table) ? UPDATE_STAMPS[ctx.table] : undefined;
  return col && Object.prototype.hasOwnProperty.call(ctx.meta.columns, col) ? col : undefined;
}

/** Postgres' answer to an upsert whose own rows share a conflict key (nodeModifyTable.c); PostgREST sends 21000 as a 500. */
const affectsRowTwice = (): PostgrestError => pgErr("21000", "ON CONFLICT DO UPDATE command cannot affect row a second time", 500,
  "Ensure that no rows proposed for insertion within the same command have duplicate constrained values.");

/**
 * One payload value → its bound parameter: read by the column's input function
 * first (the 22P02 / 22003 / 22007 / 22008 Supabase answers with), then spelled
 * the way the copy stores it.
 */
function writeParam(col: ColumnMeta, value: unknown, viaJsonb: boolean): unknown {
  const typed = writeInput(value, col.pg, viaJsonb);
  if (isInputError(typed)) return fail(typed.error);
  return encodeParam(typed.value, col.pg);
}

/**
 * Column positions in the order Postgres reads them. PostgREST keeps a write's
 * columns as a sorted set and json_to_recordset() converts a row's columns in
 * that order, so a row with two bad values is refused over the first by name.
 */
const conversionOrder = (cols: string[]): number[] =>
  cols.map((_, i) => i).sort((a, b) => (cols[a] < cols[b] ? -1 : cols[a] > cols[b] ? 1 : 0));

/**
 * The key sets of a bulk insert are joined on NUL rather than a comma because a
 * column name is caller text: `{"a,b": 1}` must not compare equal to
 * `{"a": 1, "b": 1}`. Built from its code point — a raw NUL byte in the source
 * makes git, grep and every review tool treat this file as binary.
 */
const KEY_SEPARATOR = String.fromCharCode(0);

/**
 * INSERT / upsert — ONE statement, whatever the row count.
 *
 * PostgREST gives Postgres a bulk insert as a single json parameter, so 52 rows
 * cost what one does. Binding a `?` per column per row instead ran into D1's
 * 100-parameter limit from the 11th week of a weekly calendar event (10 columns),
 * the 15th tagged attendee's notification (7), the 17th lead of the bot's
 * createLeadsBatch (6) and the 26th candidate added to an academy cohort (4) —
 * each refused whole with "too many SQL variables".
 *
 * So the rows travel the same way here: every value typed and encoded, all rows
 * as ONE JSON array of arrays, unpacked by `INSERT … SELECT json_extract(…) FROM
 * json_each(?)`. json_extract hands back a string as TEXT, a number as INTEGER or
 * REAL and null as NULL — exactly what the placeholders bound — and the ORDER BY
 * keeps the rows, and so RETURNING, in the order they were sent. `WHERE true` is
 * SQLite's documented fix for its upsert grammar: without it `ON CONFLICT` parses
 * as a join constraint of the FROM clause.
 */
function buildInsert(ctx: Ctx, intent: QueryIntent): BuiltQuery {
  const rows = intent.values ?? [];
  if (rows.length === 0) return noOpQuery(ctx, intent);

  // `columns=` names the columns outright; without it they are the rows' keys.
  const cols = intent.columns ?? Object.keys(rows[0]);
  if (cols.length === 0) {
    if (rows.length > 1) fail(pgErr("PGRST102", "All object keys must match", 400));
    // `.insert({})` — let every default fire. No ON CONFLICT clause even for an
    // upsert: SQLite's grammar has no upsert-clause after DEFAULT VALUES, and a
    // payload with no columns has nothing to merge anyway.
    return { sql: `INSERT INTO ${qi(ctx.table)} DEFAULT VALUES${returningClause(ctx, intent)}`, params: ctx.params };
  }
  if (!intent.columns) {
    // Without `columns=` PostgREST refuses a bulk insert whose objects don't
    // share one key set (PGRST102) rather than guessing a NULL for the missing
    // ones. supabase-js sends `columns=` with every array, so only a hand-built
    // request gets here.
    const key = cols.slice().sort().join(KEY_SEPARATOR);
    for (const row of rows) {
      if (Object.keys(row).slice().sort().join(KEY_SEPARATOR) !== key) fail(pgErr("PGRST102", "All object keys must match", 400));
    }
  }
  const metas = cols.map((c) => requireWritable(ctx, c));

  const upsert = intent.action === "upsert";
  // PostgREST falls back to the primary key when on_conflict is absent. Checked
  // before any value is read, because Postgres rejects the target while planning.
  const target = upsert ? (intent.onConflict?.length ? intent.onConflict : ctx.meta.pk) : [];
  if (upsert) {
    if (!target.length) {
      fail(pgErr("42P10", "there is no unique or exclusion constraint matching the ON CONFLICT specification", 400));
    }
    for (const c of target) requireColumn(ctx, c);
  }

  const viaJsonb = intent.missingDefault === true;
  // A key the row does not have is NULL — or, under missing=default, its column's
  // default (fromJsonBodyF merges the defaults under every row), which the
  // statement fills in. Encoded values are only ever strings, numbers and null, so
  // a JSON object can mark that cell without ever colliding with a value.
  const DEFAULT_CELL = {};
  const defaulted = new Set<number>();
  // DO UPDATE may not reach one row twice. Postgres raises 21000 when a row
  // conflicts with one the same statement already wrote; SQLite just updates it
  // again, and answered 201 with a representation per input row for one stored
  // row (academy add_members never de-duplicates its candidateIds). Two rows
  // collide when every conflict column holds the same non-NULL value — NULLs never
  // conflict — and the values are canonical by now (a uuid lowercased, a timestamp
  // respelled), so equal cells are equal keys.
  const keyAt = upsert && !intent.ignoreDuplicates && target.every((c) => cols.includes(c))
    ? target.map((c) => cols.indexOf(c))
    : null;
  const seen = new Set<string>();
  const cells: unknown[][] = [];
  for (const row of rows) {
    const encoded: unknown[] = new Array(cols.length).fill(null);
    for (const i of conversionOrder(cols)) {
      if (Object.prototype.hasOwnProperty.call(row, cols[i])) {
        encoded[i] = writeParam(metas[i], row[cols[i]], viaJsonb);
      } else if (viaJsonb && metas[i].default !== null && metas[i].default !== undefined) {
        if (columnDefaultSql(metas[i]) === null) {
          fail({ code: "PGRST100", message: "failed to parse request", details: `d1-adapter: the default of '${cols[i]}' has no SQLite translation for missing=default`, hint: null, status: 400 });
        }
        encoded[i] = DEFAULT_CELL;
        defaulted.add(i);
      }
    }
    if (keyAt) {
      const key = keyAt.map((i) => encoded[i]);
      if (key.every((v) => v !== null && v !== DEFAULT_CELL)) {
        const k = JSON.stringify(key);
        if (seen.has(k)) fail(affectsRowTwice());
        seen.add(k);
      }
    }
    cells.push(encoded);
  }

  const ROW = `"row$"`;
  const exprs = cols.map((_, i) => {
    const cell = `json_extract(${ROW}."value", '$[${i}]')`;
    return defaulted.has(i)
      ? `CASE WHEN json_type(${ROW}."value", '$[${i}]') = 'object' THEN ${columnDefaultSql(metas[i])} ELSE ${cell} END`
      : cell;
  });
  let sql = `INSERT INTO ${qi(ctx.table)} (${cols.map(qi).join(", ")}) SELECT ${exprs.join(", ")} FROM json_each(?) AS ${ROW} WHERE true ORDER BY ${ROW}."key"`;
  ctx.params.push(JSON.stringify(cells.map((r) => r.map((v) => (v === DEFAULT_CELL ? {} : v)))));

  if (upsert) {
    sql += ` ON CONFLICT (${target.map(qi).join(", ")}) `;
    if (intent.ignoreDuplicates) {
      sql += "DO NOTHING";                                  // Prefer: resolution=ignore-duplicates
    } else {
      const stamp = stampColumn(ctx);
      const sets = cols.filter((c) => c !== stamp).map((c) => `${qi(c)} = excluded.${qi(c)}`);
      if (stamp) sets.push(`${qi(stamp)} = ${nowSql()}`);
      sql += `DO UPDATE SET ${sets.join(", ")}`;
    }
  }
  return { sql: sql + returningClause(ctx, intent), params: ctx.params };
}

function buildUpdate(ctx: Ctx, intent: QueryIntent): BuiltQuery {
  rejectPagedMutation(intent);
  const payload = intent.values?.[0] ?? {};
  const cols = intent.columns ?? Object.keys(payload);
  if (cols.length === 0) return noOpQuery(ctx, intent);   // empty PATCH body = no-op, like PostgREST
  const metas = cols.map((c) => requireWritable(ctx, c));
  // Read in Postgres' conversion order, bound in SQL order. A column `columns=`
  // lists but the body lacks is NULL, as json_to_record() makes it.
  const values: unknown[] = new Array(cols.length).fill(null);
  for (const i of conversionOrder(cols)) {
    if (Object.prototype.hasOwnProperty.call(payload, cols[i])) values[i] = writeParam(metas[i], payload[cols[i]], false);
  }
  const stamp = stampColumn(ctx);
  const sets: string[] = [];
  cols.forEach((c, i) => {
    if (c === stamp) return;          // still type-checked above; the trigger's now() wins, as in Postgres
    ctx.params.push(values[i]);
    sets.push(`${qi(c)} = ?`);
  });
  if (stamp) sets.push(`${qi(stamp)} = ${nowSql()}`);
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

/** D1's ceiling on bound parameters per statement (measured: 100 run, 101 fail). */
export const D1_MAX_PARAMS = 100;

/**
 * A statement past D1_MAX_PARAMS with its operands packed into ONE parameter.
 *
 * Everything the builder emits stays under the limit by itself — an `in` list and
 * a bulk write each travel as a single JSON array — except a filter that is wide
 * in its own right: an or=(…) of 150 conditions carries 150 operands, which
 * Supabase answers and D1 refused with "too many SQL variables". Such a statement
 * binds its operands as one JSON array instead, each `?` becoming
 * `json_extract(?1, '$[i]')`: the same value, with the same (absent) affinity, so
 * every comparison answers as before. A statement within the limit is returned
 * untouched.
 */
export function fitParams(q: BuiltQuery): BuiltQuery {
  if (q.params.length <= D1_MAX_PARAMS) return q;
  let sql = "";
  let n = 0;
  let quote: string | null = null;
  for (const c of q.sql) {
    // A `?` inside a quoted literal or identifier is text, not a placeholder.
    if (quote) { if (c === quote) quote = null; sql += c; continue; }
    if (c === "'" || c === '"') { quote = c; sql += c; continue; }
    sql += c === "?" ? `json_extract(?1, '$[${n++}]')` : c;
  }
  // Every placeholder must have met its param; otherwise leave D1 to refuse it as before.
  return n === q.params.length ? { sql, params: [JSON.stringify(q.params)] } : q;
}

export function buildSql(intent: QueryIntent, registry: Registry): BuiltQuery | PostgrestError {
  const meta = registry[intent.table];
  if (!meta) return missingTable(intent.table);
  const ctx: Ctx = { table: intent.table, meta, params: [] };
  try {
    switch (intent.action) {
      case "select": return fitParams(buildSelect(ctx, intent));
      case "insert":
      case "upsert": return fitParams(buildInsert(ctx, intent));
      case "update": return fitParams(buildUpdate(ctx, intent));
      case "delete": return fitParams(buildDelete(ctx, intent));
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
