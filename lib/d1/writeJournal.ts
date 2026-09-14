/**
 * The WRITE JOURNAL: what makes rolling back from D1 to Supabase lose nothing.
 *
 * Once DATA_BACKEND is "d1", every change the portal makes lands in D1 only.
 * Flipping back to Supabase without this would silently throw away every
 * upload, approval, message and lead since the switch. So each SUCCESSFUL
 * mutating PostgREST request is appended to a D1 table, `_write_journal`, and
 * d1/replay-journal.mjs replays that table against Supabase, in order, before
 * the flip back.
 *
 * What is recorded is the request itself — method, path + query, Prefer, body,
 * the status D1 answered — plus two things that make a replay land the SAME
 * rows, not merely similar ones:
 *
 *   1. PREFILLED DEFAULTS. `insert({ user_id, doc_name })` lets the database
 *      invent the id (gen_random_uuid()) and created_at (now()). Replayed as-is,
 *      Supabase would invent DIFFERENT ones — and every later journal entry that
 *      says `PATCH notifications?id=eq.<the D1 id>` would match nothing, the R2
 *      key named after a document id would point at no row. So for a plain
 *      insert those values are generated here, before D1 sees the request, and
 *      the body D1 stores and the body the journal keeps are identical.
 *   2. FILL for upserts. An upsert on a non-key conflict target
 *      (`employers` on user_id, `sub_admins` on org_id+email — 20 call sites)
 *      cannot be prefilled: adding an id to its payload would turn "update the
 *      existing row" into "rewrite its primary key". Instead, after D1 answers,
 *      the generated columns are read back by the conflict key and stored
 *      alongside; the replay merges them in.
 *
 * Rules the journal lives by:
 *   • It never breaks or slows the request it records. The insert runs after the
 *     response (ctx.waitUntil via lib/d1/background.ts); every failure is caught.
 *   • A failure is LOUD in the logs ("[write-journal] LOST …", table and method
 *     only — never a value): a write missing from the journal is a write a
 *     rollback would lose, and docs/cutover-runbook.md treats any such line as
 *     "not healthy".
 *   • It creates its own tables (CREATE TABLE IF NOT EXISTS), outside
 *     d1/schema.sql: the copy's schema is generated from Supabase's, and a
 *     journal table there would be dropped/recreated by every refresh.
 *   • rl_hit is not journaled: the rate-limit counter is ephemeral, is not part
 *     of the copy (d1/export-data.mjs skips rate_limits), and replaying a day of
 *     counter bumps into Supabase would be pure noise.
 */
import registryJson from "@/d1/types.json";
import type { ColumnMeta, Registry } from "@/lib/d1/pgrest/types";
import type { D1Runner } from "@/lib/d1/client";
import { getD1 } from "@/lib/d1/client";
import { encodeParam } from "@/lib/d1/pgrest/buildSql";
import { scheduleBackground } from "@/lib/d1/background";

export const JOURNAL_TABLE = "_write_journal";
export const JOURNAL_PART_TABLE = "_write_journal_part";

/**
 * One statement per entry (D1's HTTP API and binding both run one at a time).
 * `at_ms` + `seq` give the replay its order: captured the moment D1 answered,
 * not when the background insert happened to run, so two quick writes can never
 * be replayed in the wrong order just because their journal inserts raced.
 */
export const JOURNAL_DDL = [
  `CREATE TABLE IF NOT EXISTS "${JOURNAL_TABLE}" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "at" TEXT NOT NULL,
  "at_ms" INTEGER NOT NULL,
  "seq" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "prefer" TEXT,
  "body" TEXT,
  "body_parts" INTEGER NOT NULL DEFAULT 0,
  "fill" TEXT,
  "status" INTEGER NOT NULL,
  "note" TEXT
)`,
  `CREATE INDEX IF NOT EXISTS "${JOURNAL_TABLE}_order" ON "${JOURNAL_TABLE}" ("at_ms", "seq", "id")`,
  `CREATE TABLE IF NOT EXISTS "${JOURNAL_PART_TABLE}" (
  "journal_id" INTEGER NOT NULL,
  "n" INTEGER NOT NULL,
  "data" TEXT NOT NULL,
  PRIMARY KEY ("journal_id", "n")
)`,
];

