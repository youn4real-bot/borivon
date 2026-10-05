/**
 * The gates every copy tool passes before it trusts its inputs or touches the
 * REAL D1: d1/rebuild.mjs, d1/import.mjs, d1/export-data.mjs, d1/check-drift.mjs.
 *
 * Each one answers a question a previous run got wrong or could have:
 *
 *   generatedProblems   Are d1/schema.sql + d1/types.json exactly what the
 *                       committed snapshots generate? `check-drift --update`
 *                       rewrites the snapshot but not the schema; the rebuild
 *                       then applied the OLD schema, the export read only the
 *                       OLD columns, and a new live column was silently absent
 *                       from D1 while every gate said ok.
 *   backendProblems     Does the site still read Supabase? After the Day-2
 *                       switch (DATA_BACKEND="d1") D1 is the primary: a rebuild
 *                       or refresh from a Supabase export would erase every row
 *                       written since, and parity would only say so afterwards.
 *   exportAgeProblems   Is the export recent? An old export is missing every
 *                       write since it was taken.
 *   d1NewerRows         Does D1 hold rows the export does not know about? The
 *                       data-level proof, independent of any config file: it
 *                       catches a switch nobody wrote down.
 *
 * All of them READ ONLY. Output is table names and counts — never row values.
 */
import fs from "node:fs";
import path from "node:path";
import { buildSchema, CURRENT_CATALOG } from "./gen-schema.mjs";
import { tableColumns } from "./importCore.mjs";

/** Minutes an export may age before a write to the real D1 refuses it. */
export const MAX_EXPORT_AGE_MIN = 30;

const lf = (s) => s.replace(/\r\n/g, "\n");

/** `.env.local` → { KEY: value }. Throws when the file cannot be read. */
export function readEnvFile(root) {
  return Object.fromEntries(
    fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
  );
}

/**
 * Regenerate the schema in memory and compare it with the committed files.
 * Returns the reasons they are stale ([] = current). Throws when the inputs
 * cannot be read — callers decide whether that means "refuse" or "could not check".
 *
 * CRLF is normalised first: with core.autocrlf=true Windows checks types.json
 * out with CRLF, and a byte comparison called an unchanged file stale.
 */
export function generatedProblems(root) {
  const d1 = path.join(root, "d1");
  const read = (f) => fs.readFileSync(path.join(d1, f), "utf8");
  const built = buildSchema(JSON.parse(read("snapshot/openapi.json")), JSON.parse(read(CURRENT_CATALOG)));
  const out = built.warnings.map((w) => `generator warning: ${w}`);
  if (lf(read("schema.sql")) !== built.sql) out.push("d1/schema.sql is not what d1/snapshot/openapi.json + the catalog generate");
  if (lf(read("types.json")) !== JSON.stringify(built.types, null, 1) + "\n") out.push("d1/types.json is not what d1/snapshot/openapi.json + the catalog generate");
  // A newer capture saved next to the current one but never wired in would
  // otherwise pass: the comparison above only reads CURRENT_CATALOG.
  const current = path.basename(CURRENT_CATALOG);
  const newer = fs.readdirSync(path.join(d1, "snapshot")).filter((f) => /^catalog-\d{4}-\d{2}-\d{2}\.json$/.test(f) && f > current);
  if (newer.length) out.push(`a newer catalog capture exists (${newer.join(", ")}) but d1/gen-schema.mjs CURRENT_CATALOG is ${current}`);
  if (out.length) out.push("fix: node d1/gen-schema.mjs (after updating CURRENT_CATALOG if needed), review the diff, commit");
  return out;
}

