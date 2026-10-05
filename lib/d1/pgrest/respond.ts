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
  /** Every row the filter matches (read.ts's COUNT) — PostgREST's total, sent only for count=exact. */
  count?: number;
  /** D1's rows-affected — the count PostgREST reports for a mutation. */
  changes?: number;
  /** The size of the page a HEAD describes without sending it (a GET's is its row count). */
  pageCount?: number;
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
  206: "Partial Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed", // parseRequest's PGRST101 (a verb PostgREST doesn't take)
  406: "Not Acceptable",
  409: "Conflict",
  413: "Payload Too Large",
  416: "Range Not Satisfiable", // PGRST103, the wording Supabase sends
  422: "Unprocessable Entity",
  500: "Internal Server Error",
  503: "Service Unavailable",
  504: "Gateway Timeout", // errors.ts maps 57014 (statement timeout) here
};

function statusTextFor(status: number): string {
  return STATUS_TEXT[status] ?? "";
}

/**
 * PostgREST's `Content-Range` (RangeQuery.hs contentRangeH): the page's first
 * and last absolute positions, `*` when the page is empty or the total is 0, and
 * the total after the slash — `*` when no count was asked for.
 */
function contentRange(lower: bigint, upper: bigint, total: number | null): string {
  const range = total !== 0 && lower <= upper ? `${lower}-${upper}` : "*";
  return `${range}/${total === null ? "*" : total}`;
}

/**
 * PostgREST's answer when `Accept: application/vnd.pgrst.object+json` matched a
 * row count other than 1. `.single()` call sites branch on `error.code`, and the
 * 406 is what makes supabase-js take its error path at all. The message is
 * PostgREST 14's (Error.hs SingularityError); the adapter used to send the one
 * postgrest-js itself raises for maybeSingle, which some 130 routes that forward
 * `error.message` would have printed instead.
 */
function notExactlyOneRow(rowCount: number): PostgrestError {
  return {
    code: "PGRST116",
    message: "Cannot coerce the result to a single JSON object",
    details: `The result contains ${rowCount} rows`,
    hint: null,
    status: 406,
  };
}

/**
 * A read's response (Response.hs + RangeQuery.hs rangeStatusHeader), in the
 * order PostgREST decides it — every rule checked against the live project:
 *
 *  1. `.single()` looks at the page first: 0 or 2+ rows is PGRST116, even for a
 *     page that lies past the end (an offset past the end under .single() is a
 *     406, not a 416);
 *  2. with a total (count=exact), an offset past it is PGRST103 / 416, and the
 *     header still carries the total (`*\/761`);
 *  3. a page smaller than the total is 206 Partial Content; otherwise 200. With
 *     no count asked for it is always 200.
 *
 * A HEAD gets the same status and headers, and never a body.
 */
function respondRead(rows: Record<string, unknown>[], meta: RespondMeta, intent: QueryIntent): Response {
  const head = intent.head === true;
  const pageCount = head ? meta.pageCount ?? 0 : rows.length;
  const total = intent.count === "exact" && typeof meta.count === "number" && Number.isFinite(meta.count) ? meta.count : null;

  if (intent.singleObject && (pageCount > 1 || (pageCount === 0 && intent.requireExactlyOne !== false))) {
    return errorResponse(notExactlyOneRow(pageCount), {}, head);
  }

  const lower = BigInt(intent.offsetText ?? intent.offset ?? 0);
  const upper = lower + BigInt(pageCount) - BigInt(1);
  const headers = { "content-range": contentRange(lower, upper, total) };
  if (total !== null && lower > BigInt(total)) {
    return errorResponse({
      code: "PGRST103",
      message: "Requested range not satisfiable",
      details: `An offset of ${lower} was requested, but there are only ${total} rows.`,
      hint: null,
      status: 416,
    }, headers, head);
  }
  const status = total !== null && pageCount < total ? 206 : 200;
  // Content-Type is still set on a HEAD: its answer is "the GET answer without the body".
  if (head) return send(null, status, headers, true);
  // A bare object for `.single()`, a JSON array for everything else — including
  // the empty array, which maybeSingle and plain selects collapse client-side.
  return send(JSON.stringify(intent.singleObject ? (rows[0] ?? null) : rows), status, headers);
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
  if (intent.action === "select") return respondRead(rows, meta, intent);

  // On a mutation Content-Range appears only when the caller asked for a count
  // (e.g. affiliates/payout does `.update(patch, { count: "exact" })` and reads
  // it), and the count is D1's rows-affected — exactly what PostgREST counts.
  const headers: Record<string, string> = {};
  if (intent.count === "exact") headers["content-range"] = `*/${meta.count ?? meta.changes ?? rows.length}`;

  if (intent.singleObject) {
    // 2+ rows is an error under the object Accept header no matter which helper
    // asked; 0 rows is an error for `.single()` and an empty answer for the
    // (header-less, so realistically unreachable) maybeSingle variant.
    if (rows.length > 1) return errorResponse(notExactlyOneRow(rows.length));
    if (rows.length === 0 && intent.requireExactlyOne !== false) return errorResponse(notExactlyOneRow(0));
  }

  // `return=minimal` (a mutation with no `.select()`): headers only.
  if (intent.returning === "minimal") return send(null, successStatus(intent), headers);

  const body = intent.singleObject ? (rows[0] ?? null) : rows;
  return send(JSON.stringify(body), successStatus(intent), headers);
}

/**
 * A failed query → PostgREST's error body, which supabase-js JSON.parses
 * straight into `error`. The wire format is exactly four keys, alphabetical, and
 * `status` is ours (where to put it, not what to say), so it is stripped here —
 * otherwise every caller's `error` would carry a field Supabase never sends.
 *
 * `head`: a HEAD answer has no body, error or not. It matters beyond bytes —
 * supabase-js parses a failed response's body into `error`, and turns an EMPTY
 * 404 into a 204 with no error — so a body here would hand a HEAD caller an
 * error object Supabase never produces.
 */
export function errorResponse(err: PostgrestError, headers: Record<string, string> = {}, head = false): Response {
  const body = JSON.stringify({
    code: err.code,
    details: err.details ?? null,
    hint: err.hint ?? null,
    message: err.message,
  });
  // An error must always carry its body: anything that could swallow it (204, or
  // a nonsense status) becomes a 500 the client can still read and report.
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
  return head ? send(null, status, headers, false) : send(body, status, headers);
}
