/**
 * Postgres' text ORDER BY, reproduced in JavaScript (PostgREST→D1 adapter).
 *
 * Supabase sorts text under a linguistic UTF-8 collation; SQLite on D1 has no
 * ICU and only offers BINARY and an ASCII-only NOCASE. The adapter used NOCASE,
 * and it answered a different sequence for the same `.order(textcol)` whenever a
 * value held an accent, a symbol or a case-only difference. Measured on the live
 * project: `PRÉFECTURE CASABLANCA ANFA` is second in candidate_profiles ordered by
 * issuing_authority and was filed after the whole `PREFECTURE …` block (É is
 * above Z by byte); the 761 documents ordered by file_type had their
 * `Baccalauréat` and `Baccalaureate` blocks swapped; `youn4real@…` sorts before
 * `youn4real4real@…` (a symbol before a digit) and came after it; `….pdf` and
 * `….PDF` were a NOCASE tie in whatever order SQLite met them, where Postgres puts
 * the lowercase one first.
 *
 * The comparator below was chosen against the live answers, not the docs: every
 * text column of every table was read from Supabase in its own `order=col.asc`
 * sequence (43,465 adjacent pairs, punctuation, digits, case ties, Arabic, French
 * and German text included) and ICU's en-US collation followed by a code-point
 * tie-break agreed with every pair. Ignoring punctuation broke 152 pairs, putting
 * uppercase first broke 66, and plain code-point order broke 538. Re-checked
 * before wiring it in: all 321 text columns (51,285 values) re-sorted from a
 * shuffle came back in live's exact sequence, ascending and descending.
 *
 * Why the tie-break: Postgres' varstr_cmp() falls back to strcmp() when the
 * collation calls two different strings equal, so two strings only tie when they
 * are the same bytes. UTF-8 bytes order exactly like code points.
 */
import type { SortKey } from "./types";

/**
 * Built once: constructing a Collator costs far more than using one, and every
 * option is spelled out so a runtime with a different default locale (a Worker
 * has none of its own) still sorts the way Supabase does.
 */
const COLLATOR = new Intl.Collator("en-US", {
  usage: "sort",
  sensitivity: "variant",
  ignorePunctuation: false,
  numeric: false,
  caseFirst: "false",
});

/**
 * Code-point order. JavaScript's own `<` compares UTF-16 code units, which puts
 * an astral character (an emoji, U+1F600) below U+E000–U+FFFF; strcmp() on UTF-8
 * puts it above, so the units are read as code points here.
 */
export function codePointCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x - y;
    if (x > 0xffff) i++;                       // both halves of the same surrogate pair matched
  }
  return a.length - b.length;
}

/** Two text values as Postgres orders them ascending: collation first, then bytes. */
export function compareText(a: string, b: string): number {
  return COLLATOR.compare(a, b) || codePointCompare(a, b);
}

/**
 * Two SQLite values as its default ORDER BY would compare them — the order every
 * non-text column already sorted in correctly (numbers numerically, TEXT by
 * BINARY, which is code-point order again, and a number before any text).
 */
function compareStored(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return codePointCompare(String(a), String(b));
}

export type { SortKey };

/**
 * compareText()'s order over printable ASCII, as SQL D1 can run — so a text
 * ORDER BY can take its page in D1 instead of shipping every row's key to the
 * Worker to be sorted (read.ts has the numbers).
 *
 * Measured with the collator above: printable ASCII sorts as the space, then the
 * 32 punctuation marks in exactly the order of ICU_ASCII_MARKS, then the digits,
 * then the letters — a letter's two cases equal until a later level, where the
 * lowercase one wins. SQLite's BINARY order is none of that: `_` sorts between
 * the capitals and the small letters, `@` after the digits, `B` before `a`. So
 * the key is rebuilt from functions D1 has without ICU:
 *
 *  • lower() folds the ASCII capitals (and only them without ICU — measured on
 *    D1, lower('ÉA') is 'Éa'), giving every letter its one position;
 *  • each mark is replaced by the code point of its rank, char(1) … char(33),
 *    all below '0'. Replacements run in rank order, so the two targets that are
 *    themselves marks (char(32) is the space, char(33) is `!`) are written only
 *    after the space and `!` have already been replaced away.
 *
 * Two different strings share that key only when they differ in letter case
 * alone, and there compareText puts the lowercase letter first at the first
 * difference. Capitals sort BELOW small letters by byte, so the raw column in
 * reverse settles it:
 *
 *   ORDER BY key ASC, col DESC   is compareText ascending for plain ASCII,
 *   ORDER BY key DESC, col ASC   is compareText descending.
 *
 * tests/pgrestRead.test.ts proves both in a real SQLite against compareText:
 * every string of up to two printable characters, every string of up to three
 * over the marks around each replacement, and a seeded random set.
 */
const ICU_ASCII_MARKS = [
  0x20, 0x5f, 0x2d, 0x2c, 0x3b, 0x3a, 0x21, 0x3f, 0x2e, 0x27, 0x22, 0x28, 0x29, 0x5b, 0x5d, 0x7b, 0x7d,
  0x40, 0x2a, 0x2f, 0x5c, 0x26, 0x23, 0x25, 0x60, 0x5e, 0x2b, 0x3c, 0x3d, 0x3e, 0x7c, 0x7e, 0x24,
] as const;

/**
 * The key, as an SQL expression over `ref`. Every character is spelled char(n):
 * a quote, a backslash or a `?` never has to be written into the SQL text.
 */
export function asciiSortKeySql(ref: string): string {
  return ICU_ASCII_MARKS.reduce((sql, mark, rank) => `replace(${sql}, char(${mark}), char(${rank + 1}))`, `lower(${ref})`);
}

/**
 * True (never NULL) for a value asciiSortKeySql orders exactly: NULL — the IS
 * NULL term places it — or TEXT of printable ASCII only.
 *
 *  • typeof: a number or a blob in a text column compares by SQLite's type class,
 *    not as the string compareText is handed.
 *  • GLOB '*[^ -~]*': a control character, DEL or anything past ASCII is outside
 *    the order measured above.
 *  • the two lengths: length() stops at a NUL (measured on D1: 'a', NUL, 'b' is
 *    1 character and 3 bytes), so equal lengths refuse any NUL, which the text
 *    functions above would read as the end of the string.
 */
export function plainAsciiSql(ref: string, nullable: boolean): string {
  const plain = `(typeof(${ref}) = 'text' AND ${ref} NOT GLOB '*[^ -~]*' AND length(CAST(${ref} AS BLOB)) = length(${ref}))`;
  return nullable ? `(${ref} IS NULL OR ${plain})` : plain;
}

/**
 * Rows in PostgREST's order. Stable, so rows that tie on every key keep the order
 * they are handed over in — read.ts adds rowid as the last key, the tie-break the
 * plain rows taken in SQL use too. A descending key reverses the whole comparison,
 * tie-break included, which is what Postgres' DESC does.
 */
export function sortRows<T extends Record<string, unknown>>(rows: readonly T[], keys: readonly SortKey[]): T[] {
  return rows.slice().sort((ra, rb) => {
    for (const k of keys) {
      const a = ra[k.key];
      const b = rb[k.key];
      const aNull = a === null || a === undefined;
      const bNull = b === null || b === undefined;
      if (aNull || bNull) {
        if (aNull && bNull) continue;
        return aNull === k.nullsFirst ? -1 : 1;
      }
      const c = k.text ? compareText(String(a), String(b)) : compareStored(a, b);
      if (c !== 0) return k.ascending ? c : -c;
    }
    return 0;
  });
}