/**
 * D1 refuses a row over 2 MB. A body is JS characters, up to 3 UTF-8 bytes each
 * for anything the portal writes, so 500k characters stays under the cap. A
 * bigger body (a message with an inline image, a CV draft with signatures) is
 * split across `_write_journal_part` rows instead of being dropped.
 */
export const PART_CHARS = 500_000;

/** RPCs whose writes are not part of the copy. See the header. */
export const EPHEMERAL_RPCS = new Set(["rl_hit"]);

const JOURNAL_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type JournalTarget = { table: string | null; rpc: string | null };

/**
 * Is this request journaled, and against what? Every mutating /rest/v1 request
 * is — including shapes the adapter may not know, because if D1 ever accepted a
 * write we did not anticipate, the rollback must still carry it.
 */
export function journalTarget(method: string, url: string): JournalTarget | null {
  if (!JOURNAL_METHODS.has(method.toUpperCase())) return null;
  let pathname: string;
  try { pathname = new URL(url, "http://journal.invalid").pathname; } catch { return null; }
  const m = pathname.match(/\/rest\/v1\/(.*)$/);
  if (!m) return null;
  const rpc = m[1].match(/^rpc\/([A-Za-z0-9_]+)$/);
  if (rpc) return EPHEMERAL_RPCS.has(rpc[1]) ? null : { table: null, rpc: rpc[1] };
  const table = m[1].match(/^([A-Za-z0-9_]+)$/);
  return { table: table ? table[1] : null, rpc: null };
}

