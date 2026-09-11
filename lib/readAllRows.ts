/**
 * Read EVERY row of a query, page by page.
 *
 * Supabase (PostgREST) silently caps a response at 1000 rows — verified live
 * 2026-09-11: an unbounded select on rate_limits returned exactly 1000 with
 * Content-Range 0-999/24226. No error, no warning: the list just ends. Tables
 * the admin screens read whole (documents 734 rows, candidate_journey_items
 * 889) were weeks away from that line, after which the admin panel, chase list,
 * reminders and reports would quietly start missing documents.
 *
 * Usage — pass a FACTORY, because each page needs a fresh query:
 *   const docs = await readAllRows<Doc>((from, to) =>
 *     db.from("documents").select("id, user_id, status").order("id").range(from, to));
 *
 * The query MUST have a stable, unique order (add `.order("id")` as the last
 * tie-breaker), or rows can shift between pages and be skipped or repeated.
 *
 * Returns { data, error } like supabase-js, so call sites keep their handling.
 * On a failed page it returns that page's error and NO data — a partial list
 * that looks complete is exactly the bug this exists to prevent.
 */
export const PAGE_SIZE = 1000;
const MAX_PAGES = 200; // 200k rows — far beyond anything here; stops a runaway loop

type PageResult = { data: unknown; error: unknown };

export async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<{ data: T[] | null; error: { message?: string; code?: string } | null }> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error: error as { message?: string; code?: string } };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return { data: out, error: null };
  }
  return { data: null, error: { message: `readAllRows: more than ${MAX_PAGES * PAGE_SIZE} rows` } };
}
