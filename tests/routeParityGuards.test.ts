import { describe, it, expect } from "vitest";
import { assertSelectOnly, selectOnlyRunner, throwawayRunner, getOnlyFetch, ReadOnlyViolation, LIVE_D1_ID, SCRATCH_D1_ID, type Attempt } from "./helpers/readOnlyBackends";

/**
 * The route-parity harness (tests/routeParity.test.ts) runs real handlers
 * against LIVE Supabase and LIVE D1. These guards are the only thing between a
 * GET handler that happens to write and production data, so they are proven
 * here first — offline, on every `npm test`.
 */
describe("assertSelectOnly — the live D1 runner only ever sends reads", () => {
  const reads = [
    `SELECT "id", "user_id" FROM "documents" WHERE "status" = ? ORDER BY "uploaded_at" DESC LIMIT ?`,
    `select count(*) as "count" from "documents"`,
    `WITH x AS (SELECT 1 AS a) SELECT a FROM x`,
    `SELECT CASE WHEN json_valid("v") THEN "v" -> ? END FROM "t"`,
    `SELECT replace(lower("email"), char(73), char(105)) FROM "sub_admins"`,
    `SELECT il."name" AS "idx$" FROM pragma_index_list(?) il`,
    `SELECT "updated_at", "deleted", "insert_count" FROM "t"`,
    `SELECT 'insert into x values (1); drop table y' AS s`,
    `SELECT 1;`,
  ];
  for (const sql of reads) it(`allows ${sql.slice(0, 60)}`, () => expect(() => assertSelectOnly(sql)).not.toThrow());

  const writes = [
    `INSERT INTO "leads" ("id") VALUES (?)`,
    `UPDATE "documents" SET "status" = ? WHERE "id" = ?`,
    `DELETE FROM "notifications" WHERE "id" = ?`,
    `REPLACE INTO "app_settings" ("key") VALUES (?)`,
    `INSERT OR REPLACE INTO "x" VALUES (1)`,
    `WITH t AS (SELECT 1) INSERT INTO "x" SELECT * FROM t`,
    `WITH t AS (SELECT 1) REPLACE INTO "x" SELECT * FROM t`,
    `WITH t AS (SELECT 1) UPDATE "x" SET a = 1`,
    `WITH t AS (SELECT 1) DELETE FROM "x"`,
    `SELECT 1; DELETE FROM "x"`,
    `CREATE TABLE "x" (a)`,
    `DROP TABLE "x"`,
    `ALTER TABLE "x" ADD COLUMN b`,
    `PRAGMA foreign_keys = OFF`,
    `select 1 /* */; insert into x values (1)`,
    `  -- comment\n  UPDATE x SET a = 1`,
    `BEGIN`,
    `VACUUM`,
    `ATTACH DATABASE 'x' AS y`,
  ];
  for (const sql of writes) it(`refuses ${sql.replace(/\s+/g, " ").slice(0, 60)}`, () => expect(() => assertSelectOnly(sql)).toThrow(ReadOnlyViolation));
});

describe("selectOnlyRunner — a write never reaches the network", () => {
  it("refuses a write before sending and records it; sends a read", async () => {
    const sent: string[] = [];
    const send = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response(JSON.stringify({ success: true, result: [{ results: [{ a: 1 }], meta: {} }] }));
    }) as typeof fetch;
    const attempts: Attempt[] = [];
    const runner = selectOnlyRunner({ send, accountId: "acc", token: "tok", databaseId: "db", attempts });

    await expect(runner.run(`UPDATE "documents" SET "status" = ?`, ["x"])).rejects.toThrow(ReadOnlyViolation);
    expect(sent).toEqual([]);
    expect(attempts).toEqual([{ kind: "sql", what: `UPDATE "documents" SET "status" = ?` }]);

    await expect(runner.run(`SELECT 1 AS a`)).resolves.toEqual({ results: [{ a: 1 }], meta: {} });
    expect(sent).toHaveLength(1);
  });
});

describe("throwawayRunner — the only runner that writes, and only to the throwaway copy", () => {
  const send = (async () => new Response(JSON.stringify({ success: true, result: [{ results: [], meta: { changes: 1 } }] }))) as unknown as typeof fetch;
  it("cannot be built for live D1 (or any other id)", () => {
    expect(() => throwawayRunner({ send, accountId: "a", token: "t", databaseId: LIVE_D1_ID })).toThrow(ReadOnlyViolation);
    expect(() => throwawayRunner({ send, accountId: "a", token: "t", databaseId: "anything-else" })).toThrow(ReadOnlyViolation);
  });
  it("writes to the throwaway copy", async () => {
    const runner = throwawayRunner({ send, accountId: "a", token: "t", databaseId: SCRATCH_D1_ID });
    await expect(runner.run(`DELETE FROM "x" WHERE "id" = ?`, ["1"])).resolves.toMatchObject({ meta: { changes: 1 } });
  });
  it("the read-only runner refuses to be pointed at the throwaway copy (no mixing them up)", () => {
    expect(() => selectOnlyRunner({ send, accountId: "a", token: "t", databaseId: SCRATCH_D1_ID })).toThrow(ReadOnlyViolation);
  });
});

describe("getOnlyFetch — Supabase is only ever read, nothing else is reached", () => {
  const ok = (async () => new Response("{}")) as unknown as typeof fetch;
  const base = "https://proj.supabase.co";

  it("lets GET and HEAD to the allowed origin through", async () => {
    const f = getOnlyFetch(ok, base);
    await expect(f(`${base}/rest/v1/documents?select=id`)).resolves.toBeInstanceOf(Response);
    await expect(f(`${base}/rest/v1/documents?select=id`, { method: "HEAD" })).resolves.toBeInstanceOf(Response);
    await expect(f(new Request(`${base}/auth/v1/admin/users`))).resolves.toBeInstanceOf(Response);
  });

  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    it(`refuses ${method} to the allowed origin and records it`, async () => {
      const attempts: Attempt[] = [];
      const f = getOnlyFetch(ok, base, attempts);
      await expect(f(`${base}/rest/v1/documents?id=eq.1`, { method })).rejects.toThrow(ReadOnlyViolation);
      expect(attempts).toEqual([{ kind: "fetch", what: `${method} proj.supabase.co/rest/v1/documents` }]);
    });
  }

  it("refuses a POST carried by a Request object", async () => {
    const f = getOnlyFetch(ok, base);
    await expect(f(new Request(`${base}/rest/v1/rpc/rl_hit`, { method: "POST", body: "{}" }))).rejects.toThrow(ReadOnlyViolation);
  });

  it("lets data: URLs through — they never leave the process", async () => {
    const f = getOnlyFetch(ok, base);
    await expect(f("data:application/octet-stream;base64,AGFzbQ==")).resolves.toBeInstanceOf(Response);
  });

  it("refuses every other host, even for GET", async () => {
    const f = getOnlyFetch(ok, base);
    await expect(f("https://api.telegram.org/botX/sendMessage?chat_id=1&text=hi")).rejects.toThrow(ReadOnlyViolation);
    await expect(f("https://api.cloudflare.com/client/v4/accounts/a/d1/database/b/query", { method: "POST" })).rejects.toThrow(ReadOnlyViolation);
    await expect(f("https://evil.supabase.co.example/rest/v1/x")).rejects.toThrow(ReadOnlyViolation);
  });
});
