/**
 * Refill D1 tables from an export (d1/export-data.mjs), in an order the foreign
 * keys accept. One implementation for both targets:
 *   • the real D1 copy over Cloudflare's HTTP API (d1/import.mjs, d1/rebuild.mjs)
 *   • a local node:sqlite rehearsal (d1/verify-import.mjs, d1/rebuild.mjs --local, tests)
 * so the local proof exercises exactly the code that will touch D1.
 *
 * `run(sql, params)` executes one statement and returns its rows (async or not).
 *
 * Why the order matters — D1 enforces foreign keys on every query, and the
 * refresh used to DELETE and INSERT table by table alphabetically:
 *   • DELETE FROM agencies ran before organizations → refused (NO ACTION);
 *   • DELETE FROM organizations would CASCADE into candidate_organizations rows
 *     already re-imported, silently emptying them;
 *   • INSERT INTO candidate_organizations before organizations → FK failure.
 * PRAGMA defer_foreign_keys cannot help: it ends with the transaction, and each
 * chunk below is its own HTTP request. So: children emptied first, parents
 * filled first, and the table set closed over dependents (see d1/fk.mjs).
 */
import fs from "node:fs";
import path from "node:path";
import { deleteOrder, insertOrder, withDependents, findOrphans } from "./fk.mjs";

const MAX_PARAMS = 90;            // D1 allows 100 bound parameters per statement
const MAX_BYTES = 400_000;        // keep each request comfortably small

/**
 * Is `target` the directory `root` or anywhere below it? Exports hold candidate
 * personal data and must never land in a git worktree. A plain string prefix
 * test got this wrong both ways: "…/wt-schema-export" starts with "…/wt-schema".
 */
export function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** The columns an export row holds, in order (generated columns are computed, never sent). */
export function tableColumns(types, table) {
  return Object.entries(types[table].columns).filter(([, c]) => !c.generated).map(([n]) => n);
}

/**
 * What an import of `requested` (all exported tables when empty) will do —
 * no IO beyond the counts. `refused` lists why it must not start.
 */
export function planImport(types, counts, requested = []) {
  const exported = (t) => counts[t] !== undefined && counts[t] !== "skipped";
  const base = requested.length ? requested : Object.keys(types).filter(exported);
  const refused = [];
  for (const t of base) if (!types[t]) refused.push(`${t}: not a table in d1/types.json`);
  const known = base.filter((t) => types[t]);
  const tables = withDependents(types, known);
  const added = tables.filter((t) => !known.includes(t));
  for (const t of tables) {
    if (!exported(t)) {
      refused.push(known.includes(t)
        ? `${t}: not in the export`
        : `${t}: its rows reference a table being refreshed (emptying the parent would cascade into it), but it was not exported`);
    }
  }
  return {
    tables,
    added,
    refused,
    deleteOrder: refused.length ? [] : deleteOrder(types, tables),
    insertOrder: refused.length ? [] : insertOrder(types, tables),
  };
}

/**
 * Everything that can be known before a single write: the plan and the orphan
 * check. An export with orphans would fail halfway, after tables were emptied.
 */
export function preflight({ types, dir, requested = [] }) {
  const counts = JSON.parse(fs.readFileSync(path.join(dir, "_counts.json"), "utf8"));
  const plan = planImport(types, counts, requested);
  const cache = new Map();
  const rowsOf = (t) => {
    if (!cache.has(t)) {
      const file = path.join(dir, `${t}.json`);
      cache.set(t, counts[t] !== undefined && counts[t] !== "skipped" && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined);
    }
    return cache.get(t);
  };
  const orphans = plan.refused.length ? [] : findOrphans(types, plan.tables, rowsOf, (t) => tableColumns(types, t));
  return { counts, rowsOf, plan, orphans };
}

export async function importTables({ run, types, dir, requested = [], log = console.log }) {
  const { counts, rowsOf, plan, orphans } = preflight({ types, dir, requested });
  if (plan.refused.length) {
    for (const r of plan.refused) log(`!! ${r}`);
    return { problems: plan.refused.length, plan, orphans };
  }
  if (orphans.length) {
    for (const o of orphans) log(`!! ${o.table}.${o.column} → ${o.parent}.${o.ref}: ${o.count} row(s), ${o.reason}`);
    log("!! nothing was changed — re-export (the export reads one table at a time, so a write in between can leave this) and retry");
    return { problems: orphans.length, plan, orphans };
  }
  if (plan.added.length) log(`also refreshing ${plan.added.join(", ")} — their rows reference a table being refreshed`);

  let problems = 0;
  for (const table of plan.deleteOrder) await run(`DELETE FROM "${table}"`);

  for (const table of plan.insertOrder) {
    const cols = tableColumns(types, table);
    const rows = rowsOf(table);
    const perStatement = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
    const placeholders = (n) => Array.from({ length: n }, () => `(${cols.map(() => "?").join(",")})`).join(",");
    let sent = 0;
    for (let i = 0; i < rows.length; ) {
      const chunk = [];
      let bytes = 0;
      while (i < rows.length && chunk.length < perStatement) {
        const vals = rows[i];
        const size = vals.reduce((n, v) => n + (typeof v === "string" ? v.length : 8), 0);
        if (chunk.length && bytes + size > MAX_BYTES) break;
        chunk.push(vals); bytes += size; i++;
      }
      const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders(chunk.length)}`;
      try {
        await run(sql, chunk.flat());
        sent += chunk.length;
      } catch (e) {
        log(`!! ${table}: ${String(e.message).slice(0, 200)}`);
        problems++;
        break;
      }
    }
    const [{ n: got }] = await run(`SELECT count(*) AS n FROM "${table}"`);
    const want = Number(counts[table]);
    if (Number(got) !== want) { log(`!! ${table}: expected ${want}, has ${got}`); problems++; }
    else log(`ok  ${table}: ${got}`);
    if (sent !== rows.length) log(`   (sent ${sent} of ${rows.length})`);
  }
  return { problems, plan, orphans };
}

/** A node:sqlite database as a `run` function (foreign keys ON, as on D1). */
export function sqliteRunner(db) {
  db.exec("PRAGMA foreign_keys = ON");
  return (sql, params = []) => {
    const stmt = db.prepare(sql);
    return /^\s*(select|pragma|with)\b/i.test(sql) ? stmt.all(...params) : (stmt.run(...params), []);
  };
}
