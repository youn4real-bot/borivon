/**
 * The row-level half of d1/parity-check.mjs, where a test can reach it (the
 * check itself runs on import against the live databases).
 */

/** One canonical string per value, so Postgres and SQLite forms compare equal. */
export function norm(v, pg) {
  if (v === null || v === undefined) return "∅";
  if (pg === "boolean") return v === true || v === 1 || v === "1" || v === "true" ? "1" : "0";
  if (pg === "jsonb" || pg === "text[]" || pg === "uuid[]") {
    const parsed = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v;
    return JSON.stringify(parsed);
  }
  if (pg === "integer" || pg === "bigint") return String(Number(v));
  if (pg === "numeric") return String(Number(v));
  if (pg === "timestamptz") {
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? String(t) : String(v);   // ignore fraction/offset formatting
  }
  return String(v);
}

/** Code-point order (strcmp on UTF-8), not UTF-16 units. */
function codePointCompare(a, b) {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
}

/**
 * Both sides in ONE order, decided here. Each database's own ORDER BY cannot
 * be trusted to agree on text keys: Supabase sorts text linguistically
 * (`admin@x` before `admin2@x`, `a_b` before `a.b`), D1 by bytes (the other
 * way round), so a table keyed by an email or a slug compared row i against a
 * different row i and reported a mismatch where none exists — the rollback gate
 * refusing a perfect replay. Numbers compare as numbers, everything else by
 * code point of its canonical form.
 */
export function sortByKey(rows, pk, columns) {
  const key = (row) => pk.map((c) => norm(row[c], columns[c]?.pg));
  const numeric = pk.map((c) => ["integer", "bigint", "numeric"].includes(columns[c]?.pg));
  return rows
    .map((row) => ({ row, k: key(row) }))
    .sort((a, b) => {
      for (let i = 0; i < pk.length; i++) {
        const d = numeric[i] && a.k[i] !== "∅" && b.k[i] !== "∅" ? Number(a.k[i]) - Number(b.k[i]) : codePointCompare(a.k[i], b.k[i]);
        if (d) return d;
      }
      return 0;
    })
    .map((x) => x.row);
}
