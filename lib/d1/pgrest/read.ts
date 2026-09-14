/**
 * A read, run against D1 the way PostgREST answers it (PostgREST→D1 adapter).
 *
 *   QueryIntent → buildSql() → **runSelect()** → rows + page size + total → respond()
 *
 * Most reads are one statement. Three need more, and are why this exists:
 *
 *  • count=exact on a GET. The Content-Range total is every row the filter
 *    matches, not the page: `.select("id", { count: "exact" }).range(0, 4)` is
 *    761 on Supabase, where the adapter reported 5 (the page) and a 200 instead
 *    of the 206 a partial page gets. The COUNT(*) now runs beside the page.
 *  • HEAD. No rows travel, but the header still describes the page the GET would
 *    have returned (`0-760/761`, or 416 past the end), so the page size is worked
 *    out from the COUNT(*) and the window instead of being fetched.
 *  • ORDER BY on a text column. SQLite cannot sort in Postgres' collation, so the
 *    rowid and sort keys of every matching row are fetched, sorted with
 *    collate.ts, windowed, and only that page is fetched — by rowid. The total
 *    falls out of the key count. Two statements, so a row written between them
 *    can be missing from the page; D1 has no snapshot to hold across them.
 */
import type { D1Answer } from "@/lib/d1/client";
import type { PostgrestError, QueryIntent, Registry } from "./types";
import { buildRowsByRowid, buildSql, isPostgrestError, pageWindow, SORT_ROW_LIMIT } from "./buildSql";
import { sortRows } from "./collate";
import { decodeRows } from "./decode";
import { statusForPgCode } from "./errors";

export type Run = (sql: string, params: unknown[]) => Promise<D1Answer>;

/** The page's rows (none for HEAD), how many the page holds, and the total when count=exact asked for it. */
export type ReadResult = { rows: Record<string, unknown>[]; pageCount: number; total?: number };

/** A COUNT(*) answer's one value, whatever the builder named it. */
const countOf = (answer: D1Answer) => Number(Object.values(answer.results[0] ?? { count: 0 })[0]);

function tooManyToSort(table: string): PostgrestError {
  return {
    code: "54000",
    message: `d1-adapter: an ORDER BY on a text column of '${table}' matched more than ${SORT_ROW_LIMIT} rows, the most the adapter sorts in Postgres' collation`,
    details: null,
    hint: "Narrow the filter, or order by a column that is not text.",
    status: statusForPgCode("54000"),
  };
}

export async function runSelect(requested: QueryIntent, registry: Registry, run: Run): Promise<ReadResult | PostgrestError> {
  // Supabase's db-max-rows, applied the way PostgREST's plan applies it: to the
  // window the request asked for, never past it (buildSql.ts MAX_ROWS).
  const { offset, limit } = pageWindow(requested);
  const intent: QueryIntent = { ...requested, limit };
  const built = buildSql(intent, registry);
  if (isPostgrestError(built)) return built;
  // An offset past 2^53: no table has the rows, so the page is empty.
  const pastEveryRow = intent.offsetText !== undefined;
  const withTotal = (total: number) => (intent.count ? { total } : {});

  if (intent.head) {
    const total = countOf(await run(built.sql, built.params));
    const pageCount = pastEveryRow ? 0 : Math.max(0, Math.min(limit, total - offset));
    return { rows: [], pageCount, ...withTotal(total) };
  }

  if (built.sort) {
    const keys = (await run(built.sql, built.params)).results;
    if (keys.length > SORT_ROW_LIMIT) return tooManyToSort(intent.table);
    const window = pastEveryRow ? [] : sortRows(keys, built.sort).slice(offset, offset + limit);
    const rows: Record<string, unknown>[] = [];
    if (window.length) {
      const page = buildRowsByRowid(intent, registry, window.map((k) => Number(k["rowid$"])));
      if (isPostgrestError(page)) return page;
      const byRowid = new Map((await run(page.sql, page.params)).results.map((r) => [Number(r["rowid$"]), r]));
      for (const k of window) {
        const row = byRowid.get(Number(k["rowid$"]));
        if (row) rows.push(row);
      }
    }
    const decoded = decodeRows(rows, intent, registry);
    return { rows: decoded, pageCount: decoded.length, ...withTotal(keys.length) };
  }

  const count = intent.count ? buildSql({ ...intent, head: true }, registry) : null;
  if (count && isPostgrestError(count)) return count;
  const [page, counted] = await Promise.all([
    run(built.sql, built.params),
    count ? run(count.sql, count.params) : Promise.resolve(null),
  ]);
  const rows = decodeRows(page.results, intent, registry);
  return { rows, pageCount: rows.length, ...(counted ? withTotal(countOf(counted)) : {}) };
}
