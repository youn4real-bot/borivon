/**
 * Length-cap a piece of user text without breaking a character in half.
 *
 * `s.slice(0, n)` counts UTF-16 code units, so an emoji (two units) sitting
 * across the limit is cut down to its first half: a lone surrogate. Postgres'
 * JSON lexer refuses that ("Unicode low surrogate must follow a high
 * surrogate", 22P02), and so does the D1 adapter, so the whole INSERT fails —
 * on /api/leads that is a lost lead and a 500, decided only by where the
 * visitor's emoji happened to land. A lone surrogate that arrives in the input
 * itself (a broken client can send `"\ud83d"` in JSON) is refused the same way,
 * so it is dropped here too.
 *
 * `n` stays a code-unit count, as it was, so every existing limit keeps its
 * meaning; the result is at most `n` units and never ends mid-pair.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function clipText(s: string, n: number): string {
  let v = s.replace(LONE_SURROGATE, "");
  if (v.length <= n) return v;
  v = v.slice(0, Math.max(0, n));
  const last = v.charCodeAt(v.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? v.slice(0, -1) : v;
}
