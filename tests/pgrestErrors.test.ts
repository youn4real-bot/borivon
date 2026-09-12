import { describe, it, expect, beforeAll } from "vitest";
import {
  toPostgrestError,
  isMissingTable,
  isMissingColumn,
  isUniqueViolation,
  isRetryable,
  statusForPgCode,
} from "../lib/d1/pgrest/errors";

/**
 * The PostgREST→D1 error mapper (Supabase → D1 migration, step 3).
 *
 * Two layers of proof, because an error code here is a BEHAVIOUR switch, not a log line:
 *  1. the mapping itself, driven by the exact strings a real SQLite produces;
 *  2. the CONSUMER CONTRACT — the real predicates copied out of the ~43 call sites that
 *     branch on these codes (file + line cited). If a mapping drifts, a duplicate Telegram
 *     update gets reprocessed, a missing migration reads as a hard failure, or the feed's
 *     security fallback opens. Those tests are the actual point of this file.
 */

/* ── the real predicates, verbatim from the codebase ───────────────────────────────── */

type Err = { code?: string; message?: string };

/** lib/migrationCheck.ts:35-39 — "is this feature just un-migrated?" */
const migrationCheckIsMissing = (error: Err) => {
  const code = error.code ?? "";
  const msg = error.message ?? "";
  return code === "42703" || code === "PGRST204" || code === "PGRST205" ||
    /does not exist|could not find the table|schema cache/i.test(msg);
};
/** lib/feedAccess.ts:105-108 — SECURITY gate: anything but a real missing column fails closed. */
const feedAccessUndefinedColumn = (error: Err) =>
  error.code === "42703" || /column .*org_id.* does not exist/i.test(error.message ?? "");
/** app/api/portal/feed/route.ts:167,172,321 — schema-tolerant fallbacks keyed off the column name. */
const feedMentionsColumn = (error: Err, col: string) => !!error.message?.includes(col);
/** lib/assistantWrites.ts:1229,1309 + admin/sub-admins:52 + invite/[code]:59 — "duplicate is fine". */
const duplicateIsOk = (error: Err) => /duplicate key|unique|already exists|23505/i.test(error.message ?? "");
/** app/api/portal/admin/affiliates/route.ts:100 — same idea, looser wording. */
const affiliateDuplicateIsOk = (error: Err) => /duplicate|unique|23505/i.test(error.message ?? "");
/** lib/googleSheets.ts:271 — "app_settings table not created yet". */
const sheetsSettingsMissing = (error: Err) =>
  error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "");
/** lib/assistantTools.ts:907 — missing column on a write. */
const assistantMissingColumn = (error: Err) =>
  error.code === "42703" || error.code === "PGRST204" ||
  /column .* does not exist|schema cache/i.test(error.message ?? "");

/* ── D1 wrapper shapes (what actually reaches the adapter in production) ───────────── */

/** The Workers binding wraps SQLite's text: `D1_ERROR: <msg>: SQLITE_<CODE>`. */
const d1 = (msg: string, ext = "SQLITE_ERROR") => new Error(`D1_ERROR: ${msg}: ${ext}`);

describe("toPostgrestError — missing table (migration not run)", () => {
  it("maps SQLite's 'no such table' to PGRST205 with PostgREST's wording", () => {
    const e = toPostgrestError(d1("no such table: leads"), { table: "leads" });
    expect(e.code).toBe("PGRST205");
    expect(e.message).toBe("Could not find the table 'public.leads' in the schema cache");
    expect(e.status).toBe(404);
    // the original text survives where nothing branches on it
    expect(e.details).toContain("no such table: leads");
  });

  it("keeps every 'table not set up' consumer working", () => {
    const e = toPostgrestError("no such table: app_settings", { table: "app_settings" });
    expect(migrationCheckIsMissing(e)).toBe(true);   // lib/migrationCheck.ts
    expect(sheetsSettingsMissing(e)).toBe(true);     // lib/googleSheets.ts
    expect(e.code === "PGRST205").toBe(true);        // lib/assistantWrites.ts:199 etc.
    expect(isMissingTable(e)).toBe(true);
    expect(isMissingColumn(e)).toBe(false);
  });

  it("reads the table out of the message, and falls back to ctx when it can't", () => {
    expect(toPostgrestError("no such table: main.documents").message).toContain("'public.documents'");
    expect(toPostgrestError({ message: "no such table:" }, { table: "leads" }).message)
      .toContain("'public.leads'");
  });
});

