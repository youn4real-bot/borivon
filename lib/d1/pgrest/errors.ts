/**
 * D1/SQLite failure → PostgREST error body (Supabase → D1 migration, step 3).
 *
 * WHY this file is load-bearing: ~43 places in this codebase branch on the CODE of a
 * failed query, not on "did it fail". A missing table means "the founder hasn't run that
 * migration yet" and the feature degrades gracefully (`leads_not_set_up`, the fail-open
 * feed fallbacks); a 23505 on `telegram_updates` means "this Telegram update is a
 * duplicate retry — drop it" and is the ONLY thing standing between a retried webhook and
 * the bot doing everything twice. D1 reports all of that as an opaque message string
 * ("UNIQUE constraint failed: telegram_updates.update_id"), so if this mapping is off by
 * one code those branches silently flip: a duplicate becomes a hard failure, a real error
 * becomes "migration missing" and a security fallback opens up (see the SECURITY comment
 * in lib/feedAccess.ts — it was burned by exactly that kind of loose matching).
 *
 * The strings below are not guessed: they were produced by running the failing statements
 * against a real SQLite (node:sqlite v25) and copied verbatim — see tests/pgrestErrors.test.ts,
 * which re-derives them from a live database so a SQLite upgrade can't quietly change them.
 *
 * Pure: no network, no D1 client, no I/O. Input is whatever was thrown/returned.
 */
import type { PostgrestError } from "./types";

/** What we know about the statement that failed (the mapper can't see the SQL). */
export type ErrorContext = { table?: string; column?: string };

/**
 * PostgREST's HTTP status per Postgres/PostgREST code. Only the codes this adapter can
 * actually produce are listed; anything else falls back by class (5xx classes → 500,
 * everything else → 400) exactly like PostgREST's own `pgErrorStatus`.
 */
const STATUS_BY_CODE: Record<string, number> = {
  PGRST116: 406, // .single() got 0 or >1 rows (supabase-js surfaces this as 406)
  PGRST204: 400, // column missing from the schema cache (insert/update payload)
  PGRST205: 404, // table missing from the schema cache
  "23502": 400, // not_null_violation
  "23503": 409, // foreign_key_violation
  "23505": 409, // unique_violation
  "23514": 400, // check_violation
  "42703": 400, // undefined_column
  "42P01": 404, // undefined_table
  "42501": 403, // insufficient_privilege
  "53300": 503, // too_many_connections → retryable
  "57014": 504, // query_canceled (timeout) → retryable
  XX000: 500, // internal_error — our "unknown" bucket
};

export function statusForPgCode(code: string): number {
  const known = STATUS_BY_CODE[code];
  if (known) return known;
  // PostgREST buckets by SQLSTATE class: 08 (connection), 53/54/55/57/58 (resource) are
  // server-side problems, everything else reaching us is a bad request.
  if (/^(08|53|54|55|57|58)/.test(code)) return 503;
  return 400;
}

/* ── reading the thrown thing ─────────────────────────────────────────────────────── */

/**
 * D1 hands the failure over in several shapes depending on the path: the Workers binding
 * throws `Error("D1_ERROR: <sqlite message>: SQLITE_ERROR")` (with the original on
 * `.cause`), the HTTP API returns `{ errors: [{ code, message }] }` (see d1/import.mjs),
 * and node:sqlite (the local test harness) throws a plain Error. Collect every message-ish
 * string we can reach, in priority order, and match against the lot.
 */
function collectMessages(err: unknown, out: string[], depth = 0): void {
  if (err == null || depth > 4 || out.length > 6) return;
  if (typeof err === "string") { if (err.trim()) out.push(err.trim()); return; }
  if (typeof err !== "object") { out.push(String(err)); return; }
  if (Array.isArray(err)) { for (const e of err) collectMessages(e, out, depth + 1); return; }
  const o = err as Record<string, unknown>;
  for (const key of ["message", "error_description", "error", "details", "detail"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) out.push(v.trim());
    else if (v && typeof v === "object") collectMessages(v, out, depth + 1);
  }
  if (Array.isArray(o.errors)) collectMessages(o.errors, out, depth + 1);
  if (o.cause) collectMessages(o.cause, out, depth + 1);
}