/** wrangler.jsonc text → object (comments and trailing commas removed; strings kept intact). */
export function parseJsonc(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") { out += text[++i] ?? ""; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (ch === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 1; continue; }
    out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * Every place DATA_BACKEND can be set, and whether each still means Supabase.
 * Strict on purpose: only absent or exactly "supabase" passes. The site treats
 * a typo as Supabase, but a rebuild that guesses wrong erases D1's own writes.
 *
 *   wranglerText   the checked-out wrangler.jsonc (top-level vars and every env.*.vars)
 *   envLocalText   .env.local — OpenNext compiles it INTO the Worker, so a
 *                  DATA_BACKEND there reaches production too
 *   deployed       { bindings } from the deployed Worker's settings, or { error }:
 *                  the authority, since the checkout can lag what was deployed
 *
 * @param {{ wranglerText?: string | null, envLocalText?: string | null, deployed: { bindings?: {name: string, type: string, text?: string}[], error?: string } }} state
 */
export function backendProblems({ wranglerText, envLocalText, deployed }) {
  const out = [];
  const pass = (v) => v === undefined || v === "supabase";
  if (wranglerText == null) out.push("wrangler.jsonc not found — cannot tell which database the site reads");
  else {
    let cfg = null;
    try { cfg = parseJsonc(wranglerText); } catch (e) { out.push(`wrangler.jsonc could not be parsed (${e.message}) — cannot tell which database the site reads`); }
    if (cfg) {
      const places = [["vars", cfg.vars], ...Object.entries(cfg.env ?? {}).map(([name, e]) => [`env.${name}.vars`, e?.vars])];
      for (const [where, vars] of places) {
        if (vars && !pass(vars.DATA_BACKEND)) out.push(`wrangler.jsonc ${where}.DATA_BACKEND is ${JSON.stringify(vars.DATA_BACKEND)}`);
      }
    }
  }
  for (const line of (envLocalText ?? "").split(/\r?\n/)) {
    const m = line.match(/^\s*DATA_BACKEND\s*=(.*)$/);
    if (m && !pass(m[1].trim().replace(/^"|"$/g, ""))) out.push(`.env.local DATA_BACKEND is ${JSON.stringify(m[1].trim())} (OpenNext builds it into the Worker)`);
  }
  if (!deployed || deployed.error) {
    out.push(`the deployed Worker's settings could not be read (${deployed?.error ?? "not asked"}) — cannot prove the site still reads Supabase`);
  } else {
    const b = (deployed.bindings ?? []).find((x) => x.name === "DATA_BACKEND");
    if (b && b.type !== "plain_text") out.push(`the deployed Worker holds DATA_BACKEND as ${b.type}; its value cannot be read`);
    else if (b && !pass(b.text)) out.push(`the deployed Worker's DATA_BACKEND is ${JSON.stringify(b.text)}`);
  }
  return out;
}

/** The deployed Worker's bindings (read-only GET of its settings) → { bindings } | { error }. */
export async function fetchDeployedSettings(env, scriptName) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
      { method: "GET", headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } },
    );
    const j = await res.json().catch(() => ({}));
    if (!j.success || !Array.isArray(j.result?.bindings)) return { error: `HTTP ${res.status} ${JSON.stringify(j.errors ?? []).slice(0, 160)}` };
    return { bindings: j.result.bindings.map((b) => ({ name: b.name, type: b.type, ...(b.type === "plain_text" ? { text: b.text } : {}) })) };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

/** Every backend check from the files under `root` plus the deployed Worker. */
export async function readBackendProblems(root, env) {
  const readOrNull = (f) => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return null; } };
  const wranglerText = readOrNull("wrangler.jsonc");
  let scriptName = null;
  try { scriptName = parseJsonc(wranglerText ?? "").name ?? null; } catch { /* reported by backendProblems */ }
  const deployed = scriptName ? await fetchDeployedSettings(env, scriptName) : { error: "no Worker name in wrangler.jsonc" };
  return backendProblems({ wranglerText, envLocalText: readOrNull(".env.local"), deployed });
}

/** @param {{ exportedAt?: string } | null} meta */
export function exportAgeProblems(meta, now = Date.now(), maxMinutes = MAX_EXPORT_AGE_MIN) {
  const at = Date.parse(meta?.exportedAt ?? "");
  if (!Number.isFinite(at)) return ["the export has no _meta.json exportedAt — re-export with d1/export-data.mjs"];
  const minutes = (now - at) / 60_000;
  if (minutes > maxMinutes) return [`the export is ${Math.round(minutes)} minutes old (limit ${maxMinutes}): every write since is missing from it — re-export`];
  if (minutes < -5) return [`the export claims to be from the future (${meta.exportedAt}) — check this machine's clock`];
  return [];
}

/**
 * A Postgres/PostgREST timestamp → microseconds since the epoch (NaN when it is
 * not one). Microseconds, not Date's milliseconds: two writes in the same
 * millisecond must still compare. Unix seconds × 1e6 stays inside 2^53 until
 * the year 2255, so a plain Number is exact.
 */