describe("toPostgrestError — missing column (migration not run)", () => {
  it("maps a SELECT on an unknown column to 42703, qualified like PostgREST", () => {
    const e = toPostgrestError(d1("no such column: is_test_account"), { table: "candidate_profiles" });
    expect(e.code).toBe("42703");
    expect(e.message).toBe("column candidate_profiles.is_test_account does not exist");
    expect(e.status).toBe(400);
  });

  it("maps an INSERT with an unknown column to 42703 too (PGRST204's consumers accept it)", () => {
    // PostgREST would answer PGRST204 here, but every PGRST204 consumer in this codebase
    // also accepts 42703 (assistantTools 907/1422/1527/2558/4838, migrationCheck 38).
    const e = toPostgrestError(d1("table feed_posts has no column named org_id"), { table: "feed_posts" });
    expect(e.code).toBe("42703");
    expect(e.message).toBe("column feed_posts.org_id does not exist");
    expect(assistantMissingColumn(e)).toBe(true);
    expect(migrationCheckIsMissing(e)).toBe(true);
  });

  it("satisfies the feed's fallbacks AND feedAccess's fail-closed security regex", () => {
    const e = toPostgrestError("no such column: org_id", { table: "feed_posts" });
    expect(feedMentionsColumn(e, "org_id")).toBe(true);        // feed route falls back
    expect(feedAccessUndefinedColumn(e)).toBe(true);           // access check trusts it
    const cat = toPostgrestError("no such column: category", { table: "feed_posts" });
    expect(feedMentionsColumn(cat, "category")).toBe(true);
    // …and a DIFFERENT failure must NOT trip either of them (the bug feedAccess warns about)
    const other = toPostgrestError(d1("database is locked", "SQLITE_BUSY"), { table: "feed_posts" });
    expect(feedAccessUndefinedColumn(other)).toBe(false);
    expect(feedMentionsColumn(other, "org_id")).toBe(false);
    expect(migrationCheckIsMissing(other)).toBe(false);
  });

  it("keeps an already-qualified column name as-is", () => {
    expect(toPostgrestError("no such column: feed_posts.org_id", { table: "feed_posts" }).message)
      .toBe("column feed_posts.org_id does not exist");
  });

  it("falls back to the ctx column when SQLite names none", () => {
    expect(toPostgrestError({ message: "no such column:" }, { table: "leads", column: "status" }).message)
      .toBe("column leads.status does not exist");
  });
});

