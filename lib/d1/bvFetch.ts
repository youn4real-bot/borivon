/**
 * The seam: answer supabase-js's HTTP calls from D1 instead of Supabase.
 *
 * supabase-js lets you pass your own `fetch`. Give it this one and every
 * `.from("documents").select(...)` in the codebase — 1,261 call sites — is
 * served by the D1 copy, with no call site changed. Anything that is not a
 * PostgREST data request (auth, storage, realtime) is passed straight through
 * to the real fetch, so those keep working against Supabase while the data
 * layer is being proven.
 *
 * Nothing switches on by itself: lib/supabase.ts only uses this when the
 * backend flag says so, and the live site still reads Supabase.
 */
import registryJson from "@/d1/types.json";
import type { Registry } from "@/lib/d1/pgrest/types";
import { parseRequest } from "@/lib/d1/pgrest/parseRequest";
import { buildSql } from "@/lib/d1/pgrest/buildSql";
import { decodeRows } from "@/lib/d1/pgrest/decode";
import { toPostgrestError } from "@/lib/d1/pgrest/errors";
import { respond, errorResponse } from "@/lib/d1/pgrest/respond";
import { rpcName, callRpc, isRpcError } from "@/lib/d1/pgrest/rpc";
import { getD1, type D1Runner } from "@/lib/d1/client";

const registry = registryJson as unknown as Registry;

/** PostgREST data requests look like <supabase-url>/rest/v1/<table>?… */
export function isPostgrestUrl(url: string): boolean {
  return /\/rest\/v1\//.test(url);
}

function isError(x: unknown): x is { code: string; status: number } {
  return !!x && typeof x === "object" && "code" in x && "status" in x;
}

export function makeBvFetch(opts?: { runner?: D1Runner; passthrough?: typeof fetch }): typeof fetch {
  const passthrough = opts?.passthrough ?? fetch;

  return async function bvFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isPostgrestUrl(url)) return passthrough(input as RequestInfo, init);

    const request = input instanceof Request && !init ? input : new Request(url, init);
    const runner = opts?.runner ?? (await getD1());
    if (!runner) {
      // No D1 here: fall back to the real Supabase rather than failing. A
      // half-answered app is worse than one that simply keeps its old backend.
      return passthrough(input as RequestInfo, init);
    }

    // db.rpc("name", args) — a database function, not a table query.
    const fn = rpcName(url);
    if (fn) {
      const args = await request.json().catch(() => ({}));
      const outcome = await callRpc(fn, (args ?? {}) as Record<string, unknown>, runner.run.bind(runner))
        .catch((err) => toPostgrestError(err, {}));
      if (isRpcError(outcome)) return errorResponse(outcome);
      return outcome.status === 204
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(outcome.body), { status: outcome.status, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    const intent = await parseRequest(request, registry);
    if (isError(intent)) return errorResponse(intent);

    const built = buildSql(intent, registry);
    if (isError(built)) return errorResponse(built);

    try {
      const answer = await runner.run(built.sql, built.params);
      // A count request answers with COUNT(*) as its only value, whatever the
      // builder named the column.
      const count = intent.count && intent.head && answer.results[0]
        ? Number(Object.values(answer.results[0])[0])
        : undefined;
      const rows = intent.head ? [] : decodeRows(answer.results, intent, registry);
      return respond(rows, { count, changes: answer.meta?.changes }, intent);
    } catch (err) {
      return errorResponse(toPostgrestError(err, { table: intent.table }));
    }
  } as typeof fetch;
}
