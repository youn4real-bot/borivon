/**
 * Read-only plumbing for the live parity harnesses (tests/routeParity.test.ts).
 *
 * The harness runs the portal's REAL route handlers against live Supabase and
 * against LIVE D1. Both are production data, so neither side may ever be
 * written, by any path a handler can take:
 *
 *   • Supabase   every request goes through getOnlyFetch(): GET/HEAD to the
 *                Supabase host and nothing else. A POST/PATCH/DELETE — a
 *                PostgREST write, an RPC, a storage upload, an auth admin
 *                write, a realtime broadcast — THROWS before it leaves.
 *   • live D1    the adapter's runner is selectOnlyRunner(): every statement
 *                is checked by assertSelectOnly() before it is sent, so an
 *                INSERT/UPDATE/DELETE/DDL/PRAGMA never reaches the database.
 *   • anything else (Telegram, Google, Resend…) is refused by the same
 *                getOnlyFetch() installed as the global fetch.
 *
 * A refused write is recorded in `attempts` (not only thrown): bvFetch and
 * supabase-js both turn a throwing fetch/runner into an `{ error }` the route
 * may swallow, so the record is how the harness learns that a GET handler
 * tried to write. tests/routeParityGuards.test.ts proves the guards.
 */

export const LIVE_D1_ID = "ffb9dcff-a501-4dc2-a94a-e5301e2595f0";
export const SCRATCH_D1_ID = "df7163e3-239a-400f-8a2c-fc45ed7507e9";

export type Attempt = { kind: "sql" | "fetch"; what: string };

export class ReadOnlyViolation extends Error {
  constructor(message: string) {
    super(`READ-ONLY GUARD: ${message}`);
    this.name = "ReadOnlyViolation";
  }
}

// Not `replace` or `end` alone: reads use the replace() function (case folding,
// buildSql.ts) and CASE … END. REPLACE as a statement is `REPLACE INTO` or
// `INSERT OR REPLACE` — both caught below; END as a statement cannot start
// with SELECT/WITH.
const WRITE_WORDS = /\b(insert|update|delete|replace\s+into|create|drop|alter|pragma|attach|detach|vacuum|reindex|analyze|begin|commit|savepoint|release|rollback)\b/i;

/**
 * Throw unless `sql` is a single read-only statement.
 *
 * Literals, quoted identifiers and comments are blanked first, so a value or a
 * column called "updated_at" cannot trip it — and, the other way round, a write
 * keyword hidden in a comment cannot slip one through. Conservative on purpose:
 * a false positive costs one refused read, a false negative a live write.
 */
export function assertSelectOnly(sql: string): void {
  const bare = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, "``")
    .replace(/\[[^\]]*\]/g, "[]")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, " ")
    .trim();
  if (!/^(select|with|values)\b/i.test(bare)) throw new ReadOnlyViolation(`not a SELECT: ${sql.slice(0, 120)}`);
  const kw = bare.match(WRITE_WORDS);
  if (kw) throw new ReadOnlyViolation(`"${kw[1]}" in: ${sql.slice(0, 120)}`);
  if (/;\s*\S/.test(bare)) throw new ReadOnlyViolation(`more than one statement: ${sql.slice(0, 120)}`);
}

export type Runner = { run(sql: string, params?: unknown[]): Promise<{ results: Record<string, unknown>[]; meta: Record<string, unknown> }> };

/**
 * The ONE runner that may write: the throwaway D1 copy, and nothing else — the
 * id is asserted at construction, so a wrong env var cannot turn it on live.
 * For GET handlers that write (they are run there, never on live).
 */
export function throwawayRunner(opts: { send: typeof fetch; accountId: string; token: string; databaseId: string }): Runner {
  if (opts.databaseId !== SCRATCH_D1_ID) throw new ReadOnlyViolation(`writes are allowed only on the throwaway D1 ${SCRATCH_D1_ID}, not ${opts.databaseId}`);
  return d1HttpRunner(opts, () => {});
}

/**
 * A D1 runner over Cloudflare's HTTP API that refuses every non-SELECT.
 * `send` is the real network fetch, captured before any global guard replaces it.
 */
export function selectOnlyRunner(opts: {
  send: typeof fetch;
  accountId: string;
  token: string;
  databaseId: string;
  attempts?: Attempt[];
}): Runner {
  if (opts.databaseId === SCRATCH_D1_ID) throw new ReadOnlyViolation("selectOnlyRunner is for live D1; use throwawayRunner for the copy");
  return d1HttpRunner(opts, (sql) => {
    try {
      assertSelectOnly(sql);
    } catch (err) {
      opts.attempts?.push({ kind: "sql", what: sql.replace(/\s+/g, " ").slice(0, 160) });
      throw err;
    }
  });
}

function d1HttpRunner(
  opts: { send: typeof fetch; accountId: string; token: string; databaseId: string },
  check: (sql: string) => void,
): Runner {
  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/d1/database/${opts.databaseId}/query`;
  return {
    async run(sql, params = []) {
      check(sql);
      for (let attempt = 1; ; attempt++) {
        const res = await opts.send(url, {
          method: "POST", // the D1 query API is POST-only; the statement itself was checked above
          headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql, params }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          result?: { results?: Record<string, unknown>[]; meta?: Record<string, unknown> }[];
          errors?: { message?: string }[];
        };
        if (json.success) {
          const first = json.result?.[0] ?? {};
          return { results: first.results ?? [], meta: first.meta ?? {} };
        }
        const message = json.errors?.map((e) => e.message).join("; ") || `D1 HTTP ${res.status}`;
        if (attempt < 4 && /overload|busy|timeout|temporarily|internal error|network/i.test(message)) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
          continue;
        }
        throw new Error(message);
      }
    },
  };
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
}

/**
 * A fetch that lets through GET/HEAD to `allowOrigin` and refuses everything
 * else — any other method to it, any request at all to any other host.
 */
export function getOnlyFetch(send: typeof fetch, allowOrigin: string, attempts?: Attempt[]): typeof fetch {
  const allowed = new URL(allowOrigin).origin;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = methodOf(input, init);
    // data:/blob: never leave the process (pdf code loads its wasm this way).
    if (/^(data|blob):/i.test(url)) return send(input as RequestInfo, init);
    let origin = "";
    try { origin = new URL(url).origin; } catch { /* relative or junk: refused below */ }
    if (origin !== allowed || (method !== "GET" && method !== "HEAD")) {
      let where = url;
      try { const u = new URL(url); where = `${u.host}${u.pathname}`; } catch { /* keep raw */ }
      attempts?.push({ kind: "fetch", what: `${method} ${where}` });
      throw new ReadOnlyViolation(`${method} ${where}`);
    }
    return send(input as RequestInfo, init);
  }) as typeof fetch;
}