describe("toPostgrestError — unique violation (dedupe + upsert depend on it)", () => {
  it("maps a PK clash to 23505 — the Telegram dedupe's only signal", () => {
    // app/api/telegram/webhook/route.ts:233 drops the retry on this code alone; anything
    // else and every retried update is processed twice (duplicate reminders/notes).
    const e = toPostgrestError(
      d1("UNIQUE constraint failed: telegram_updates.update_id", "SQLITE_CONSTRAINT_PRIMARYKEY"),
      { table: "telegram_updates" },
    );
    expect(e.code).toBe("23505");
    expect(e.status).toBe(409);
    expect(e.message).toBe('duplicate key value violates unique constraint "telegram_updates_pkey"');
    expect(e.details).toBe("Key (update_id) already exists.");
  });

  it("names a plain unique constraint the way Postgres does", () => {
    const e = toPostgrestError(d1("UNIQUE constraint failed: sub_admins.email", "SQLITE_CONSTRAINT_UNIQUE"));
    expect(e.message).toBe('duplicate key value violates unique constraint "sub_admins_email_key"');
  });

  it("handles the composite key (affiliate_earnings' one-earning-per-candidate rule)", () => {
    const e = toPostgrestError(
      "UNIQUE constraint failed: affiliate_earnings.affiliate_id, affiliate_earnings.candidate_user_id",
    );
    expect(e.code).toBe("23505");
    expect(e.message).toContain('"affiliate_earnings_affiliate_id_candidate_user_id_key"');
    expect(e.details).toBe("Key (affiliate_id, candidate_user_id) already exists.");
  });

  it("handles a partial/expression index — the double-booking guard reports only the index", () => {
    // bookings_slot_host_unique is `(starts_at, COALESCE(host_id,0)) WHERE status <> 'cancelled'`,
    // and SQLite names the index instead of the columns for those.
    const e = toPostgrestError(d1("UNIQUE constraint failed: index 'bookings_slot_host_unique'"), { table: "bookings" });
    expect(e.code).toBe("23505");
    expect(e.message).toBe('duplicate key value violates unique constraint "bookings_slot_host_unique"');
  });

  it("keeps the message-sniffing duplicate checks happy", () => {
    const e = toPostgrestError("UNIQUE constraint failed: organization_members.user_id");
    expect(duplicateIsOk(e)).toBe(true);         // assistantWrites / sub-admins / invite
    expect(affiliateDuplicateIsOk(e)).toBe(true); // admin/affiliates
    expect(isUniqueViolation(e)).toBe(true);
    // and must NOT read as a missing table/column, or the dedupe becomes "not set up"
    expect(migrationCheckIsMissing(e)).toBe(false);
  });
});

describe("toPostgrestError — the other constraint failures", () => {
  it("maps FOREIGN KEY (SQLite names nothing, so ctx fills it) to 23503/409", () => {
    const e = toPostgrestError(d1("FOREIGN KEY constraint failed", "SQLITE_CONSTRAINT_FOREIGNKEY"), { table: "documents" });
    expect(e.code).toBe("23503");
    expect(e.status).toBe(409);
    expect(e.message).toBe('insert or update on table "documents" violates foreign key constraint "documents_fkey"');
    // a FK failure is a real failure — never a "duplicate, carry on" or "migration missing"
    expect(duplicateIsOk(e)).toBe(false);
    expect(migrationCheckIsMissing(e)).toBe(false);
  });

  it("maps NOT NULL to 23502/400 with Postgres's wording", () => {
    const e = toPostgrestError(d1("NOT NULL constraint failed: documents.user_id", "SQLITE_CONSTRAINT_NOTNULL"));
    expect(e.code).toBe("23502");
    expect(e.status).toBe(400);
    expect(e.message).toBe('null value in column "user_id" of relation "documents" violates not-null constraint');
  });

  it("maps a named CHECK to 23514/400", () => {
    const e = toPostgrestError(
      d1("CHECK constraint failed: academy_attendance_status_check", "SQLITE_CONSTRAINT_CHECK"),
      { table: "academy_attendance" },
    );
    expect(e.code).toBe("23514");
    expect(e.status).toBe(400);
    expect(e.message).toBe('new row for relation "academy_attendance" violates check constraint "academy_attendance_status_check"');
  });

  it("still maps an unnamed CHECK (SQLite reports the expression) and recovers the table", () => {
    const e = toPostgrestError("CHECK constraint failed: c in ('x','y')", { table: "t" });
    expect(e.code).toBe("23514");
    expect(e.message).toContain("c in ('x','y')");
    expect(toPostgrestError("CHECK constraint failed: notifications_action_check").message)
      .toContain('relation "notifications"');
  });
});

