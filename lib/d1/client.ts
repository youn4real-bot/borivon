/**
 * How the adapter reaches the D1 copy.
 *
 * Two paths, same interface:
 *   • On Cloudflare Workers — the NATIVE binding (env.BORIVON_DB), the way
 *     lib/r2.ts reaches the R2 bucket. No keys, no HTTP hop.
 *   • Anywhere else (node scripts, vitest, `next dev`) — Cloudflare's D1 HTTP
 *     API with the account token from the environment.
 *
 * The binding IS declared in wrangler.jsonc, so the live Worker can reach the
 * copy — but only the shadow comparison ever asks it anything, and only while
 * SHADOW_D1_RATE is set. Supabase still answers every request the portal
 * serves. Node scripts and vitest use the HTTP path.
 */

export type D1Row = Record<string, unknown>;
export type D1Answer = {
  results: D1Row[];
  meta: { changes?: number; last_row_id?: number; rows_read?: number; rows_written?: number };
};

export interface D1Runner {
  run(sql: string, params?: unknown[]): Promise<D1Answer>;
}

/** The binding shape we use — a subset of Cloudflare's D1Database. */
type D1BindingLike = {
  prepare(sql: string): {
    bind(...values: unknown[]): { all(): Promise<{ results?: D1Row[]; meta?: D1Answer["meta"] }> };
    all(): Promise<{ results?: D1Row[]; meta?: D1Answer["meta"] }>;
  };
};

const BINDING = "BORIVON_DB";

async function bindingRunner(): Promise<D1Runner | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as Record<string, unknown> | undefined;
    const db = env?.[BINDING] as D1BindingLike | undefined;
    if (!db) return null;
    return {
      async run(sql, params = []) {
        const stmt = db.prepare(sql);
        const out = params.length ? await stmt.bind(...params).all() : await stmt.all();
        return { results: out.results ?? [], meta: out.meta ?? {} };
      },
    };
  } catch {
    return null; // not on Workers
  }
}

function httpRunner(): D1Runner | null {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const database = process.env.D1_DATABASE_ID;
  if (!account || !token || !database) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
  return {
    async run(sql, params = []) {
      // D1 is single-writer: an overloaded database is a transient condition,
      // not a failure of the query. Retry a few times before giving up.
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql, params }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          result?: { results?: D1Row[]; meta?: D1Answer["meta"] }[];
          errors?: { message?: string }[];
        };
        if (json.success) {
          const first = json.result?.[0] ?? {};
          return { results: first.results ?? [], meta: first.meta ?? {} };
        }
        const message = json.errors?.map((e) => e.message).join("; ") || `D1 HTTP ${res.status}`;
        if (attempt < 3 && /overload|busy|timeout|temporarily/i.test(message)) {
          await new Promise((r) => setTimeout(r, 300 * attempt));
          continue;
        }
        throw new Error(message);
      }
    },
  };
}

let cached: D1Runner | null | undefined;

/** The runner for this environment, or null when D1 isn't reachable here. */
export async function getD1(): Promise<D1Runner | null> {
  if (cached !== undefined) return cached;
  cached = (await bindingRunner()) ?? httpRunner();
  return cached;
}

/** Tests inject a fake runner (and reset with null). */
export function setD1Runner(runner: D1Runner | null): void {
  cached = runner ?? undefined;
}
