/**
 * The last step of the adapter: rows (or an error) → the exact HTTP response
 * supabase-js expects.
 *
 * supabase-js does its own parsing, so the response shape IS the contract. What
 * it actually reads — verified in node_modules/@supabase/postgrest-js/dist
 * (v2.104.0, `processResponse`), not guessed:
 *
 *   • `res.ok` decides success. On ok it reads the body as text; an EMPTY body
 *     leaves `data` as null (no JSON.parse), otherwise `data = JSON.parse(body)`.
 *     On not-ok it JSON.parses the body straight into `error` — so our error body
 *     must be PostgREST's `{code, details, hint, message}` object.
 *   • `if (this.method !== "HEAD")` — for a HEAD (count) request the body is never
 *     read at all, so we send none.
 *   • count comes ONLY from the response header:
 *       `res.headers.get("content-range").split("/")` → `parseInt(part[1])`,
 *     and only when the REQUEST carried `Prefer: count=…`. Everything before the
 *     "/" is ignored by the client (we still fill it the way PostgREST does).
 *   • `res.status` / `res.statusText` are surfaced verbatim. undici does NOT fill
 *     in a default reason phrase, so we set statusText ourselves or callers see "".
 *   • NOTHING else is read: no Content-Profile, no Preference-Applied, no
 *     Range-Unit. We don't send what nobody reads.
 *
 * The one that decides the whole single/maybeSingle design:
 *   `.single()` sets `Accept: application/vnd.pgrst.object+json` (server-side
 *   contract → PGRST116 on 0 or 2+ rows), but `.maybeSingle()` sets NO header —
 *   it only flips a client-side `isMaybeSingle` flag and collapses the array
 *   itself ([] → null, [x] → x, 2+ → its own PGRST116). So all 367 maybeSingle
 *   call sites just want a normal JSON array back; `intent.singleObject` will be
 *   true only for `.single()`. We must NOT collapse arrays on their behalf.
 *
 * Statuses follow real PostgREST (the examples in postgrest-js's own docblocks
 * were generated against it): GET 200 · POST 201 whether or not rows come back ·
 * PATCH/DELETE 200 with `return=representation`, 204 without.
 */
import type { PostgrestError, QueryIntent } from "@/lib/d1/pgrest/types";

/** What the caller knows that the rows alone don't say. */
export type RespondMeta = {
  /** COUNT(*) from the dedicated count query (`count:"exact"` + `head:true`). */
  count?: number;
  /** D1's rows-affected — the count PostgREST reports for a mutation. */
  changes?: number;
};

const JSON_TYPE = "application/json; charset=utf-8";

/**
 * undici/Workers leave `statusText` empty unless we set it, and supabase-js
 * hands it to callers as-is. Only the statuses this adapter can actually emit.
 */
const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed", // parseRequest's PGRST101 (a verb PostgREST doesn't take)
  406: "Not Acceptable",
  409: "Conflict",
  413: "Payload Too Large",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
  503: "Service Unavailable",
  504: "Gateway Timeout", // errors.ts maps 57014 (statement timeout) here
};

function statusTextFor(status: number): string {
  return STATUS_TEXT[status] ?? "";
}

/**
 * PostgREST's `Content-Range`. The client only parses the part after "/", but
 * the left half is what a human (or curl) reads, so keep it honest: the first
 * row's absolute offset through the last one, `*` when nothing came back.
 */
function contentRange(rowCount: number, offset: number, total: number | null): string {
  const tail = total === null ? "*" : String(total);
  if (rowCount === 0) return `*/${tail}`;
  return `${offset}-${offset + rowCount - 1}/${tail}`;
}

/**
 * The number to publish in `Content-Range`, or null for "unknown" (`*`).
 *
 * Only requests that asked for `count=exact` get one — supabase-js ignores the
 * header otherwise. The explicit COUNT(*) (head path) wins; a mutation falls
 * back to D1's rows-affected, which is exactly what PostgREST counts there.
 * A windowed select (count + limit) can't be answered from the returned rows —
 * the codebase has no such call, and if one ever appears the runner must pass
 * `meta.count` rather than let us under-report here.
 */
function resolveCount(rows: readonly unknown[], meta: RespondMeta, intent: QueryIntent): number | null {
  if (intent.count !== "exact") return null;
  if (typeof meta.count === "number" && Number.isFinite(meta.count)) return meta.count;
  // A head request carries no rows by design, so counting them would answer a
  // confident 0 for a count the runner simply failed to produce. Say "unknown"
  // instead — it reaches the caller as `parseInt("*")`, i.e. NaN, which reads as
  // broken rather than as an empty table. Only reachable if the COUNT(*) query
  // came back with no row at all (bvFetch always has one in practice).
  if (intent.head) return null;
  if (intent.action !== "select" && typeof meta.changes === "number") return meta.changes;
  return rows.length;
}