function rawText(err: unknown): string {
  const parts: string[] = [];
  collectMessages(err, parts);
  const seen = new Set<string>();
  return parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true))).join(" | ");
}

/** Strip the wrapper noise D1 adds so the surfaced text reads like a database error. */
function clean(text: string): string {
  return text
    .replace(/^D1_(?:ERROR|EXEC_ERROR):\s*/i, "")
    .replace(/:\s*SQLITE_[A-Z_]+\s*$/i, "")
    .trim();
}

/**
 * SQLite's EXTENDED result codes, when the driver exposes them (node:sqlite sets
 * `err.errcode`; the D1 binding does not). Authoritative when present — it survives any
 * wording change in the message, which the regexes below cannot.
 */
const SQLITE_ERRCODE: Record<number, string> = {
  5: "BUSY", 6: "LOCKED", 261: "BUSY", 262: "LOCKED", 517: "BUSY", // SQLITE_BUSY/LOCKED (+ extended)
  275: "CHECK", 787: "FOREIGN_KEY", 1299: "NOT_NULL", 1555: "UNIQUE", 2067: "UNIQUE", // CONSTRAINT_*
};

function errcodeOf(err: unknown): string | null {
  const n = (err as { errcode?: unknown } | null)?.errcode;
  return typeof n === "number" ? SQLITE_ERRCODE[n] ?? null : null;
}

/* ── the SQLite messages we must recognise (captured from a real SQLite) ───────────── */

