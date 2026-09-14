/**
 * A D1Runner backed by node:sqlite — the engine D1 runs — for tests that need a
 * real database behind the switch, the journal or the replay without touching
 * the live D1. Returns null on a Node without node:sqlite so callers can
 * describe.skipIf() instead of failing on an old runtime.
 */
import fs from "node:fs";
import type { D1Runner } from "@/lib/d1/client";

type Row = Record<string, unknown>;
type Stmt = { run(...a: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }; all(...a: unknown[]): Row[] };
export type SqliteDb = { exec(sql: string): void; prepare(sql: string): Stmt; close(): void };

let Ctor: (new (path: string) => SqliteDb) | null = null;
try { ({ DatabaseSync: Ctor } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => SqliteDb }); }
catch { /* older Node: the tests that need it skip */ }

export const hasSqlite = Ctor !== null;

/** A fresh in-memory database, optionally with the generated D1 schema applied. */
export function openDb(opts: { schema?: boolean } = {}): SqliteDb {
  if (!Ctor) throw new Error("node:sqlite unavailable");
  const db = new Ctor(":memory:");
  if (opts.schema) db.exec(fs.readFileSync("d1/schema.sql", "utf8"));
  return db;
}

/**
 * Statements that hand rows back go through all(); everything else through
 * run(), so `meta.changes` is real — bvFetch answers a write's count from it.
 */
export function sqliteRunner(db: SqliteDb, spy?: (sql: string) => void): D1Runner {
  return {
    async run(sql, params = []) {
      spy?.(sql);
      const stmt = db.prepare(sql);
      const bound = params.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v));
      if (/^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql)) {
        return { results: stmt.all(...bound), meta: {} };
      }
      const out = stmt.run(...bound);
      return { results: [], meta: { changes: Number(out.changes), last_row_id: Number(out.lastInsertRowid) } };
    },
  };
}