/**
 * PostgREST's answer when `Accept: application/vnd.pgrst.object+json` matched a
 * row count other than 1. `.single()` call sites branch on `error.code`, and the
 * 406 is what makes supabase-js take its error path at all.
 */
function notExactlyOneRow(rowCount: number): PostgrestError {
  return {
    code: "PGRST116",
    message: "JSON object requested, multiple (or no) rows returned",
    details: `The result contains ${rowCount} rows`,
    hint: null,
    status: 406,
  };
}

function successStatus(intent: QueryIntent): number {
  switch (intent.action) {
    // POST is 201 Created even with `return=minimal` and an empty body — that is
    // what PostgREST does (see the insert/upsert examples in postgrest-js's docs),
    // NOT 204.
    case "insert":
    case "upsert":
      return 201;
    case "update":
    case "delete":
      return intent.returning === "representation" ? 200 : 204;
    default:
      return 200;
  }
}

/**
 * One place that builds the Response, so the body-less rules can't be forgotten:
 * a 204 with a body throws in undici ("Response with null body status cannot have
 * body"), and a response with no body must not claim a JSON content type.
 */
function send(body: string | null, status: number, headers: Record<string, string>, jsonType = body !== null): Response {
  const payload = status === 204 ? null : body;
  const h: Record<string, string> = { ...headers };
  if (jsonType) h["content-type"] = JSON_TYPE;
  return new Response(payload, { status, statusText: statusTextFor(status), headers: h });
}

/**
 * A successful query → the response supabase-js will parse into
 * `{ data, error: null, count, status }`.
 *
 * `rows` is already decoded (real booleans / numbers / parsed JSON); this only
 * decides shape, status and headers.
 */
export function respond(rows: Record<string, unknown>[], meta: RespondMeta, intent: QueryIntent): Response {
  const count = resolveCount(rows, meta, intent);

  // `head: true` — the count probe. The client never reads the body of a HEAD
  // response, so send none; the number rides in Content-Range. Content-Type is
  // still set because a HEAD answer is "the GET answer without the body".
  if (intent.head) {
    return send(null, 200, { "content-range": `*/${count === null ? "*" : count}` }, true);
  }

  const headers: Record<string, string> = {};
  if (intent.action === "select") {
    // PostgREST sends Content-Range on every read, count requested or not.
    headers["content-range"] = contentRange(rows.length, intent.offset ?? 0, count);
  } else if (count !== null) {
    // On a mutation it appears only when the caller asked for a count (e.g.
    // affiliates/payout does `.update(patch, { count: "exact" })` and reads it).
    headers["content-range"] = `*/${count}`;
  }

  if (intent.singleObject) {
    // 2+ rows is an error under the object Accept header no matter which helper
    // asked; 0 rows is an error for `.single()` and an empty answer for the
    // (header-less, so realistically unreachable) maybeSingle variant.
    if (rows.length > 1) return errorResponse(notExactlyOneRow(rows.length));
    if (rows.length === 0 && intent.requireExactlyOne !== false) return errorResponse(notExactlyOneRow(0));
  }

  // `return=minimal` (a mutation with no `.select()`): headers only. Never for a
  // read — a select with no body would silently hand every call site `null`.
  if (intent.action !== "select" && intent.returning === "minimal") {
    return send(null, successStatus(intent), headers);
  }

  // A bare object for `.single()`, a JSON array for everything else — including
  // the empty array, which is what maybeSingle and plain selects collapse
  // client-side. `rows[0] ?? null` covers the 0-row maybeSingle object form.
  const body = intent.singleObject ? (rows[0] ?? null) : rows;
  return send(JSON.stringify(body), successStatus(intent), headers);
}

/**
 * A failed query → PostgREST's error body, which supabase-js JSON.parses
 * straight into `error`. The wire format is exactly four keys, alphabetical, and
 * `status` is ours (where to put it, not what to say), so it is stripped here —
 * otherwise every caller's `error` would carry a field Supabase never sends.
 */
export function errorResponse(err: PostgrestError): Response {
  const body = JSON.stringify({
    code: err.code,
    details: err.details ?? null,
    hint: err.hint ?? null,
    message: err.message,
  });
  // An error must always carry its body: anything that could swallow it (204, or
  // a nonsense status) becomes a 500 the client can still read and report.
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
  return send(body, status, {});
}
