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
import { decodeRows } from "@/lib/d1/pgrest/decode";
import { toPostgrestError } from "@/lib/d1/pgrest/errors";
import { respond, errorResponse } from "@/lib/d1/pgrest/respond";
import { runSelect } from "@/lib/d1/pgrest/read";
import { runWrite } from "@/lib/d1/pgrest/write";
import { rpcName, callRpc, isRpcError } from "@/lib/d1/pgrest/rpc";
import { getD1, type D1Runner } from "@/lib/d1/client";

const registry = registryJson as unknown as Registry;

/** Private response header: D1's last_row_id after a plain insert. supabase-js never reads it. */
export const LAST_ROW_ID_HEADER = "x-bv-last-row-id";

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

    const runner = opts?.runner ?? (await getD1());
    if (!runner) {
      // No D1 here: fall back to the real Supabase rather than failing. A
      // half-answered app is worse than one that simply keeps its old backend.
      return passthrough(input as RequestInfo, init);
    }

    // Once D1 answers, nothing below may reject. A throw anywhere — parsing
    // included, which used to sit outside every try (a limit=((((…)))) 8,000 parens
    // deep overflowed the stack there) — reaches supabase-js as a FetchError, which
    // it rethrows at the call site instead of handing back the `{ error }` every
    // route branches on. So the whole answer is one try, and an unexpected failure
    // is errors.ts's XX000 in PostgREST's error shape.
    let head = false;
    let table: string | undefined;
    try {
      const request = input instanceof Request && !init ? input : new Request(url, init);

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

      // A HEAD answer never has a body, errors included (see errorResponse).
      head = request.method.toUpperCase() === "HEAD";
      const intent = await parseRequest(request, registry);
      if (isError(intent)) return errorResponse(intent, {}, head);
      table = intent.table;

      // A read can take more than one statement (a count beside the page, a text
      // sort) — read.ts runs those.
      if (intent.action === "select") {
        const read = await runSelect(intent, registry, (sql, params) => runner.run(sql, params));
        if (isError(read)) return errorResponse(read, {}, head);
        return respond(read.rows, { count: read.total, pageCount: read.pageCount }, intent);
      }

      // A write can take more than one statement too (a PATCH whose payload
      // Postgres would never read, an upsert whose rows repeat the conflict key)
      // — write.ts runs those and decides the answer.
      const written = await runWrite(intent, registry, (sql, params) => runner.run(sql, params));
      if (isError(written)) return errorResponse(written);
      const res = respond(decodeRows(written.rows, intent, registry), { changes: written.changes }, intent);
      // The rowid D1 gave the last row a plain insert added: the write journal
      // turns it into the ids of the rows it numbered itself (lib/d1/writeJournal.ts).
      if (intent.action === "insert" && res.ok && Number.isSafeInteger(written.lastRowId)) res.headers.set(LAST_ROW_ID_HEADER, String(written.lastRowId));
      return res;
    } catch (err) {
      return errorResponse(toPostgrestError(err, { table }), {}, head);
    }
  } as typeof fetch;
}