describe("toPostgrestError — transient D1 trouble must never look like schema drift", () => {
  const transient = [
    "database is locked",
    "D1_ERROR: Network connection lost.",
    "Too many API requests by single worker invocation",
    "D1 is temporarily unavailable, please retry",
    "SQLITE_BUSY: database is locked",
  ];
  it.each(transient)("marks %j retryable, 5xx, and not a migration problem", (msg) => {
    const e = toPostgrestError(msg, { table: "documents" });
    expect(e.status).toBeGreaterThanOrEqual(500);
    expect(e.hint).toMatch(/retry/i);
    expect(isRetryable(e)).toBe(true);
    // the whole point: a blip must not disable a feature or swallow a message
    expect(migrationCheckIsMissing(e)).toBe(false);
    expect(duplicateIsOk(e)).toBe(false);
    expect(isMissingTable(e)).toBe(false);
    expect(isUniqueViolation(e)).toBe(false);
  });

  it("maps a timeout to 57014/504", () => {
    const e = toPostgrestError(new Error("query timed out after 30s"));
    expect(e.code).toBe("57014");
    expect(e.status).toBe(504);
    expect(isRetryable(e)).toBe(true);
  });
});

describe("toPostgrestError — the shapes D1 actually throws", () => {
  it("unwraps an Error whose real message hides in `cause` (the Workers binding)", () => {
    const e = toPostgrestError(
      Object.assign(new Error("D1_ERROR: something went wrong"), { cause: new Error("no such table: leads") }),
    );
    expect(e.code).toBe("PGRST205");
  });

  it("reads the HTTP API's `{ errors: [{ code, message }] }` body (d1/import.mjs's shape)", () => {
    const e = toPostgrestError({
      success: false,
      errors: [{ code: 7500, message: "UNIQUE constraint failed: affiliates.code" }],
    });
    expect(e.code).toBe("23505");
    // the numeric 7500 must not be mistaken for a Postgres code
    expect(isUniqueViolation(e)).toBe(true);
  });

  it("accepts a bare string, and survives null/undefined/garbage", () => {
    expect(toPostgrestError("no such column: status", { table: "leads" }).code).toBe("42703");
    for (const junk of [null, undefined, {}, 42, []]) {
      const e = toPostgrestError(junk);
      expect(e.code).toBe("XX000");
      expect(e.status).toBe(500);
      expect(typeof e.message).toBe("string");
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it("preserves an unknown failure verbatim instead of inventing a code", () => {
    const e = toPostgrestError(d1("malformed JSON"));
    expect(e.code).toBe("XX000");
    expect(e.status).toBe(500);
    expect(e.message).toBe("malformed JSON");      // D1_ERROR:/SQLITE_ noise stripped
    expect(e.details).toContain("malformed JSON"); // original kept for debugging
    // an unknown error must fail LOUD — no schema-tolerant branch may swallow it
    expect(migrationCheckIsMissing(e)).toBe(false);
    expect(duplicateIsOk(e)).toBe(false);
    expect(isRetryable(e)).toBe(false);
  });

  it("passes an error that already speaks PostgREST straight through", () => {
    // Supabase's own error during the side-by-side parity runs, or one we built earlier —
    // re-mapping it would destroy the code the caller is about to branch on.
    const supa = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: "Results contain 0 rows", hint: null };
    const e = toPostgrestError(supa);
    expect(e).toEqual({ ...supa, status: 406 });
    expect(toPostgrestError(toPostgrestError("no such table: leads"))).toEqual(toPostgrestError("no such table: leads"));
  });

  it("does NOT mistake a socket errno for a Postgres code", () => {
    // `EPIPE`/`EBUSY` are five uppercase letters — SQLSTATE-shaped, but they mean the
    // connection died on the D1 HTTP path. Passing one through would answer a blip with
    // `code: "EPIPE"` and a 400 (permanent), and isRetryable() would say false.
    const sock = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    const e = toPostgrestError(sock);
    expect(e.code).toBe("53300");
    expect(isRetryable(e)).toBe(true);
    expect(isRetryable(sock)).toBe(true);
    // a real SQLSTATE still passes through untouched — every one of them has a digit
    expect(toPostgrestError({ code: "23505", message: "duplicate key value violates unique constraint \"x\"" }).code).toBe("23505");
    expect(toPostgrestError({ code: "42P01", message: "relation \"leads\" does not exist" }).status).toBe(404);
  });

  it("treats a dropped fetch to the D1 HTTP API as transient", () => {
    for (const msg of ["read ECONNRESET", "connect ECONNREFUSED 127.0.0.1:443", "getaddrinfo EAI_AGAIN api.cloudflare.com"]) {
      expect(isRetryable(toPostgrestError(new Error(msg)))).toBe(true);
    }
    expect(toPostgrestError(new Error("connect ETIMEDOUT")).code).toBe("57014");
  });

  it("caps the preserved details so one runaway message can't bloat a response", () => {
    const e = toPostgrestError("x".repeat(5000));
    expect((e.details ?? "").length).toBeLessThanOrEqual(500);
  });
});

describe("helpers", () => {
  it("answer on a mapped error AND on the raw thing D1 threw", () => {
    expect(isMissingTable(d1("no such table: leads"))).toBe(true);
    expect(isMissingColumn(d1("table leads has no column named status"))).toBe(true);
    expect(isUniqueViolation(d1("UNIQUE constraint failed: leads.email"))).toBe(true);
    expect(isRetryable(d1("database is locked", "SQLITE_BUSY"))).toBe(true);
    // node:sqlite stamps `code: "ERR_SQLITE_ERROR"` on everything — that must not be read
    // as a Postgres code (it would make every helper answer false).
    const nodeSqlite = Object.assign(new Error("UNIQUE constraint failed: leads.email"), {
      code: "ERR_SQLITE_ERROR", errcode: 2067,
    });
    expect(isUniqueViolation(nodeSqlite)).toBe(true);
    expect(toPostgrestError(nodeSqlite).code).toBe("23505");
  });

  it("don't cross-fire", () => {
    const dup = toPostgrestError("UNIQUE constraint failed: leads.email");
    expect([isMissingTable(dup), isMissingColumn(dup), isRetryable(dup)]).toEqual([false, false, false]);
    const gone = toPostgrestError("no such table: leads");
    expect([isMissingColumn(gone), isUniqueViolation(gone), isRetryable(gone)]).toEqual([false, false, false]);
    // the helpers resolve through the mapper, so a column merely NAMED "timeout_at" can't
    // read as a transient failure (it would silently turn a dead feature into a retry loop)
    expect(isRetryable(d1("no such column: timeout_at"))).toBe(false);
    expect(isMissingColumn(d1("no such column: timeout_at"))).toBe(true);
  });

  it("maps codes to the statuses PostgREST answers with", () => {
    expect(statusForPgCode("PGRST205")).toBe(404);
    expect(statusForPgCode("23505")).toBe(409);
    expect(statusForPgCode("23503")).toBe(409);
    expect(statusForPgCode("23502")).toBe(400);
    expect(statusForPgCode("23514")).toBe(400);
    expect(statusForPgCode("42703")).toBe(400);
    expect(statusForPgCode("XX000")).toBe(500);
    expect(statusForPgCode("08006")).toBe(503); // unknown code, connection class → retryable
  });
});

/* ── ground truth: run the failures through a REAL SQLite ──────────────────────────── */

type Db = { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown } };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); }
catch { /* older Node: skip, the literal-string tests above still cover the mapping */ }