/** Prefer arrives as one comma-joined header (supabase-js appends each token). */
export function preferTokens(prefer: string | null | undefined): string[] {
  return (prefer ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

/** `columns="a","b"` → ["a","b"]. supabase-js quotes every name. */
function parseColumnsParam(raw: string): string[] {
  return raw.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
}

type Row = Record<string, unknown>;

function isPlainRow(x: unknown): x is Row {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/**
 * Columns whose Postgres default the database would invent at insert time, and
 * how to invent the same kind of value here. Only the two defaults the schema
 * actually uses for identity and time; a column with any other default (a
 * constant, `'[]'`) does not differ between D1 and Supabase, so it needs nothing.
 */
function generatorFor(col: ColumnMeta): (() => unknown) | null {
  if (col.generated) return null;
  if (col.default === "gen_random_uuid()" && col.pg === "uuid") return () => crypto.randomUUID();
  if (col.default === "now()" && col.pg === "timestamptz") return () => new Date().toISOString();
  return null;
}

export type FillPlan = {
  table: string;
  keyCols: string[];
  /** Per body row: the generated columns that row did not carry. */
  missing: string[][];
  rows: Row[];
};

export type PreparedWrite = {
  url: string;
  body: string | undefined;
  changed: boolean;
  fillPlan: FillPlan | null;
  note: string | null;
};

/**
 * Prefill what a plain insert would let the database invent, and work out what
 * an upsert will need read back. Pure: tests drive it directly.
 */
export function prepareWrite(
  method: string,
  url: string,
  prefer: string | null,
  body: string | undefined,
  registry: Registry,
  gen: { uuid?: () => string; now?: () => string } = {},
): PreparedWrite {
  const unchanged: PreparedWrite = { url, body, changed: false, fillPlan: null, note: null };
  if (method.toUpperCase() !== "POST" || body === undefined) return unchanged;
  const target = journalTarget(method, url);
  if (!target?.table) return unchanged;
  const meta = registry[target.table];
  if (!meta) return unchanged;

  const generators = Object.entries(meta.columns)
    .map(([name, col]) => [name, generatorFor(col)] as const)
    .filter((g): g is readonly [string, () => unknown] => g[1] !== null);
  if (!generators.length) return unchanged;

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return unchanged; }  // the adapter will refuse it; nothing to journal
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (!rows.length || !rows.every(isPlainRow)) return unchanged;

  const u = new URL(url);
  const tokens = preferTokens(prefer);
  const upsert = tokens.some((t) => t.startsWith("resolution="));
  const missingDefault = tokens.includes("missing=default");
  const conflict = (u.searchParams.get("on_conflict") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const keyCols = conflict.length ? conflict : meta.pk;
  const conflictIsPk = keyCols.length === meta.pk.length && keyCols.every((c) => meta.pk.includes(c));
  const columnsRaw = u.searchParams.get("columns");
  const columns = columnsRaw !== null ? parseColumnsParam(columnsRaw) : null;

  // Same instant for every row, exactly like Postgres' now() inside one statement.
  const nowValue = (gen.now ?? (() => new Date().toISOString()))();
  let changed = false;
  const added: string[] = [];

  for (const [name, make] of generators) {
    // An upsert may only have its KEY prefilled, and only when the conflict
    // target is that key: a row without it can never conflict, so it is always
    // an insert, and a fresh id is exactly what the database would have given
    // it. Anything else on an upsert would be written on the UPDATE path too.
    if (upsert && !(conflictIsPk && meta.pk.includes(name))) continue;
    const inColumns = columns?.includes(name) ?? false;
    // A column listed in `columns` but absent from a row is NULL in PostgREST
    // (unless missing=default) — prefilling it would turn an insert that fails
    // on Supabase into one that succeeds on D1. Leave that semantics alone.
    if (columns && inColumns && !missingDefault) continue;
    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(row, name)) continue;
      row[name] = meta.columns[name].pg === "uuid" ? (gen.uuid ?? (() => crypto.randomUUID()))() : nowValue;
      changed = true;
    }
    if (columns && !inColumns && rows.some((r) => Object.prototype.hasOwnProperty.call(r, name))) added.push(name);
  }

  if (added.length && columns) {
    u.searchParams.set("columns", [...columns, ...added].map((c) => `"${c}"`).join(","));
  }

  let fillPlan: FillPlan | null = null;
  let note: string | null = null;
  if (upsert) {
    const genNames = generators.map(([n]) => n);
    const missing = rows.map((r) => genNames.filter((n) => !Object.prototype.hasOwnProperty.call(r, n)));
    if (missing.some((m) => m.length)) {
      const keyless = rows.some((r, i) => missing[i].length && keyCols.some((k) => r[k] === null || r[k] === undefined));
      if (keyless) note = "fill-unkeyed";   // a NULL conflict key never conflicts; nothing to read it back by
      fillPlan = { table: target.table, keyCols, missing, rows };
    }
  }

  if (!changed) return { url, body, changed: false, fillPlan, note };
  return {
    url: u.toString(),
    body: JSON.stringify(Array.isArray(parsed) ? rows : rows[0]),
    changed: true,
    fillPlan,
    note,
  };
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const KEY_SEP = String.fromCharCode(31);

function keyString(values: unknown[], pgs: ColumnMeta["pg"][]): string {
  return values.map((v, i) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return pgs[i] === "uuid" ? s.toLowerCase() : s;
  }).join(KEY_SEP);
}

/**
 * Read the generated columns of upserted rows back from D1, by conflict key.
 * One statement per chunk, kept under D1's 100 bound parameters.
 */
export async function lookupFill(runner: D1Runner, plan: FillPlan, registry: Registry): Promise<(Row | null)[]> {
  const meta = registry[plan.table];
  const pgs = plan.keyCols.map((c) => meta.columns[c]?.pg);
  const wanted = [...new Set(plan.missing.flat())];
  const select = [...new Set([...plan.keyCols, ...wanted])].map(q).join(", ");
  const byKey = new Map<string, Row>();

  const keyed = plan.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => plan.missing[i].length && plan.keyCols.every((k) => r[k] !== null && r[k] !== undefined));
  const perChunk = Math.max(1, Math.floor(90 / Math.max(1, plan.keyCols.length)));
  for (let start = 0; start < keyed.length; start += perChunk) {
    const chunk = keyed.slice(start, start + perChunk);
    const where = chunk.map(() => `(${plan.keyCols.map((c) => `${q(c)} = ?`).join(" AND ")})`).join(" OR ");
    const params = chunk.flatMap(({ r }) => plan.keyCols.map((c, n) => encodeParam(r[c], pgs[n])));
    const answer = await runner.run(`SELECT ${select} FROM ${q(plan.table)} WHERE ${where}`, params);
    for (const row of answer.results) byKey.set(keyString(plan.keyCols.map((c) => row[c]), pgs), row);
  }

  return plan.rows.map((r, i) => {
    if (!plan.missing[i].length) return null;
    const found = byKey.get(keyString(plan.keyCols.map((c, n) => encodeParam(r[c], pgs[n])), pgs));
    if (!found) return null;
    const out: Row = {};
    for (const c of plan.missing[i]) if (found[c] !== undefined) out[c] = found[c];
    return out;
  });
}