// The name capture is OPTIONAL on purpose: the phrase alone already identifies the
// condition, so a truncated/reworded message still lands in the right branch and `ctx`
// supplies the name — far better than falling through to "unknown error", which would turn
// an un-run migration into a hard 500 and take the graceful degradation with it.
const RE_NO_TABLE = /no such table:\s*["'`]?(?:main\.|temp\.)?([A-Za-z0-9_]+)?/i;
const RE_HAS_NO_COLUMN = /table\s+["'`]?([A-Za-z0-9_]+)["'`]?\s+has no column named\s+["'`]?([A-Za-z0-9_]+)/i;
const RE_NO_COLUMN = /no such column:\s*["'`]?([A-Za-z0-9_.]+)?/i;
const RE_UNIQUE = /UNIQUE constraint failed:\s*([^|]+?)(?:\s*:\s*SQLITE_[A-Z_]*)?(?:\s*\||$)/i;
const RE_NOT_NULL = /NOT NULL constraint failed:\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/i;
const RE_CHECK = /CHECK constraint failed:\s*([^|]+?)(?:\s*:\s*SQLITE_[A-Z_]*)?(?:\s*\||$)/i;
const RE_FOREIGN_KEY = /FOREIGN KEY constraint failed/i;
/** Cloudflare-side trouble: worth a retry, never a "migration missing" branch. The bare
 *  errno names are in here because the D1 HTTP API path talks over `fetch`: a dropped
 *  socket surfaces as "read ECONNRESET" / "write EPIPE" with no prose we'd otherwise
 *  recognise, and misreading THAT as a permanent failure is what turns one blip into a
 *  feature the founder has to re-run by hand. */
const RE_BUSY = /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked|overload|too many (?:api )?requests|rate limit|temporarily unavailable|network connection lost|connection (?:lost|reset|refused)|\bE(?:CONNRESET|CONNREFUSED|CONNABORTED|PIPE|HOSTUNREACH|AI_AGAIN)\b/i;
const RE_TIMEOUT = /timed out|timeout|deadline exceeded|query was canceled|statement aborted|\bETIMEDOUT\b/i;

/** `t.a, t.b` → ["a","b"]; `index 'name'` → the index name instead (partial/expression index). */
function parseUniqueTarget(spec: string): { table?: string; columns: string[]; index?: string } {
  const idx = spec.match(/^index\s+["'`]([^"'`]+)["'`]$/i);
  if (idx) return { columns: [], index: idx[1] };
  const parts = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const columns = parts.map((p) => (p.includes(".") ? p.slice(p.lastIndexOf(".") + 1) : p));
  const first = parts[0] ?? "";
  const table = first.includes(".") ? first.slice(0, first.lastIndexOf(".")) : undefined;
  return { table, columns };
}

function build(
  code: string,
  message: string,
  opts: { details?: string | null; hint?: string | null } = {},
): PostgrestError {
  return {
    code,
    message,
    details: opts.details ?? null,
    hint: opts.hint ?? null,
    status: statusForPgCode(code),
  };
}

/** Keep the original D1 text somewhere — it is the only copy, and nothing branches on
 *  `details`, so this costs nothing and is what makes a misclassification debuggable. */
function asDetails(raw: string): string | null {
  const t = clean(raw);
  return t ? t.slice(0, 500) : null;
}

/**
 * What a Postgres/PostgREST code looks like: `PGRST###`, or a five-character SQLSTATE —
 * which ALWAYS contains a digit (23505, 42P01, XX000, 08006, 0A000; PostgreSQL defines no
 * all-letter SQLSTATE). That digit is the whole point of the test: Node's socket errnos are
 * SQLSTATE-SHAPED — `EPIPE`, `EBUSY`, `EROFS` are five uppercase letters — and letting one
 * through the passthrough below would answer a dropped connection with `code: "EPIPE"` and
 * a 400, i.e. a transient blip served as a permanent client error with `isRetryable()`
 * false. With the digit required they fall to the mapper, which knows they mean "retry".
 */
const RE_PG_CODE = /^(?:PGRST\d{3}|(?=[0-9A-Z]*\d)[0-9A-Z]{5})$/;

/** An object that already speaks PostgREST (a real Supabase error during the side-by-side
 *  parity runs, or an error this adapter built earlier) must pass through untouched —
 *  re-mapping it would destroy the very code the caller is about to branch on. */
function asPostgrestError(err: unknown): PostgrestError | null {
  if (!err || typeof err !== "object") return null;
  const o = err as Record<string, unknown>;
  if (typeof o.code !== "string" || typeof o.message !== "string") return null;
  if (!RE_PG_CODE.test(o.code)) return null;
  return {
    code: o.code,
    message: o.message,
    details: typeof o.details === "string" ? o.details : null,
    hint: typeof o.hint === "string" ? o.hint : null,
    status: typeof o.status === "number" ? o.status : statusForPgCode(o.code),
  };
}

/* ── the mapper ───────────────────────────────────────────────────────────────────── */

/**
 * Turn whatever D1 threw into the error body supabase-js callers expect.
 *
 * `ctx` fills the blanks SQLite leaves: a FOREIGN KEY violation names nothing at all, and
 * a plain `no such column: x` doesn't say which relation — Postgres/PostgREST always do.
 */
export function toPostgrestError(err: unknown, ctx: ErrorContext = {}): PostgrestError {
  const passthrough = asPostgrestError(err);
  if (passthrough) return passthrough;

  const raw = rawText(err);
  const details = asDetails(raw);
  const kind = errcodeOf(err);

  // Missing table → PGRST205. PostgREST words this "Could not find the table 'public.x'
  // in the schema cache"; lib/migrationCheck.ts and lib/googleSheets.ts match on that
  // wording ("could not find the table" / "schema cache"), so it is part of the contract.
  const noTable = raw.match(RE_NO_TABLE);
  if (noTable) {
    const table = noTable[1] || ctx.table || "unknown";
    return build("PGRST205", `Could not find the table 'public.${table}' in the schema cache`, {
      details,
      hint: `The table '${table}' does not exist in D1 — run its migration (supabase/*.sql) first.`,
    });
  }

  // Missing column → 42703. PostgREST answers an INSERT of an unknown column with PGRST204
  // instead, but EVERY PGRST204 consumer here accepts 42703 too (assistantTools 907/1422/
  // 1527/2558/4838, migrationCheck 38 — all `code === "42703" || code === "PGRST204"`), so
  // one code covers both paths. The column name MUST appear in the message: the feed falls
  // back on `error.message.includes("org_id")` and lib/feedAccess.ts on
  // /column .*org_id.* does not exist/i (that regex is a security gate — fail-closed on
  // anything else), so the wording is load-bearing, not cosmetic.
  const hasNoColumn = raw.match(RE_HAS_NO_COLUMN);
  const noColumn = raw.match(RE_NO_COLUMN);
  if (hasNoColumn || noColumn) {
    const table = hasNoColumn ? hasNoColumn[1] : ctx.table;
    const named = hasNoColumn ? hasNoColumn[2] : noColumn![1];
    const column = named || ctx.column || "unknown";
    // Already qualified (`feed_posts.org_id`) → leave it; otherwise qualify with the table
    // we were called for, which is exactly how PostgREST renders it.
    const qualified = column.includes(".") || !table ? column : `${table}.${column}`;
    return build("42703", `column ${qualified} does not exist`, { details });
  }

  // Unique violation → 23505. The Telegram dedupe (app/api/telegram/webhook/route.ts:233)
  // and the booking double-book guard (app/api/book/route.ts:370) branch on this exact
  // code; several writes instead sniff the MESSAGE for /duplicate key|unique|already
  // exists/i (assistantWrites 1229/1309, sub-admins, invite), which the Postgres wording
  // below satisfies on both counts.
  if (kind === "UNIQUE" || /UNIQUE constraint failed/i.test(raw)) {
    const spec = raw.match(RE_UNIQUE)?.[1]?.trim() ?? "";
    const { table, columns, index } = parseUniqueTarget(spec);
    const relation = table || ctx.table || "unknown";
    // Postgres names a unique constraint `<table>_<cols>_key`, and the primary key
    // `<table>_pkey` — SQLite tells us which via the extended code (1555 = PRIMARYKEY,
    // 2067 = UNIQUE), so keep the two apart rather than mislabel every PK clash. A
    // partial/expression index — e.g. bookings_slot_host_unique, the double-booking guard
    // — reports only `index '<name>'`, so use the index name itself.
    const isPk = (e: unknown) =>
      (e as { errcode?: number } | null)?.errcode === 1555 || /SQLITE_CONSTRAINT_PRIMARYKEY/i.test(raw);
    const constraint = index
      ? index
      : isPk(err)
        ? `${relation}_pkey`
        : columns.length
          ? `${relation}_${columns.join("_")}_key`
          : `${relation}_key`;
    return build("23505", `duplicate key value violates unique constraint "${constraint}"`, {
      details: columns.length ? `Key (${columns.join(", ")}) already exists.` : details,
      hint: null,
    });
  }

  // Foreign key → 23503. SQLite says only "FOREIGN KEY constraint failed" — no table, no
  // column, no constraint name — so ctx is the only source for the Postgres-shaped text.
  if (kind === "FOREIGN_KEY" || RE_FOREIGN_KEY.test(raw)) {
    const relation = ctx.table || "unknown";
    return build(
      "23503",
      `insert or update on table "${relation}" violates foreign key constraint "${relation}_fkey"`,
      { details, hint: null },
    );
  }

  // Not-null → 23502, worded like Postgres ("null value in column ... violates not-null
  // constraint") so a log or a future message sniff reads the same as it does today.
  const notNull = raw.match(RE_NOT_NULL);
  if (kind === "NOT_NULL" || notNull) {
    const relation = notNull?.[1] || ctx.table || "unknown";
    const column = notNull?.[2] || ctx.column || "unknown";
    return build(
      "23502",
      `null value in column "${column}" of relation "${relation}" violates not-null constraint`,
      { details },
    );
  }

  // CHECK → 23514. Named constraints (which every generated table uses) come back as the
  // name; an unnamed one comes back as the expression text — both go in the same slot,
  // matching Postgres's "violates check constraint" wording.
  if (kind === "CHECK" || /CHECK constraint failed/i.test(raw)) {
    const spec = raw.match(RE_CHECK)?.[1]?.trim() ?? "";
    const relation = ctx.table || (spec.match(/^([a-z0-9_]+)_[a-z0-9_]+_check$/i)?.[1] ?? "unknown");
    return build(
      "23514",
      `new row for relation "${relation}" violates check constraint "${spec || "check"}"`,
      { details },
    );
  }

  // D1 busy / overloaded / timed out. These are TRANSIENT: they must never look like a
  // missing table or a duplicate, or a blip would be recorded as "migration not run" (the
  // feature silently disables itself) or as "duplicate Telegram update" (the message is
  // dropped and the founder never gets an answer). 5xx + an explicit retry hint instead —
  // the same condition d1/import.mjs already retries on.
  if (kind === "BUSY" || kind === "LOCKED" || RE_BUSY.test(raw)) {
    return build("53300", "the database is busy and could not complete the request", {
      details,
      hint: "Transient D1 condition — retry the request.",
    });
  }
  if (RE_TIMEOUT.test(raw)) {
    return build("57014", "canceling statement due to statement timeout", {
      details,
      hint: "Transient D1 condition — retry the request.",
    });
  }

  // Unknown: never invent a code a consumer branches on. XX000 (internal_error) + 500 makes
  // every schema-tolerant fallback treat it as a real failure, and the original text is
  // preserved verbatim so the founder isn't left guessing.
  return build("XX000", clean(raw) || "Unknown database error", { details });
}

/* ── helpers, so consumers don't re-derive the code test ──────────────────────────── */

/** Read a code off either a mapped PostgrestError or the raw thing D1 threw. Only a
 *  Postgres/PostgREST-SHAPED code counts (same test the passthrough uses): node:sqlite puts
 *  `code: "ERR_SQLITE_ERROR"` on every error, undici uses errnos and the D1 HTTP API uses
 *  numbers (7500) — treating those as "a code we understand" would make every helper below
 *  answer false on a raw driver error. */
function codeOf(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && RE_PG_CODE.test(c) ? c : "";
}

/**
 * Every helper resolves through the SAME mapper rather than re-testing the message itself:
 * a second copy of the patterns is a second thing to keep in sync, and the day the two
 * disagree is the day a duplicate is both "a duplicate" and "not a duplicate". A raw D1
 * error is mapped on the spot, so these work before or after `toPostgrestError`.
 */
function resolvedCode(e: unknown): string {
  return codeOf(e) || toPostgrestError(e).code;
}

/** Table absent (migration not run). 42P01 is Postgres's own undefined_table — some call
 *  sites (assistantTools 841/938, googleSheets 271) check for it, same condition. */
export function isMissingTable(e: unknown): boolean {
  const code = resolvedCode(e);
  return code === "PGRST205" || code === "42P01";
}

/** Column absent (migration not run) — 42703 and PGRST204 are the same condition here. */
export function isMissingColumn(e: unknown): boolean {
  const code = resolvedCode(e);
  return code === "42703" || code === "PGRST204";
}

/** Duplicate row — the upsert/ignoreDuplicates and dedupe paths hang off this. */
export function isUniqueViolation(e: unknown): boolean {
  return resolvedCode(e) === "23505";
}

/** Transient D1 trouble — safe to retry the same statement (single-writer contention,
 *  overload, or a dropped edge connection). */
export function isRetryable(e: unknown): boolean {
  const code = resolvedCode(e);
  return code === "53300" || code === "57014";
}
