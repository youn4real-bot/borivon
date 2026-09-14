/**
 * PostgREST's paging window, reproduced (PostgREST→D1 adapter).
 *
 * `limit=`, `offset=` and a `Range:` header do not mean what they look like. The
 * adapter used to read them as non-negative integers and 400 everything else;
 * measured against the live project, PostgREST instead:
 *
 *   • reads each value with Haskell's `readMaybe :: Integer` — so `0x3`, `(3)`,
 *     `- 3` and a non-breaking space around a number are all fine, and anything
 *     it cannot read (`abc`, `3.5`, `1e2`, `+3`) is IGNORED, not refused:
 *     `limit=abc` returns every row, where the adapter answered 400;
 *   • combines a limit and an offset into one range, so an unreadable limit next
 *     to an offset counts as limit 0 — `limit=abc&offset=5` is a 416, while
 *     `limit=abc&offset=abc` is an empty 200;
 *   • clamps a negative offset to 0 against the header range, and refuses a range
 *     that is empty for any other reason with PGRST103 / 416 ("Limit should be
 *     greater than or equal to zero.", or the Range-header wording);
 *   • honours `Range:` on GET only — a HEAD ignores it;
 *   • lets the LAST `limit=` win, and skips a bare `limit` with no `=`.
 *
 * The code below is a port of PostgREST 14.5 (RangeQuery.hs, the range union in
 * ApiRequest/QueryParams.hs, the checks in ApiRequest.hs) over the Ranged-sets
 * boundary algebra it is written in, because the edge cases above fall out of
 * that algebra — in particular its rule that `BoundaryAbove n` EQUALS
 * `BoundaryBelow (n+1)`, which is what makes `limit=0` legal and
 * `limit=0&offset=5` not. Every case is pinned in tests/pgrestRange.test.ts
 * against the live answer.
 *
 * Pure and total: nothing here throws, and every integer is a bigint, because an
 * offset of 9223372036854775807 is a legal request whose 416 message quotes it.
 */
import type { PostgrestError } from "./types";

/* ─────────────────────── Haskell's readMaybe :: Integer ───────────────────── */