export type JournalEntry = {
  at: string;
  at_ms: number;
  seq: number;
  method: string;
  path: string;
  prefer: string | null;
  body: string | null;
  status: number;
  note: string | null;
};

let ensured: Promise<void> | null = null;

async function ensureTables(runner: D1Runner): Promise<void> {
  ensured ??= (async () => { for (const ddl of JOURNAL_DDL) await runner.run(ddl); })()
    .catch((err) => { ensured = null; throw err; });  // retry on the next write, don't cache a failure
  return ensured;
}

/** Tests reset the once-per-isolate DDL guard between databases. */
export function resetJournalForTests(): void {
  ensured = null;
  seq = 0;
  okLogged = 0;
}

/** Append one entry (and its parts). Throws on failure; the caller logs. */
export async function appendEntry(runner: D1Runner, entry: JournalEntry, fill: (Row | null)[] | null): Promise<number> {
  await ensureTables(runner);
  const body = entry.body;
  const parts = body !== null && body.length > PART_CHARS ? Math.ceil(body.length / PART_CHARS) : 0;
  const answer = await runner.run(
    `INSERT INTO "${JOURNAL_TABLE}" ("at", "at_ms", "seq", "method", "path", "prefer", "body", "body_parts", "fill", "status", "note")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING "id"`,
    [
      entry.at, entry.at_ms, entry.seq, entry.method, entry.path, entry.prefer,
      parts ? null : body, parts,
      fill && fill.some((f) => f !== null) ? JSON.stringify(fill) : null,
      entry.status, entry.note,
    ],
  );
  const id = Number(Object.values(answer.results[0] ?? {})[0]);
  if (!Number.isFinite(id)) throw new Error("journal insert returned no id");
  for (let n = 0; n < parts; n++) {
    await runner.run(
      `INSERT INTO "${JOURNAL_PART_TABLE}" ("journal_id", "n", "data") VALUES (?, ?, ?)`,
      [id, n, body!.slice(n * PART_CHARS, (n + 1) * PART_CHARS)],
    );
  }
  return id;
}

let seq = 0;
let okLogged = 0;

export type JournalOptions = {
  /** Where the journal lives. Defaults to this runtime's D1 (binding or HTTP). */
  runner?: () => Promise<D1Runner | null>;
  registry?: Registry;
  /** Background scheduler. Defaults to ctx.waitUntil; tests collect the promises. */
  schedule?: (work: () => Promise<void>) => void;
  now?: () => number;
  uuid?: () => string;
  /** Logs. Defaults to console.error (loss) / console.warn (proof of life). */
  log?: (level: "error" | "warn", line: string) => void;
};

