/**
 * Supabase (Postgres) → Cloudflare D1 (SQLite) schema generator.
 *
 * Reads two structure snapshots of the LIVE database — never the data:
 *   d1/snapshot/openapi.json   PostgREST OpenAPI: tables, columns, types,
 *                              NOT NULL, scalar defaults, primary keys
 *   d1/snapshot/catalog-*.json the Postgres catalog (supabase/catalog_capture.sql):
 *                              CHECKs, indexes, triggers, foreign keys WITH their
 *                              ON DELETE / ON UPDATE actions, every column default
 * and writes:
 *   d1/schema.sql   CREATE TABLE / INDEX / TRIGGER for D1 (generated — do not hand-edit)
 *   d1/types.json   per-table registry for the query adapter and the copy tools:
 *                   column types (booleans 0/1, JSON as text, timestamps …),
 *                   defaults, primary key, foreign keys
 *
 * Run: node d1/gen-schema.mjs [--catalog d1/snapshot/<file>.json]
 * (tests/d1Schema.test.ts loads the output into a real SQLite and checks it
 * behaves like the Postgres original).
 *
 * Two catalog shapes are accepted: the v1 capture (d1/snapshot/catalog.json —
 * arrays, no foreign keys, no defaults) and the v2 capture (objects, plus
 * foreign_keys and column_defaults). With a v1 catalog no FOREIGN KEY is
 * emitted: without the captured action, guessing CASCADE vs RESTRICT wrong
 * silently changes what a delete does.
 *
 * Deliberately NOT emitted:
 *   • Foreign keys to auth.users — the auth tables are not in D1 (logins stay on
 *     Supabase for now), and SQLite rejects a write against a missing parent.
 *     They are recorded per table in types.json `authFks` (column, ref, action)
 *     so a future user-delete can do by hand what Postgres did by cascade.
 *   • Row-level security — D1 has none and needs none: only our server can
 *     reach it (there is no public URL); access rules live in the API routes.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Postgres `timestamptz` text as PostgREST returns it: 6-digit fraction + offset. */
const nowExpr = (modifier) =>
  `(strftime('%Y-%m-%dT%H:%M:%f','now'${modifier ? `,${lit(modifier)}` : ""}) || '000+00:00')`;
/** RFC 4122 v4 UUID, lowercase — what gen_random_uuid() produces. */
export const UUID_EXPR =
  "(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || " +
  "substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))";

/** Generated columns (Postgres GENERATED ALWAYS … STORED) — not visible in OpenAPI. */
const GENERATED = {
  messages: {
    // supabase/chat_attachments_r2.sql
    has_attachment: `CASE WHEN "attachment_key" IS NOT NULL OR ("attachment" IS NOT NULL AND "attachment" <> '') THEN 1 ELSE 0 END`,
  },
};

/** pg_constraint confdeltype / confupdtype letter → SQL action. */
export const FK_ACTIONS = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

/** OpenAPI property → one of our Postgres kinds. */
export function pgKind(p) {
  const f = p.format ?? "";
  if (f === "timestamp with time zone" || f === "timestamp without time zone") return "timestamptz";
  if (["uuid", "text", "date", "boolean", "integer", "bigint", "numeric", "jsonb", "json", "text[]", "uuid[]"].includes(f)) return f === "json" ? "jsonb" : f;
  if (f === "character varying" || f === "character") return "text";
  if (f === "smallint") return "integer";
  if (f === "double precision" || f === "real") return "numeric";
  return null;
}

function sqliteType(kind) {
  if (kind === "boolean" || kind === "integer" || kind === "bigint") return "INTEGER";
  if (kind === "numeric") return "REAL";
  return "TEXT";
}

/**
 * Both catalog captures → one shape. v1 stored rows as arrays, v2 as objects.
 * `fkCatalog` is false for v1: it never captured foreign keys, and treating
 * "none captured" as "there are none" would drop every constraint silently.
 */
export function normalizeCatalog(cat) {
  const row = (r, keys) => (Array.isArray(r) ? Object.fromEntries(keys.map((k, i) => [k, r[i]])) : r);
  return {
    checks: (cat.checks ?? []).map((r) => row(r, ["t", "n", "d"])),
    indexes: (cat.indexes ?? []).map((r) => row(r, ["t", "d"])),
    triggers: (cat.triggers ?? []).map((r) => row(r, ["t", "n", "when", "on", "do"])),
    foreignKeys: cat.foreign_keys ?? [],
    columnDefaults: cat.column_defaults ?? [],
    fkCatalog: Array.isArray(cat.foreign_keys),
  };
}

