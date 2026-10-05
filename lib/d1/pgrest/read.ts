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
 *    rowids and sort keys of the rows that can reach the page are fetched, sorted
 *    with collate.ts, windowed, and only that page is fetched — by rowid. Keys of
 *    plain-ASCII rows arrive already cut at the page's end (buildSql.ts
 *    textOrderQuery); every other row's keys arrive whole. Two statements, three
 *    when count=exact needs a COUNT, so a row written between them can be missing
 *    from the page; D1 has no snapshot to hold across them.
 *
 * The keys statement, measured on the D1 copy (keys sent to the Worker, D1 rows_read):
 *
 *   documents?select=id&order=file_type.asc,id.asc&limit=1             761 keys 70,389 B,  761 read -> 122 keys 12,056 B, 2,162 read
 *   documents?select=*&order=file_name.asc,id.asc&limit=50, count      761 keys 94,150 B,  761 read ->  50 keys  6,303 B, 2,283 read + 761 COUNT
 *   notifications?select=id&order=doc_name.asc,id.asc&limit=20        360 keys 45,141 B,  360 read ->  24 keys  3,007 B, 1,076 read
 *   messages?select=id&order=body.asc,id.asc&limit=20                   92 keys  9,751 B,   92 read ->  31 keys  3,103 B,   265 read
 *   admin_notifications?select=id&order=user_email.asc,id.asc&limit=20 647 keys 62,763 B,  647 read ->  20 keys  1,493 B, 1,941 read
 *
 * The page by rowid is the same statement as before (3 rows read per row fetched).
 *
 * What remains, and why:
 *  • D1 reads each matching row up to three times — two scans and the sort of the
 *    plain rows — where it read it once, and rows_read is what D1 bills. It is the
 *    cheapest narrowed shape measured: a window function read 4 to 6 times the
 *    rows, a MATERIALIZED CTE 3.8.
 *  • A page that reaches the end of the plain rows still sends every key — the
 *    whole small tables the real call sites order by name. documents by file_name
 *    with no limit ships all 761 keys (94,150 B) and reads 2,283 rows, its total
 *    taken from the keys; an offset-600 page of admin_notifications ships all 647
 *    and adds a 647-row COUNT.
 *  • Keys that are not plain ASCII always travel whole (897 of the copy's 18,572
 *    non-null text values: accents, Arabic, emoji), and past SORT_ROW_LIMIT of
 *    them the read is still refused with 54000.
 * In return the Worker collates only keys that can reach the page. It used to
 * collate every match — 1.4 to 1.9 ms of CPU per read of documents — and in Node
 * 10,000 keys take 53 ms and 100,000 take 656 ms, plus 73 ms to parse them.
 */
import type { D1Answer } from "@/lib/d1/client";
import type { PostgrestError, QueryIntent, Registry, SortKey } from "./types";
import { buildRowsByRowid, buildSql, isPostgrestError, pageWindow, SORT_ROW_LIMIT } from "./buildSql";
import { sortRows } from "./collate";
import { decodeRows } from "./decode";
import { statusForPgCode } from "./errors";

export type Run = (sql: string, params: unknown[]) => Promise<D1Answer>;

/** The page's rows (none for HEAD), how many the page holds, and the total when count=exact asked for it. */
export type ReadResult = { rows: Record<string, unknown>[]; pageCount: number; total?: number };

/** The last key of every text sort: rowid, a number, ascending. */
const ROWID_LAST: SortKey = { key: "rowid$", text: false, ascending: true, nullsFirst: false };

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
    // Fewer keys than the plain rows' cut: the cut was never reached, so these are
    // every matching row's keys and their number is the total. Only a read that
    // reached the cut needs a COUNT. Deciding after the keys, not counting beside
    // them, is what spares the real call sites — a whole small table ordered by
    // name — a second read of the table for a total they already hold.
    const everyMatch = built.plainCut === undefined || keys.length < built.plainCut;
    const count = intent.count && !everyMatch ? buildSql({ ...intent, head: true }, registry) : null;
    if (count && isPostgrestError(count)) return count;
    // rowid last: the tie-break the SQL used when it chose which plain rows to send.
    // Without it, rows tied on every key keep whatever order the UNION returned
    // them in — a tie could straddle the cut, and two offset pages could each show,
    // or each skip, the same row.
    const window = pastEveryRow ? [] : sortRows(keys, [...built.sort, ROWID_LAST]).slice(offset, offset + limit);
    const page = window.length ? buildRowsByRowid(intent, registry, window.map((k) => Number(k["rowid$"]))) : null;
    if (page && isPostgrestError(page)) return page;
    const [fetched, counted] = await Promise.all([
      page ? run(page.sql, page.params) : Promise.resolve(null),
      count ? run(count.sql, count.params) : Promise.resolve(null),
    ]);
    const pageRows = new Map((fetched?.results ?? []).map((r) => [Number(r["rowid$"]), r]));
    const rows: Record<string, unknown>[] = [];
    for (const k of window) {
      const row = pageRows.get(Number(k["rowid$"]));
      if (row) rows.push(row);
    }
    const decoded = decodeRows(rows, intent, registry);
    return { rows: decoded, pageCount: decoded.length, ...withTotal(counted ? countOf(counted) : keys.length) };
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