function defaultLog(level: "error" | "warn", line: string): void {
  // console.warn/error, never console.log: next.config's removeConsole strips
  // log calls from production builds, and these lines ARE the health signal.
  if (level === "error") console.error(line); else console.warn(line);
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/**
 * Read the body without disturbing the request. supabase-js always passes a
 * JSON string in init.body; a Request input is cloned. `null` = a body exists
 * but cannot be recorded (a stream, a Blob) — journaled loudly as a loss.
 */
async function bodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined | null> {
  if (init && init.body !== undefined && init.body !== null) return typeof init.body === "string" ? init.body : null;
  if (typeof Request !== "undefined" && input instanceof Request && !init) {
    if (!input.body) return undefined;
    try { return await input.clone().text(); } catch { return null; }
  }
  return undefined;
}

/**
 * Wrap the D1-backed fetch so every successful mutation is journaled.
 * The returned fetch answers exactly what `inner` answers.
 */
export function withWriteJournal(inner: typeof fetch, opts: JournalOptions = {}): typeof fetch {
  const registry = opts.registry ?? (registryJson as unknown as Registry);
  const schedule = opts.schedule ?? scheduleBackground;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? defaultLog;
  const runnerOf = opts.runner ?? getD1;

  return async function journalingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = urlOf(input);
    const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
    const target = journalTarget(method, url);
    if (!target) return inner(input as RequestInfo, init);

    const label = target.rpc ? `rpc/${target.rpc}` : target.table ?? "?";
    let headers: Headers;
    let text: string | undefined | null;
    let prepared: PreparedWrite;
    try {
      headers = new Headers(init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined));
      text = await bodyText(input, init);
      prepared = text === null
        ? { url, body: undefined, changed: false, fillPlan: null, note: "body-unrecordable" }
        : prepareWrite(method, url, headers.get("prefer"), text, registry, { uuid: opts.uuid, now: opts.now ? () => new Date(now()).toISOString() : undefined });
    } catch (err) {
      // Anything unexpected in the preparation must not cost the user the write.
      log("error", `[write-journal] LOST ${method} ${label}: could not prepare (${String(err instanceof Error ? err.message : err).slice(0, 80)})`);
      return inner(input as RequestInfo, init);
    }

    // Only a CHANGED body is re-sent as a fresh request; otherwise the caller's
    // own input goes through untouched.
    const res = prepared.changed
      ? await inner(prepared.url, { ...(init ?? {}), method, headers, body: prepared.body })
      : await inner(input as RequestInfo, init);

    if (!res.ok) return res;   // D1 refused it: nothing happened, nothing to replay

    // From here on the write HAS happened and the caller is owed its response
    // whatever goes wrong: an exception past this point (a clock, a URL, an
    // injected scheduler) would turn a saved document into a "save failed" the
    // nurse retries — a duplicate. Everything is caught and reported as a loss.
    try {
      recordAfter(res.status);
    } catch (err) {
      log("error", `[write-journal] LOST ${method} ${label} status=${res.status}: ${String(err instanceof Error ? err.message : err).slice(0, 80)}`);
    }
    return res;

    function recordAfter(status: number): void {
      // Order is taken NOW, when D1 has answered — see JOURNAL_DDL.
      const atMs = now();
      const entry: JournalEntry = {
        at: new Date(atMs).toISOString(),
        at_ms: atMs,
        seq: ++seq,
        method,
        path: (() => { const u = new URL(prepared.url); return u.pathname + u.search; })(),
        prefer: headers.get("prefer"),
        body: prepared.body ?? null,
        status,
        note: prepared.note,
      };
      if (text === null) log("error", `[write-journal] LOST ${method} ${label}: body could not be recorded`);

      // Grab the runner while the request scope still exists (the binding comes
      // from the Cloudflare context), then do the work after the response.
      const runnerNow = Promise.resolve().then(runnerOf).catch(() => null);
      schedule(async () => {
        try {
          const runner = await runnerNow;
          if (!runner) throw new Error("no D1 runner");
          let fill: (Row | null)[] | null = null;
          if (prepared.fillPlan) {
            try {
              fill = await lookupFill(runner, prepared.fillPlan, registry);
              if (fill.some((f, i) => f === null && prepared.fillPlan!.missing[i].length)) {
                entry.note = entry.note ?? "fill-partial";
                log("warn", `[write-journal] fill-partial ${method} ${label}`);
              }
            } catch (err) {
              entry.note = "fill-failed";
              log("warn", `[write-journal] fill-failed ${method} ${label}: ${String(err instanceof Error ? err.message : err).slice(0, 80)}`);
            }
          }
          await appendEntry(runner, entry, fill);
          if (okLogged < 3) { okLogged++; log("warn", `[write-journal] ok ${method} ${label}`); }
        } catch (err) {
          log("error", `[write-journal] LOST ${method} ${label} status=${entry.status}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
        }
      });
    }
  } as typeof fetch;
}
