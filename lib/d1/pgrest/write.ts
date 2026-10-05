/**
 * A write, run the way Postgres runs it (the read half is lib/d1/pgrest/read.ts).
 *
 * Most writes are one statement and this is a thin wrapper. Two are not, because
 * the order Postgres decides an error in is not the order this adapter could
 * decide it in before running anything. Both were measured against PostgREST
 * 14.5's own generated SQL in PGlite 18.3 (real Postgres), not inferred:
 *
 *  • A PATCH whose payload holds a value no input function can read. PostgREST
 *    builds the row with json_to_record in a LATERAL beside the target table, and
 *    the planner makes the TABLE the outer side of that nested loop: with no
 *    matching row the function never runs, so `.update({due_date:"29.05.2004"})
 *    .eq("id", <uuid nobody has>)` is 0 rows, not 22008. buildSql.ts then hands
 *    back `SELECT 1 … LIMIT 1` plus the error it withheld, and this file decides.
 *
 *  • An upsert whose own rows repeat the conflict key. Postgres reaches its 21000
 *    only at the repeated row, after checking every earlier row, so a NOT NULL or
 *    CHECK violation before it wins (23502 / 23514). buildSql.ts leaves the ON
 *    CONFLICT clause off so SQLite walks the rows the same way; this file first
 *    proves the target really is a unique index, because without the clause it is
 *    the index — not the adapter — that refuses the repeat.
 */
import type { D1Answer } from "@/lib/d1/client";
import type { BuiltQuery, PostgrestError, QueryIntent, Registry } from "./types";
import { buildSql, isPostgrestError, uniqueIndexColumnsSql } from "./buildSql";
import { noMatchingConstraint, toPostgrestError } from "./errors";

export type Run = (sql: string, params: unknown[]) => Promise<D1Answer>;

/** The rows RETURNING gave back (still encoded) and how many rows the write touched. */
export type WriteResult = { rows: Record<string, unknown>[]; changes?: number };

/** Whether some unique index of the table is exactly these columns. */
function hasUniqueIndexOn(rows: Record<string, unknown>[], target: readonly string[]): boolean {
  const want = new Set(target);
  const byIndex = new Map<string, { width: number; matched: Set<string> }>();
  for (const row of rows) {
    const idx = byIndex.get(String(row["idx$"])) ?? { width: 0, matched: new Set<string>() };
    const col = row["col$"];
    // An expression index's column comes back NULL: it counts toward the width,
    // so such an index can never be as narrow as the target it is compared to.
    if (typeof col === "string" && want.has(col)) idx.matched.add(col);
    idx.width += 1;
    byIndex.set(String(row["idx$"]), idx);
  }
  for (const idx of byIndex.values()) {
    if (idx.width === want.size && idx.matched.size === want.size) return true;
  }
  return false;
}

export async function runWrite(intent: QueryIntent, registry: Registry, run: Run): Promise<WriteResult | PostgrestError> {
  const built: BuiltQuery | PostgrestError = buildSql(intent, registry);
  if (isPostgrestError(built)) return built;

  // The PATCH probe: the statement is a SELECT, so it writes nothing either way.
  if (built.refuseIfMatched) {
    try {
      const matched = await run(built.sql, built.params);
      return matched.results.length ? built.refuseIfMatched : { rows: [], changes: 0 };
    } catch (err) {
      return toPostgrestError(err, { table: intent.table });
    }
  }

  const repeatedConflictKey = built.repeatedConflictKey;
  if (repeatedConflictKey) {
    // The primary key needs no lookup, and pragma_index_list does not list the
    // index of an INTEGER PRIMARY KEY at all — so asking would answer 42P10 for a
    // target that is unique by definition.
    const pk = registry[intent.table]?.pk ?? [];
    const isPk = pk.length === repeatedConflictKey.length && repeatedConflictKey.every((c) => pk.includes(c));
    if (!isPk) {
      const probe = uniqueIndexColumnsSql(intent.table);
      try {
        const indexes = await run(probe.sql, probe.params);
        if (!hasUniqueIndexOn(indexes.results, repeatedConflictKey)) return noMatchingConstraint();
      } catch (err) {
        return toPostgrestError(err, { table: intent.table });
      }
    }
  }

  try {
    const answer = await run(built.sql, built.params);
    return { rows: answer.results, changes: answer.meta?.changes };
  } catch (err) {
    return toPostgrestError(err, { table: intent.table, repeatedConflictKey });
  }
}
