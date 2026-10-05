/**
 * The foreign-key graph of the D1 copy, and the orders it forces on anything
 * that empties or refills tables.
 *
 * D1 enforces foreign keys on every query (PRAGMA foreign_keys cannot be turned
 * off), and PRAGMA defer_foreign_keys only lasts until the end of the current
 * transaction. The import sends each chunk of rows as its own HTTP request, so
 * deferral cannot span it. What stays correct over the HTTP API is ORDER:
 *   • empty children before parents — `DELETE FROM organizations` first would
 *     CASCADE into organization_members rows already imported, or refuse
 *     outright where the child is NO ACTION (agencies ← organizations);
 *   • fill parents before children — a candidate_organizations row inserted
 *     before its organization fails with "FOREIGN KEY constraint failed".
 *
 * Everything here reads d1/types.json (the generated registry): table → { fks }.
 * Pure functions, no IO — tests/d1ImportOrder.test.ts pins them.
 */

/** Every enforced foreign key: { table, column, parent, ref, on_delete }. */
export function edges(types) {
  const out = [];
  for (const [table, meta] of Object.entries(types)) {
    for (const fk of meta.fks ?? []) out.push({ table, column: fk.column, parent: fk.table, ref: fk.ref, on_delete: fk.on_delete ?? "NO ACTION" });
  }
  return out;
}

/**
 * Parents before children, restricted to `tables` (default: all). Ties break
 * alphabetically so the plan is the same on every run. Edges to tables outside
 * the set do not constrain it (those parents are already in place).
 *
 * A cycle — or a table referencing itself — has no safe row-by-row order across
 * separate requests; refuse loudly instead of importing half of it.
 */
export function insertOrder(types, tables = Object.keys(types)) {
  const set = new Set(tables);
  const parentsOf = new Map([...set].map((t) => [t, new Set()]));
  for (const e of edges(types)) {
    if (!set.has(e.table) || !set.has(e.parent)) continue;
    if (e.table === e.parent) throw new Error(`${e.table}.${e.column} references its own table — the import cannot order its rows across requests`);
    parentsOf.get(e.table).add(e.parent);
  }
  const order = [];
  const done = new Set();
  while (order.length < set.size) {
    const ready = [...set].filter((t) => !done.has(t) && [...parentsOf.get(t)].every((p) => done.has(p))).sort();
    if (!ready.length) {
      const stuck = [...set].filter((t) => !done.has(t)).sort();
      throw new Error(`foreign-key cycle among: ${stuck.join(", ")}`);
    }
    for (const t of ready) { order.push(t); done.add(t); }
  }
  return order;
}

/** Children before parents: the only safe order to empty or drop tables. */
export function deleteOrder(types, tables) {
  return insertOrder(types, tables).reverse();
}

/**
 * `tables` plus every table whose rows reference them, transitively. Emptying a
 * parent touches those rows (CASCADE deletes them, SET NULL blanks the column,
 * NO ACTION refuses) — so refreshing a parent alone would silently lose or
 * corrupt child rows the refresh never re-inserts.
 */
export function withDependents(types, tables) {
  const set = new Set(tables);
  const all = edges(types);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of all) {
      if (set.has(e.parent) && !set.has(e.table)) { set.add(e.table); grew = true; }
    }
  }
  return [...set].sort();
}

/**
 * Child values with no parent row in the same export. Postgres never holds such
 * a row, but the export reads one table at a time over minutes, so a parent
 * deleted (or a child created) between two table reads leaves one. Importing it
 * would fail halfway through, after the tables were already emptied — so the
 * import checks first and refuses. Counts only: the values are personal data.
 *
 * `rowsOf(table)` returns the exported rows (arrays in `columnsOf(table)` order)
 * or undefined when the table was not exported.
 */
export function findOrphans(types, tables, rowsOf, columnsOf) {
  const problems = [];
  const keyCache = new Map();
  const parentKeys = (parent, ref) => {
    const id = `${parent}.${ref}`;
    if (keyCache.has(id)) return keyCache.get(id);
    const rows = rowsOf(parent);
    const idx = columnsOf(parent).indexOf(ref);
    const keys = rows && idx >= 0 ? new Set(rows.map((r) => r[idx]).filter((v) => v !== null).map(String)) : null;
    keyCache.set(id, keys);
    return keys;
  };
  const set = new Set(tables);
  for (const e of edges(types)) {
    if (!set.has(e.table)) continue;
    const rows = rowsOf(e.table);
    if (!rows) continue;
    const idx = columnsOf(e.table).indexOf(e.column);
    const keys = parentKeys(e.parent, e.ref);
    const refs = rows.map((r) => r[idx]).filter((v) => v !== null && v !== undefined);
    if (!refs.length) continue;
    if (!keys) { problems.push({ ...e, count: refs.length, reason: `parent table ${e.parent} was not exported` }); continue; }
    const count = refs.filter((v) => !keys.has(String(v))).length;
    if (count) problems.push({ ...e, count, reason: "no matching parent row in the export" });
  }
  return problems;
}

/**
 * d1/schema.sql → one statement per entry. The D1 HTTP API takes one statement
 * per bound request, and a failure then names the exact table or index. Splits
 * only where the generator ends a statement (";" at end of line, outside a
 * quoted string) — the trigger body's inner "…; END;" stays whole.
 */
export function splitStatements(sql) {
  const out = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    cur += ch;
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "-" && sql[i + 1] === "-" && cur.trim() === "-") {
      // A comment line on its own: drop it.
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl;
      cur = "";
      continue;
    }
    if (ch === ";" && (sql[i + 1] === "\n" || sql[i + 1] === "\r" || i + 1 === sql.length)) {
      const s = cur.trim();
      if (s && s !== ";") out.push(s);
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
