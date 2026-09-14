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
 * Rows in PostgREST's order. Stable, so rows that tie on every key keep the order
 * SQLite handed them over in — SQL leaves that order undefined on both sides.
 * A descending key reverses the whole comparison, tie-break included, which is
 * what Postgres' DESC does.
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
