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
 *
 * @param {Record<string, any>} types
 * @param {Record<string, number | string>} counts
 * @param {string[]} [requested]
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
 * Rows that repeat a primary key, per table (counts only). The export pages with
 * offset over a live table; a row inserted mid-read shifts the next page and the
 * last row of one page comes back again. Imported, that is a UNIQUE failure
 * halfway through — after the tables were emptied.
 */
export function duplicateKeys(types, tables, rowsOf) {
  const out = [];
  for (const t of tables) {
    const rows = rowsOf(t);
    const pk = types[t].pk ?? [];
    if (!rows || !pk.length) continue;
    const idx = pk.map((c) => tableColumns(types, t).indexOf(c));
    if (idx.some((i) => i < 0)) continue;
    const seen = new Set();
    let n = 0;
    for (const r of rows) {
      const k = JSON.stringify(idx.map((i) => r[i]));
      if (seen.has(k)) n++; else seen.add(k);
    }
    if (n) out.push({ table: t, count: n });
  }
  return out;
}

/**
 * Everything that can be known before a single write. `refusals` is every
 * reason the import must not start, as log lines without row values:
 *   • the plan's own refusals (unknown or unexported tables);
 *   • the export was taken with a different d1/types.json — its rows are
 *     positional arrays, so a column added or reordered since would shift every
 *     value into the wrong column without a single error;
 *   • a row file missing or not holding the count recorded for it;
 *   • tables export-data.mjs could not read consistently (_meta.json unstable);
 *   • duplicate primary keys, and orphan child rows.
 * `requireMeta` refuses exports older than _meta.json (the rebuild insists).
 *
 * @param {{ types: Record<string, any>, dir: string, requested?: string[], requireMeta?: boolean }} opts
 */
export function preflight({ types, dir, requested = [], requireMeta = false }) {
  const counts = JSON.parse(fs.readFileSync(path.join(dir, "_counts.json"), "utf8"));
  const metaFile = path.join(dir, "_meta.json");
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : null;
  const plan = planImport(types, counts, requested);
  const cache = new Map();
  const rowsOf = (t) => {
    if (!cache.has(t)) {
      const file = path.join(dir, `${t}.json`);
      cache.set(t, counts[t] !== undefined && counts[t] !== "skipped" && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined);
    }
    return cache.get(t);
  };

  const refusals = [...plan.refused];
  let orphans = [];
  if (!plan.refused.length) {
    if (!meta && requireMeta) refusals.push("_meta.json missing: the export predates column tracking — re-export with d1/export-data.mjs");
    for (const t of plan.tables) {
      if (meta?.columns) {
        const want = tableColumns(types, t), got = meta.columns[t];
        if (!got) refusals.push(`${t}: no column list in _meta.json — re-export`);
        else if (JSON.stringify(got) !== JSON.stringify(want)) {
          const added = want.filter((c) => !got.includes(c)), gone = got.filter((c) => !want.includes(c));
          refusals.push(`${t}: exported columns differ from d1/types.json (${added.length ? `new: ${added.join(",")}` : ""}${added.length && gone.length ? "; " : ""}${gone.length ? `gone: ${gone.join(",")}` : ""}${!added.length && !gone.length ? "order changed" : ""}) — re-export`);
        }
      }
      if ((meta?.unstable ?? []).includes(t)) refusals.push(`${t}: its row count kept changing while it was exported — re-export`);
      const rows = rowsOf(t);
      if (!rows) refusals.push(`${t}: ${t}.json missing from the export`);
      else if (rows.length !== Number(counts[t])) refusals.push(`${t}: _counts.json says ${counts[t]}, ${t}.json holds ${rows.length}`);
    }
    if (refusals.length === plan.refused.length) {
      for (const d of duplicateKeys(types, plan.tables, rowsOf)) {
        refusals.push(`${d.table}: ${d.count} row(s) repeat a primary key (rows were written while it was paged) — re-export`);
      }
      orphans = findOrphans(types, plan.tables, rowsOf, (t) => tableColumns(types, t));
      for (const o of orphans) refusals.push(`${o.table}.${o.column} → ${o.parent}.${o.ref}: ${o.count} row(s), ${o.reason}`);
    }
  }
  return { counts, meta, rowsOf, plan, orphans, refusals };
}

/**
 * @param {{ run: (sql: string, params?: unknown[]) => any, types: Record<string, any>, dir: string, requested?: string[], log?: (m: string) => void }} opts
 */
export async function importTables({ run, types, dir, requested = [], log = console.log }) {
  const { counts, rowsOf, plan, orphans, refusals } = preflight({ types, dir, requested });
  if (refusals.length) {
    for (const r of refusals) log(`!! ${r}`);
    if (!plan.refused.length) log("!! nothing was changed — re-export (the export reads one table at a time, so a write in between can leave this) and retry");
    return { problems: refusals.length, plan, orphans };
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