/** GHC's Data.Char.isSpace: the ASCII whitespace, NBSP, and Unicode category Zs. */
const isHsSpace = (c: string | undefined) => c !== undefined && (/[\t\n\v\f\r ]/.test(c) || /\p{Zs}/u.test(c));
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
/** A character Text.Read.Lex gathers into a symbol lexeme (`-` must stand alone to mean negation). */
const isSymbolChar = (c: string | undefined) =>
  c !== undefined && (/[!@#$%&*+./<=>?\\^|:\-~]/.test(c) || (c.charCodeAt(0) > 127 && /[\p{S}\p{Pd}\p{Po}]/u.test(c)));

function skipSpaces(s: string, i: number): number {
  while (isHsSpace(s[i])) i++;
  return i;
}

/**
 * One number lexeme at `i`: `0x…` / `0o…` or decimal. A fraction or an exponent
 * still lexes as a number but is no Integer, which fails the whole read — there
 * is no alternative lexing that would stop before the `.` or the `e`.
 */
function lexInteger(s: string, i: number): { n: bigint; end: number } | null {
  if (s[i] === "0" && /[xXoO]/.test(s[i + 1] ?? "")) {
    const hex = /[xX]/.test(s[i + 1]);
    const digit = hex ? /[0-9a-fA-F]/ : /[0-7]/;
    let j = i + 2;
    while (j < s.length && digit.test(s[j])) j++;
    if (j > i + 2) return { n: BigInt(`${hex ? "0x" : "0o"}${s.slice(i + 2, j)}`), end: j };
    // `0x` with no digit: Lex falls back to the decimal `0`, and the `x` is left over.
  }
  if (!isDigit(s[i])) return null;
  let j = i;
  while (isDigit(s[j])) j++;
  if (s[j] === "." && isDigit(s[j + 1])) return null;
  if (/[eE]/.test(s[j] ?? "")) {
    const k = /[+-]/.test(s[j + 1] ?? "") ? j + 2 : j + 1;
    if (isDigit(s[k])) return null;
  }
  return { n: BigInt(s.slice(i, j)), end: j };
}

/** GHC.Read's readNumber under `parens`: `n`, `-n`, `- n`, and either inside any depth of parentheses. */
function readNumberAt(s: string, i: number): { n: bigint; end: number } | null {
  i = skipSpaces(s, i);
  if (s[i] === "(") {
    const inner = readNumberAt(s, i + 1);
    if (!inner) return null;
    const j = skipSpaces(s, inner.end);
    return s[j] === ")" ? { n: inner.n, end: j + 1 } : null;
  }
  if (s[i] === "-") {
    if (isSymbolChar(s[i + 1])) return null;                // `--3`, `-+3`: one symbol lexeme that isn't `-`
    const num = lexInteger(s, skipSpaces(s, i + 1));
    return num ? { n: -num.n, end: num.end } : null;
  }
  return lexInteger(s, i);
}

/** `readMaybe s :: Maybe Integer` — what PostgREST does with every limit and offset value. */
export function readInteger(s: string): bigint | null {
  const r = readNumberAt(s, 0);
  return r && skipSpaces(s, r.end) === s.length ? r.n : null;
}

/* ─────────────────────────── Ranged-sets, for Integer ─────────────────────── */

// Constructed, not written as literals: the tree compiles below ES2020.
const ZERO = BigInt(0);
const ONE = BigInt(1);

type Boundary =
  | { kind: "belowAll" }
  | { kind: "below"; n: bigint }   // the range starts AT n
  | { kind: "above"; n: bigint }   // the range ends AT n
  | { kind: "aboveAll" };
type Range = { lower: Boundary; upper: Boundary };

const BELOW_ALL: Boundary = { kind: "belowAll" };
const ABOVE_ALL: Boundary = { kind: "aboveAll" };
const below = (n: bigint): Boundary => ({ kind: "below", n });
const above = (n: bigint): Boundary => ({ kind: "above", n });

/**
 * Data.Ranged.Boundaries' Ord instance. The one non-obvious rule: for a discrete
 * type, "ends at n" and "starts at n+1" are the SAME cut, so they compare equal.
 */
function compare(a: Boundary, b: Boundary): number {
  if (a.kind === "belowAll") return b.kind === "belowAll" ? 0 : -1;
  if (a.kind === "aboveAll") return b.kind === "aboveAll" ? 0 : 1;
  if (b.kind === "belowAll") return 1;
  if (b.kind === "aboveAll") return -1;
  if (a.kind === b.kind) return a.n < b.n ? -1 : a.n > b.n ? 1 : 0;
  if (a.kind === "above") return a.n < b.n ? (a.n + ONE === b.n ? 0 : -1) : 1;
  return a.n > b.n ? (b.n + ONE === a.n ? 0 : 1) : -1;
}
const maxB = (a: Boundary, b: Boundary) => (compare(a, b) >= 0 ? a : b);
const minB = (a: Boundary, b: Boundary) => (compare(a, b) <= 0 ? a : b);

const EMPTY: Range = { lower: ABOVE_ALL, upper: BELOW_ALL };
const isEmpty = (r: Range) => compare(r.upper, r.lower) <= 0;
/** Range equality: any two empty ranges are equal, whatever their bounds. */
const rangeEq = (a: Range, b: Range) =>
  (isEmpty(a) && isEmpty(b)) || (compare(a.lower, b.lower) === 0 && compare(a.upper, b.upper) === 0);
const intersect = (a: Range, b: Range): Range =>
  isEmpty(a) || isEmpty(b) ? EMPTY : { lower: maxB(a.lower, b.lower), upper: minB(a.upper, b.upper) };

const rangeGeq = (n: bigint): Range => ({ lower: below(n), upper: ABOVE_ALL });
const rangeLeq = (n: bigint): Range => ({ lower: BELOW_ALL, upper: above(n) });
const ALL = rangeGeq(ZERO);
const LIMIT_ZERO: Range = { lower: below(ZERO), upper: above(-ONE) };

function rangeLimit(r: Range): bigint | null {
  return r.lower.kind === "below" && r.upper.kind === "above" ? ONE + r.upper.n - r.lower.n : null;
}
/** Only ever asked of a range with a real lower bound (PostgREST panics otherwise). */
const rangeOffset = (r: Range): bigint => (r.lower.kind === "below" ? r.lower.n : ZERO);

function restrictRange(limit: bigint | null, r: Range): Range {
  return limit === null ? r : intersect(r, { lower: BELOW_ALL, upper: above(rangeOffset(r) + limit - ONE) });
}
const hasLimitZero = (r: Range) => compare(r.upper, LIMIT_ZERO.upper) === 0;

/** `Range: 0-9` / `Range: 10-`; anything else — `items=0-9`, `-5`, `0-4,6-8` — means every row. */
function rangeParse(header: string): Range {
  const m = /^([0-9]+)-([0-9]*)$/.exec(header);
  if (!m) return ALL;
  return intersect(rangeGeq(BigInt(m[1])), m[2] === "" ? ALL : rangeLeq(BigInt(m[2])));
}

/* ─────────────────────────────── the window ──────────────────────────────── */

/** Where a read starts and how many rows it may return; `all` is "no paging asked for". */
export type Window = { offset: bigint; limit: bigint | null; all: boolean };

export type RangeInput = {
  /** Every `limit=` value in the query string, in order (a bare `limit` without `=` is not one). */
  limits: string[];
  offsets: string[];
  /** The `Range` header — pass null for anything but GET, which is the only method PostgREST reads it on. */
  header: string | null;
};

function invalidRange(details: string): PostgrestError {
  return { code: "PGRST103", message: "Requested range not satisfiable", details, hint: null, status: 416 };
}

/** ApiRequest.hs: the query-string range, intersected with the header range, or its PGRST103. */
export function resolveRange(input: RangeInput): Window | PostgrestError {
  const lastLimit = input.limits.at(-1);
  const lastOffset = input.offsets.at(-1);
  const limitParam = lastLimit === undefined ? undefined : restrictRange(readInteger(lastLimit), ALL);
  const offsetParam = lastOffset === undefined ? undefined : (() => {
    const n = readInteger(lastOffset);
    return n === null ? ALL : rangeGeq(n);
  })();

  let limitRange: Range;
  if (limitParam && offsetParam) {
    // HM.unionWith: an offset starts the range, and a limit that says nothing counts as 0.
    const l = rangeLimit(limitParam) ?? ZERO;
    const o = rangeOffset(offsetParam);
    limitRange = { lower: below(o), upper: above(o + l - ONE) };
  } else {
    limitRange = limitParam ?? offsetParam ?? ALL;
  }

  const headerRange = input.header === null ? ALL : rangeParse(input.header.trim());
  const top = hasLimitZero(limitRange) ? LIMIT_ZERO : intersect(headerRange, limitRange);
  if (rangeEq(top, EMPTY) && !hasLimitZero(limitRange)) {
    return invalidRange(isEmpty(headerRange)
      ? "The lower boundary must be lower than or equal to the upper boundary in the Range header."
      : "Limit should be greater than or equal to zero.");
  }
  return { offset: rangeOffset(top), limit: rangeLimit(top), all: rangeEq(top, ALL) };
}