/**
 * A Postgres catalog default (pg_get_expr text, e.g. `'[]'::jsonb`) → the value
 * PostgREST's OpenAPI would have shown, so the registry keeps ONE representation
 * that both translateDefault() here and lib/d1/pgrest/buildSql columnDefaultSql()
 * already read. Returns { value } | { identity: true } | { warning }.
 *
 * Why this exists: PostgREST's OpenAPI omits every jsonb / array default. The
 * copy then had NOT NULL jsonb columns with no DEFAULT, so an insert that left
 * them out — `candidate_profiles` upserts on user_id, 27 call sites — failed
 * with 23502 on D1 while Supabase filled in '[]'.
 */
export function catalogDefault(expr, kind) {
  if (expr === "now()" || expr === "gen_random_uuid()") return { value: expr };
  if (/^nextval\('[^']+'::regclass\)$/.test(expr)) return { identity: true };
  if (/^\(now\(\) \+ '[^']+'::interval\)$/.test(expr)) return { value: expr };
  if (expr === "true" || expr === "false") return { value: expr === "true" };
  if (/^-?\d+(\.\d+)?$/.test(expr)) return { value: Number(expr) };
  const quoted = expr.match(/^'((?:[^']|'')*)'::([a-z ]+(?:\[\])?)$/);
  if (quoted) {
    const text = quoted[1].replace(/''/g, "'");
    const cast = quoted[2];
    if (kind === "jsonb") {
      try { JSON.parse(text); } catch { return { warning: `jsonb default is not JSON: ${expr}` }; }
      return { value: text };
    }
    if (kind === "text[]" || kind === "uuid[]") return text === "{}" ? { value: "{}" } : { warning: `array default: ${expr}` };
    if (["text", "character varying", "date", "uuid"].includes(cast)) return { value: text };
    if (["integer", "bigint", "numeric"].includes(cast) && /^-?\d+(\.\d+)?$/.test(text)) return { value: Number(text) };
  }
  return { warning: `catalog default not understood: ${expr}` };
}

/** Translate a column default; returns [sql|null, warning|null]. */
function translateDefault(def, kind) {
  if (def === undefined) return [null, null];
  if (def === "now()") return [nowExpr(), null];
  if (def === "gen_random_uuid()") return [UUID_EXPR, null];
  const iv = typeof def === "string" && def.match(/^\(now\(\) \+ '([^']+)'::interval\)$/);
  if (iv) {
    const hms = iv[1].match(/^(\d+):(\d+):(\d+)$/);
    if (hms) return [nowExpr(`+${(+hms[1]) * 3600 + (+hms[2]) * 60 + (+hms[3])} seconds`), null];
    const unit = iv[1].match(/^(\d+) (second|minute|hour|day|month|year)s?$/);
    if (unit) return [nowExpr(`+${unit[1]} ${unit[2]}s`), null];
    return [null, `interval default not understood: ${def}`];
  }
  if (typeof def === "boolean") return [def ? "1" : "0", null];
  if (typeof def === "number") return [String(def), null];
  if (typeof def === "string") {
    if (kind === "text[]" || kind === "uuid[]") return def === "{}" ? ["'[]'", null] : [null, `array default: ${def}`];
    if (kind === "jsonb") return [lit(def), null];
    if (/\(|::/.test(def)) return [null, `expression default not translated: ${def}`];
    if ((kind === "integer" || kind === "bigint" || kind === "numeric") && /^-?\d+(\.\d+)?$/.test(def)) return [def, null];
    return [lit(def), null];
  }
  return [null, `default not understood: ${JSON.stringify(def)}`];
}

/** Postgres expression (CHECK / index predicate) → SQLite. */
export function pgExprToSqlite(e) {
  return e
    .replace(/::(?:text|bigint|integer|numeric|uuid|jsonb|boolean|date|timestamp with time zone|character varying)(?:\[\])?/g, "")
    .replace(/= ANY \(ARRAY\[([^\]]*)\]\)/g, (_, list) => `IN (${list})`)
    .replace(/<> ALL \(ARRAY\[([^\]]*)\]\)/g, (_, list) => `NOT IN (${list})`)
    .replace(/\bchar_length\(/g, "length(")
    .replace(/\btrue\b/g, "1")
    .replace(/\bfalse\b/g, "0");
}