describe.skipIf(!DatabaseSync)("against a real SQLite (the strings above are not guesses)", () => {
  // Built in beforeAll, NOT at collection time: vitest still RUNS a skipped suite's
  // callback (verified — a throw in it fails the whole FILE with "0 tests"), so opening
  // the database up here would take all 30+ mapping tests down on any Node without
  // node:sqlite — the exact case skipIf is here to survive. Hooks don't run when skipped.
  let db: Db;
  beforeAll(() => {
    db = new DatabaseSync!(":memory:");
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE telegram_updates (update_id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT);
      CREATE TABLE orgs (id TEXT PRIMARY KEY);
      CREATE TABLE leads (
        id TEXT PRIMARY KEY, email TEXT NOT NULL, org_id TEXT REFERENCES orgs(id), status TEXT,
        CONSTRAINT leads_status_check CHECK (status IN ('new','won'))
      );
      CREATE UNIQUE INDEX leads_email_key ON leads (email);
      CREATE UNIQUE INDEX leads_live_email_uniq ON leads (lower(email)) WHERE status = 'new';
    `);
  });
  const fails = (sql: string, ctx: { table?: string; column?: string } = {}) => {
    try { db.prepare(sql).run(); throw new Error(`expected "${sql}" to fail`); }
    catch (e) { return toPostgrestError(e, ctx); }
  };

  it("classifies every failure the adapter can hit", () => {
    expect(fails("SELECT * FROM nope", { table: "nope" }).code).toBe("PGRST205");
    expect(fails("SELECT zzz FROM leads", { table: "leads" }).code).toBe("42703");
    expect(fails("INSERT INTO leads (id, email, zzz) VALUES ('1','a@b.c','x')", { table: "leads" }).code).toBe("42703");
    // an UPDATE onto a missing column too — app/api/portal/admin/organizations/[id]/route.ts:92
    // retries without `required_doc_keys` on exactly this code, so a PATCH that drifts must
    // not come back as an unknown 500 (the org would silently fail to save).
    expect(fails("UPDATE leads SET zzz = 'x' WHERE id = '1'", { table: "leads" }).code).toBe("42703");
    expect(fails("SELECT * FROM leads ORDER BY zzz", { table: "leads" }).code).toBe("42703");
    expect(fails("INSERT INTO leads (id) VALUES ('1')", { table: "leads" }).code).toBe("23502");
    expect(fails("INSERT INTO leads (id, email, status) VALUES ('1','a@b.c','bad')", { table: "leads" }).code).toBe("23514");
    expect(fails("INSERT INTO leads (id, email, org_id) VALUES ('1','a@b.c','ghost')", { table: "leads" }).code).toBe("23503");

    db.prepare("INSERT INTO leads (id, email, status) VALUES ('1','a@b.c','new')").run();
    const dup = fails("INSERT INTO leads (id, email, status) VALUES ('2','a@b.c','won')", { table: "leads" });
    expect(dup.code).toBe("23505");
    expect(dup.message).toContain('"leads_email_key"');
    // a partial/expression unique index reports only the index name
    const partial = fails("INSERT INTO leads (id, email, status) VALUES ('3','A@B.C','new')", { table: "leads" });
    expect(partial.code).toBe("23505");
    expect(partial.message).toContain('"leads_live_email_uniq"');

    db.prepare("INSERT INTO telegram_updates (update_id) VALUES (42)").run();
    const pk = fails("INSERT INTO telegram_updates (update_id) VALUES (42)", { table: "telegram_updates" });
    expect(pk.code).toBe("23505");
    expect(pk.message).toContain('"telegram_updates_pkey"');
  });

  it("keeps the real consumers behaving as they do on Supabase today", () => {
    expect(migrationCheckIsMissing(fails("SELECT vaccines FROM leads", { table: "leads" }))).toBe(true);
    expect(migrationCheckIsMissing(fails("SELECT * FROM candidate_status", { table: "candidate_status" }))).toBe(true);
    expect(feedAccessUndefinedColumn(fails("SELECT org_id FROM telegram_updates", { table: "telegram_updates" }))).toBe(true);
    db.prepare("INSERT INTO leads (id, email) VALUES ('9','dup@b.c')").run();
    expect(duplicateIsOk(fails("INSERT INTO leads (id, email) VALUES ('10','dup@b.c')", { table: "leads" }))).toBe(true);
  });
});
