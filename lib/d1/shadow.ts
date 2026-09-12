/**
 * Shadow reads: prove the D1 copy against REAL traffic, changing nothing.
 *
 * Every server-side Supabase read still goes to Supabase and its answer is
 * what the portal returns. A sampled share of those reads is ALSO replayed
 * against the D1 copy, off the response path, and the two answers are
 * compared. Differences are recorded as counts — table, operation, how many
 * rows and which columns disagreed — never values, which are candidate
 * personal data.
 *
 * This is the step the founder asked for: copy onto Cloudflare, don't switch,
 * and test until it is boring. Hand-written parity tests cover the shapes we
 * thought of; this covers the queries the portal actually makes all day.
 *
 * OFF unless SHADOW_D1_RATE is set (0–1, e.g. "0.05" = 5% of reads). Writes
 * are never shadowed. Nothing here can change a response: every failure is
 * swallowed, and the comparison runs after the answer is sent (keepAlive).
 */
import { keepAlive } from "@/lib/keepAlive";

export type ShadowDiff = {
  table: string;
  kind: "rows" | "cells" | "error" | "exception";
  detail: string;
};

function sampleRate(): number {
  const raw = Number(process.env.SHADOW_D1_RATE ?? "0");
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1) : 0;
}

/** GET /rest/v1/<table>?… — reads only, and only the data API. */
function readTarget(url: string, method: string): string | null {
  if (method !== "GET") return null;
  const m = url.match(/\/rest\/v1\/([a-z_]+)\b/);
  return m ? m[1] : null;
}

/** Canonical form so Postgres and SQLite answers compare on meaning, not formatting. */
function canon(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canon);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = canon((value as Record<string, unknown>)[k]);
    return out;
  }
  if (typeof value === "string") {
    // Timestamps: compare the instant, not the text (…+00:00 vs …Z, fraction length).
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      const t = Date.parse(value);
      if (Number.isFinite(t)) return `@${t}`;
    }
    return value;
  }
  return value;
}

/** Compare two PostgREST bodies; returns null when they agree. */
export function compareBodies(table: string, a: unknown, b: unknown): ShadowDiff | null {
  const A = canon(a), B = canon(b);
  if (JSON.stringify(A) === JSON.stringify(B)) return null;

  if (Array.isArray(A) && Array.isArray(B)) {
    if (A.length !== B.length) return { table, kind: "rows", detail: `supabase ${A.length} rows, d1 ${B.length}` };
    const cols = new Map<string, number>();
    for (let i = 0; i < A.length; i++) {
      const ra = (A[i] ?? {}) as Record<string, unknown>, rb = (B[i] ?? {}) as Record<string, unknown>;
      for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
        if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) cols.set(k, (cols.get(k) ?? 0) + 1);
      }
    }
    const worst = [...cols.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([c, n]) => `${c}×${n}`).join(", ");
    return { table, kind: "cells", detail: worst || "row order" };
  }
  return { table, kind: "cells", detail: "shape differs" };
}

type Reporter = (diff: ShadowDiff) => void;

let report: Reporter = (diff) => {
  // One line per difference. Deliberately not an alert: a stale copy is
  // expected between refreshes, and this must never page anyone.
  console.warn(`[shadow-d1] ${diff.table} ${diff.kind}: ${diff.detail}`);
};

/** Tests (and a future dashboard) can collect diffs instead of logging them. */
export function setShadowReporter(fn: Reporter | null): void {
  report = fn ?? ((diff) => console.warn(`[shadow-d1] ${diff.table} ${diff.kind}: ${diff.detail}`));
}

/**
 * Wrap a fetch so a sampled share of PostgREST READS is also answered by D1
 * and compared. The returned fetch behaves exactly like the one passed in.
 */
export function withShadowReads(base: typeof fetch): typeof fetch {
  return async function shadowingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const res = await base(input as RequestInfo, init);

    const rate = sampleRate();
    if (rate <= 0) return res;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const table = readTarget(url, method);
    if (!table || Math.random() >= rate || !res.ok) return res;

    // Read the body without consuming the caller's copy.
    const clone = res.clone();
    keepAlive(async () => {
      try {
        const live = await clone.json();
        const { makeBvFetch } = await import("@/lib/d1/bvFetch");
        const viaD1 = await makeBvFetch({
          // A missing D1 must never quietly compare Supabase with itself.
          passthrough: (async () => { throw new Error("no d1"); }) as unknown as typeof fetch,
        })(url, { method, headers: init?.headers });
        if (!viaD1.ok) { report({ table, kind: "error", detail: `d1 http ${viaD1.status}` }); return; }
        const diff = compareBodies(table, live, await viaD1.json());
        if (diff) report(diff);
      } catch (e) {
        report({ table, kind: "exception", detail: String(e instanceof Error ? e.message : e).slice(0, 120) });
      }
    });
    return res;
  } as typeof fetch;
}