export function tsMicros(v) {
  if (typeof v !== "string") return NaN;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/);
  if (!m) return NaN;
  let zone = m[4] ?? "Z";
  if (/^[+-]\d{2}$/.test(zone)) zone += ":00";
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (!Number.isFinite(ms)) return NaN;
  return (ms / 1000) * 1e6 + Number(`${m[3] ?? ""}000000`.slice(0, 6));
}

/**
 * Does D1 hold writes the export lacks? Read-only: one SELECT of the primary
 * key and created_at / updated_at per table. Per row, the newest of the two:
 *   • a row the export also has, newer in D1  → changed in D1       (refuse)
 *   • a row only in D1, newer than exportedAt → written after export (refuse)
 *   • a row only in D1, newer than every row the export holds for that table
 *     → either written to D1 after a switch, or deleted from Supabase since the
 *       last import. Refused unless the operator names the table in
 *       `acceptNewerIn` after checking it is the latter.
 * Before the switch none of these can happen except that last benign case: D1
 * only ever received rows from an earlier export, and Supabase timestamps only
 * move forward. A missing table (a freshly created D1) is skipped.
 *
 * @param {{ run: (sql: string, params?: unknown[]) => any, types: Record<string, any>, dir: string, exportedAt: string, tables?: string[], acceptNewerIn?: string[] }} opts
 */
export async function d1NewerRows({ run, types, dir, exportedAt, tables = Object.keys(types), acceptNewerIn = [] }) {
  const problems = [], notes = [];
  const counts = JSON.parse(fs.readFileSync(path.join(dir, "_counts.json"), "utf8"));
  const exportedMicros = tsMicros(exportedAt);
  if (!Number.isFinite(exportedMicros)) return { problems: ["the export has no usable exportedAt"], notes, probed: 0 };
  let probed = 0;
  for (const t of tables) {
    const cols = types[t]?.columns ?? {};
    const stampCols = ["created_at", "updated_at"].filter((c) => cols[c]?.pg === "timestamptz");
    const pk = types[t]?.pk ?? [];
    if (!stampCols.length || !pk.length) continue;
    const q = (c) => `"${c}"`;
    let live;
    try {
      live = await run(`SELECT ${[...pk, ...stampCols].map(q).join(", ")} FROM "${t}"`);
    } catch (e) {
      if (/no such table/i.test(String(e?.message))) continue;
      problems.push(`${t}: could not read D1 (${String(e?.message ?? e).slice(0, 160)})`);
      continue;
    }
    probed++;
    if (!live.length) continue;
    const newest = (get) => {
      let best = -Infinity;
      for (const c of stampCols) { const v = tsMicros(get(c)); if (v > best) best = v; }
      return best;
    };
    const order = tableColumns(types, t);
    const file = path.join(dir, `${t}.json`);
    const exported = counts[t] !== undefined && counts[t] !== "skipped" && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    const known = new Map();
    let exportMax = -Infinity;
    for (const r of exported) {
      const s = newest((c) => r[order.indexOf(c)]);
      known.set(JSON.stringify(pk.map((c) => String(r[order.indexOf(c)]))), s);
      if (s > exportMax) exportMax = s;
    }
    let changed = 0, afterExport = 0, onlyInD1 = 0;
    for (const r of live) {
      const s = newest((c) => r[c]);
      if (s === -Infinity) continue;
      const key = JSON.stringify(pk.map((c) => String(r[c])));
      if (known.has(key)) { if (s > known.get(key)) changed++; }
      else if (s > exportedMicros) afterExport++;
      else if (s > exportMax) onlyInD1++;
    }
    if (changed) problems.push(`${t}: ${changed} row(s) were changed in D1 after the export's copy of them — D1 has writes Supabase does not`);
    if (afterExport) problems.push(`${t}: ${afterExport} row(s) in D1 are newer than the export itself`);
    if (onlyInD1) {
      if (acceptNewerIn.includes(t)) notes.push(`${t}: ${onlyInD1} row(s) only in D1, newer than the export's newest — accepted by --accept-newer-in (they will be dropped)`);
      else problems.push(`${t}: ${onlyInD1} row(s) exist only in D1 and are newer than anything exported for it — written to D1 after a switch, or deleted from Supabase since the last import. Only once you have checked it is the latter: --accept-newer-in=${t}`);
    }
  }
  return { problems, notes, probed };
}
