/**
 * Supabase (Postgres) → Cloudflare D1 (SQLite) schema generator.
 *
 * Step 2 groundwork of the migration ("copy onto Cloudflare, don't switch").
 * Reads the two structure snapshots of the LIVE database — never the data:
 *   d1/snapshot/openapi.json  PostgREST OpenAPI: tables, columns, types,
 *                             NOT NULL, defaults, primary / foreign keys
 *   d1/snapshot/catalog.json  CHECK constraints, indexes, triggers
 * and writes:
 *   d1/schema.sql   CREATE TABLE / INDEX / TRIGGER for D1 (generated — do not hand-edit)
 *   d1/types.json   per-column Postgres type registry, for the query adapter's
 *                   value encoding (booleans 0/1, JSON as text, timestamps …)
 *
 * Run: node d1/gen-schema.mjs     (tests/d1Schema.test.ts loads the output
 * into a real SQLite and checks it behaves like the Postgres original).
 *
 * Deliberately NOT emitted yet:
 *   • FOREIGN KEY constraints — the snapshot does not say ON DELETE behaviour
 *     (cascade vs restrict), and guessing wrong silently changes what a delete
 *     does. Recorded in types.json; added once the FK actions are captured.
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

export function buildSchema(api, cat) {
  const warnings = [];
  const types = {};
  const out = [
    "-- GENERATED by d1/gen-schema.mjs from the live Supabase structure snapshots.",
    "-- Do not edit by hand: change the generator (or re-capture the snapshots) and re-run it.",
    "",
  ];
  const checksBy = new Map();
  for (const [t, name, def] of cat.checks ?? []) (checksBy.get(t) ?? checksBy.set(t, []).get(t)).push([name, def]);

  for (const table of Object.keys(api.definitions).sort()) {
    const def = api.definitions[table];
    const props = def.properties ?? {};
    const required = new Set(def.required ?? []);
    const pk = Object.entries(props).filter(([, p]) => /<pk\/>/.test(p.description ?? "")).map(([c]) => c);
    const gen = GENERATED[table] ?? {};
    const reg = { columns: {}, pk, fks: [] };
    const lines = [];
    const singleIntPk = pk.length === 1 && ["integer", "bigint"].includes(pgKind(props[pk[0]]) ?? "");

    for (const [col, p] of Object.entries(props)) {
      const kind = pgKind(p);
      if (!kind) warnings.push(`${table}.${col}: unknown type ${p.format}/${p.type} → TEXT`);
      const k = kind ?? "text";
      const fk = (p.description ?? "").match(/<fk table='([^']+)' column='([^']+)'\/>/);
      if (fk) reg.fks.push({ column: col, table: fk[1], ref: fk[2] });
      reg.columns[col] = { pg: k, nullable: !required.has(col), default: p.default ?? null, generated: !!gen[col] };

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
      const [d, w] = translateDefault(p.default, k);
      if (w) warnings.push(`${table}.${col}: ${w}`);
      if (d !== null) line += ` DEFAULT ${d}`;
      if (k === "boolean") line += ` CHECK (${q(col)} IN (0, 1))`;
      if (k === "jsonb" || k === "text[]" || k === "uuid[]") line += ` CHECK (${q(col)} IS NULL OR json_valid(${q(col)}))`;
      lines.push(line);
    }
    if (pk.length && !singleIntPk) lines.push(`  PRIMARY KEY (${pk.map(q).join(", ")})`);
    for (const [name, chk] of checksBy.get(table) ?? []) {
      const inner = chk.replace(/^CHECK\s*/, "");
      lines.push(`  CONSTRAINT ${q(name)} CHECK ${pgExprToSqlite(inner)}`);
    }
    out.push(`CREATE TABLE IF NOT EXISTS ${q(table)} (\n${lines.join(",\n")}\n);`);
    types[table] = reg;
  }

  out.push("");
  for (const [table, idx] of cat.indexes ?? []) {
    const m = idx.match(/^CREATE (UNIQUE )?INDEX (\S+) ON public\.(\S+) USING btree (.+)$/);
    if (!m) { warnings.push(`index not understood: ${idx}`); continue; }
    if (m[2].endsWith("_pkey")) continue; // primary key already declared on the table
    if (!types[m[3]]) { warnings.push(`index on unknown table ${m[3]}`); continue; }
    out.push(`CREATE ${m[1] ?? ""}INDEX IF NOT EXISTS ${q(m[2])} ON ${q(m[3])} ${pgExprToSqlite(m[4])};`);
  }

  out.push("");
  for (const [table, name, when, on] of cat.triggers ?? []) {
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

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = new URL(".", import.meta.url);
  const api = JSON.parse(fs.readFileSync(new URL("snapshot/openapi.json", dir), "utf8"));
  const cat = JSON.parse(fs.readFileSync(new URL("snapshot/catalog.json", dir), "utf8"));
  const { sql, types, warnings } = buildSchema(api, cat);
  fs.writeFileSync(new URL("schema.sql", dir), sql);
  fs.writeFileSync(new URL("types.json", dir), JSON.stringify(types, null, 1) + "\n");
  console.log(`tables: ${Object.keys(types).length}  warnings: ${warnings.length}`);
  for (const w of warnings) console.log("  ! " + w);
}