export function buildSchema(api, rawCatalog) {
  const cat = normalizeCatalog(rawCatalog);
  const warnings = [];
  const types = {};
  const out = [
    "-- GENERATED by d1/gen-schema.mjs from the live Supabase structure snapshots.",
    "-- Do not edit by hand: change the generator (or re-capture the snapshots) and re-run it.",
    "",
  ];
  const group = (rows) => {
    const by = new Map();
    for (const r of rows) (by.get(r.t) ?? by.set(r.t, []).get(r.t)).push(r);
    return by;
  };
  const checksBy = group(cat.checks);
  const fksBy = group(cat.foreignKeys);
  const defaultsBy = new Map(cat.columnDefaults.map((d) => [`${d.t}.${d.c}`, d.d]));
  for (const d of cat.columnDefaults) {
    if (!api.definitions[d.t]?.properties?.[d.c]) warnings.push(`catalog default for a column OpenAPI does not have: ${d.t}.${d.c} (snapshots out of step?)`);
  }

  // Primary keys and plain unique indexes, to prove every FK target is a key —
  // SQLite accepts a FOREIGN KEY to a non-unique column at CREATE time and only
  // fails later, on the first write, with "foreign key mismatch".
  const pkOf = (t) => Object.entries(api.definitions[t]?.properties ?? {}).filter(([, p]) => /<pk\/>/.test(p.description ?? "")).map(([c]) => c);
  const uniqueKeys = new Map();
  for (const { t, d } of cat.indexes) {
    const m = d.match(/^CREATE UNIQUE INDEX \S+ ON public\.\S+ USING btree \(([^()]+)\)$/);
    if (m) (uniqueKeys.get(t) ?? uniqueKeys.set(t, []).get(t)).push(m[1].split(",").map((s) => s.trim()).join(","));
  }
  const isKey = (t, cols) => pkOf(t).join(",") === cols.join(",") || (uniqueKeys.get(t) ?? []).includes(cols.join(","));

  for (const table of Object.keys(api.definitions).sort()) {
    const def = api.definitions[table];
    const props = def.properties ?? {};
    const required = new Set(def.required ?? []);
    const pk = pkOf(table);
    const gen = GENERATED[table] ?? {};
    const reg = { columns: {}, pk, fks: [] };
    const lines = [];
    const singleIntPk = pk.length === 1 && ["integer", "bigint"].includes(pgKind(props[pk[0]]) ?? "");

    for (const [col, p] of Object.entries(props)) {
      const kind = pgKind(p);
      if (!kind) warnings.push(`${table}.${col}: unknown type ${p.format}/${p.type} → TEXT`);
      const k = kind ?? "text";
      if (!cat.fkCatalog) {
        const fk = (p.description ?? "").match(/<fk table='([^']+)' column='([^']+)'\/>/);
        if (fk) reg.fks.push({ column: col, table: fk[1], ref: fk[2] });
      }

      // OpenAPI's default when it shows one; otherwise the catalog's.
      let dflt = p.default;
      const catalogExpr = defaultsBy.get(`${table}.${col}`);
      if (dflt === undefined && catalogExpr !== undefined) {
        const c = catalogDefault(catalogExpr, k);
        if (c.warning) warnings.push(`${table}.${col}: ${c.warning}`);
        else if (c.identity) {
          if (!(singleIntPk && col === pk[0])) warnings.push(`${table}.${col}: sequence default on a column that is not the integer key`);
        } else dflt = c.value;
      }
      reg.columns[col] = { pg: k, nullable: !required.has(col), default: dflt ?? null, generated: !!gen[col] };

      if (gen[col]) {
        lines.push(`  ${q(col)} INTEGER GENERATED ALWAYS AS (${gen[col]}) VIRTUAL`);
        continue;
      }
      if (singleIntPk && col === pk[0]) {
        lines.push(`  ${q(col)} INTEGER PRIMARY KEY AUTOINCREMENT`);
        continue;
      }
      let line = `  ${q(col)} ${sqliteType(k)}`;
      if (required.has(col)) line += " NOT NULL";
      const [d, w] = translateDefault(dflt, k);
      if (w) warnings.push(`${table}.${col}: ${w}`);
      if (d !== null) line += ` DEFAULT ${d}`;
      if (k === "boolean") line += ` CHECK (${q(col)} IN (0, 1))`;
      if (k === "jsonb" || k === "text[]" || k === "uuid[]") line += ` CHECK (${q(col)} IS NULL OR json_valid(${q(col)}))`;
      lines.push(line);
    }
    if (pk.length && !singleIntPk) lines.push(`  PRIMARY KEY (${pk.map(q).join(", ")})`);

    const authFks = [];
    for (const fk of [...(fksBy.get(table) ?? [])].sort((a, b) => a.n.localeCompare(b.n))) {
      const onDelete = FK_ACTIONS[fk.on_delete], onUpdate = FK_ACTIONS[fk.on_update];
      if (!onDelete || !onUpdate) { warnings.push(`${table}.${fk.n}: unknown FK action ${fk.on_delete}/${fk.on_update}`); continue; }
      const missingCol = fk.cols.find((c) => !props[c]);
      if (missingCol) { warnings.push(`${table}.${fk.n}: column ${missingCol} not in OpenAPI`); continue; }
      const entry = { column: fk.cols[0], table: fk.ref, ref: fk.refcols[0], on_delete: onDelete, on_update: onUpdate, name: fk.n };
      if (fk.cols.length > 1) { entry.columns = fk.cols; entry.refs = fk.refcols; }
      if (fk.ref === "auth.users") { authFks.push(entry); continue; }
      if (fk.ref.includes(".")) { warnings.push(`${table}.${fk.n}: references ${fk.ref}, outside public and not auth.users`); continue; }
      if (!api.definitions[fk.ref]) { warnings.push(`${table}.${fk.n}: references unknown table ${fk.ref}`); continue; }
      if (!isKey(fk.ref, fk.refcols)) { warnings.push(`${table}.${fk.n}: ${fk.ref}(${fk.refcols}) is not a primary key or unique index`); continue; }
      if (onDelete === "SET NULL" && fk.cols.some((c) => required.has(c))) warnings.push(`${table}.${fk.n}: ON DELETE SET NULL on a NOT NULL column`);
      lines.push(
        `  CONSTRAINT ${q(fk.n)} FOREIGN KEY (${fk.cols.map(q).join(", ")}) REFERENCES ${q(fk.ref)} (${fk.refcols.map(q).join(", ")})` +
        ` ON DELETE ${onDelete} ON UPDATE ${onUpdate}`,
      );
      reg.fks.push(entry);
    }
    if (authFks.length) reg.authFks = authFks;

    for (const { n: name, d: chk } of checksBy.get(table) ?? []) {
      const inner = chk.replace(/^CHECK\s*/, "");
      lines.push(`  CONSTRAINT ${q(name)} CHECK ${pgExprToSqlite(inner)}`);
    }
    out.push(`CREATE TABLE IF NOT EXISTS ${q(table)} (\n${lines.join(",\n")}\n);`);
    types[table] = reg;
  }
  for (const t of fksBy.keys()) if (!api.definitions[t]) warnings.push(`foreign keys on unknown table ${t}`);
  for (const t of checksBy.keys()) if (!api.definitions[t]) warnings.push(`checks on unknown table ${t}`);

  out.push("");
  for (const { t: table, d: idx } of cat.indexes) {
    const m = idx.match(/^CREATE (UNIQUE )?INDEX (\S+) ON public\.(\S+) USING btree (.+)$/);
    if (!m) { warnings.push(`index not understood: ${idx}`); continue; }
    if (m[2].endsWith("_pkey")) continue; // primary key already declared on the table
    if (!types[m[3]]) { warnings.push(`index on unknown table ${m[3]} (${table})`); continue; }
    out.push(`CREATE ${m[1] ?? ""}INDEX IF NOT EXISTS ${q(m[2])} ON ${q(m[3])} ${pgExprToSqlite(m[4])};`);
  }

  out.push("");
  for (const { t: table, n: name, when, on } of cat.triggers) {
    const cols = types[table]?.columns ?? {};
    if (name === "employers_set_updated_at" && when === "BEFORE" && on === "UPDATE" && cols.updated_at && cols.id) {
      // Postgres: BEFORE UPDATE sets NEW.updated_at = now(). SQLite can't edit
      // NEW, so touch the row after the update unless the caller set it.
      out.push(
        `CREATE TRIGGER IF NOT EXISTS ${q(name)} AFTER UPDATE ON ${q(table)} FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at"\n` +
        `BEGIN UPDATE ${q(table)} SET "updated_at" = ${nowExpr()} WHERE "id" = NEW."id"; END;`,
      );
    } else {
      warnings.push(`trigger not translated: ${table}.${name}`);
    }
  }
  out.push("");
  return { sql: out.join("\n"), types, warnings };
}

/** The catalog the committed schema is generated from. */
export const CURRENT_CATALOG = "snapshot/catalog-2026-09-13.json";

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = new URL(".", import.meta.url);
  const i = process.argv.indexOf("--catalog");
  const catalogPath = i > 0 ? new URL(process.argv[i + 1], new URL(`file:///${process.cwd().replace(/\\/g, "/")}/`)) : new URL(CURRENT_CATALOG, dir);
  const api = JSON.parse(fs.readFileSync(new URL("snapshot/openapi.json", dir), "utf8"));
  const cat = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const { sql, types, warnings } = buildSchema(api, cat);
  fs.writeFileSync(new URL("schema.sql", dir), sql);
  fs.writeFileSync(new URL("types.json", dir), JSON.stringify(types, null, 1) + "\n");
  const fkCount = Object.values(types).reduce((n, t) => n + t.fks.length, 0);
  const authCount = Object.values(types).reduce((n, t) => n + (t.authFks?.length ?? 0), 0);
  console.log(`tables: ${Object.keys(types).length}  foreign keys: ${fkCount} (+${authCount} to auth.users, recorded only)  warnings: ${warnings.length}`);
  for (const w of warnings) console.log("  ! " + w);
}
