/**
 * The contract between the pieces of the PostgREST→D1 adapter.
 *
 * supabase-js talks HTTP: it turns `.from("documents").select("*").eq("user_id", x)`
 * into `GET /rest/v1/documents?select=*&user_id=eq.<x>`. The adapter answers those
 * requests from D1 instead of Supabase, so the 1,261 call sites in this codebase
 * keep working untouched (Supabase → D1 migration, step 3).
 *
 * Flow:  Request → parseRequest() → QueryIntent → buildSql() → {sql, params}
 *        → D1 → decodeRows() → respond() → Response
 * Errors from D1 go through toPostgrestError() so the ~43 places that branch on
 * Postgres codes (23505 duplicate, 42703 missing column, PGRST205 missing table…)
 * keep behaving the same.
 *
 * ONLY what this codebase actually uses is in scope (measured, not guessed):
 * filters eq/neq/gt/gte/lt/lte/in/is/like/ilike/not/or, order, limit, range,
 * single/maybeSingle, count:exact+head, insert/update/delete/upsert with
 * onConflict + ignoreDuplicates, mutations returning rows, and ONE json path
 * alias (`cv_langs:cv_draft->langs`). No embedded joins, no text search, no csv.
 */

/** Postgres type of a column, from d1/types.json (the generated registry). */
export type PgType =
  | "uuid" | "text" | "timestamptz" | "date" | "boolean"
  | "integer" | "bigint" | "numeric" | "jsonb" | "text[]" | "uuid[]";

export type ColumnMeta = { pg: PgType; nullable: boolean; default: unknown; generated: boolean };
export type TableMeta = { columns: Record<string, ColumnMeta>; pk: string[]; fks: { column: string; table: string; ref: string }[] };
export type Registry = Record<string, TableMeta>;

/** One requested output column. `jsonPath` is set only for `alias:col->key`. */
export type SelectItem = { column: string; alias?: string; jsonPath?: string };

export type FilterOp =
  | "eq" | "neq" | "gt" | "gte" | "lte" | "lt"
  | "like" | "ilike" | "is" | "isdistinct" | "in" | "cs" | "cd" | "ov";

/** A leaf condition, e.g. `status=eq.approved` or `org_id=is.null`. */
export type Condition = {
  kind: "cmp";
  column: string;
  op: FilterOp;
  /** Already-decoded value: string | number | boolean | null | array (`in`, `cs`/`cd`/`ov`, quantified ops). */
  value: unknown;
  /** `not.` prefix — PostgREST's negation. */
  negate?: boolean;
  /** `like(any).{a,b}` / `gt(all).{1,2}`: `value` is the list, combined with ANY (OR) or ALL (AND). */
  quant?: "any" | "all";
};

/** `or=(a.eq.1,and(b.is.null,c.eq.2))` parses into these trees; `not.and(…)` sets `negate`. */
export type Group = { kind: "and" | "or"; children: Where[]; negate?: boolean };
export type Where = Condition | Group;

export type OrderBy = { column: string; ascending: boolean; nullsFirst?: boolean };

export type ReturnMode = "representation" | "minimal";

export type QueryIntent = {
  /** "select" also covers a HEAD count request (`head` + `count`). */
  action: "select" | "insert" | "update" | "delete" | "upsert";
  table: string;
  select: SelectItem[] | "*";
  where: Where[];                 // implicitly AND-ed
  order: OrderBy[];
  limit?: number;
  offset?: number;
  /** `Accept: application/vnd.pgrst.object+json` — .single() / .maybeSingle(). */
  singleObject?: boolean;
  /** true when .single() must fail on 0 rows (PGRST116); false for maybeSingle. */
  requireExactlyOne?: boolean;
  count?: "exact";
  head?: boolean;
  returning: ReturnMode;
  /** insert / upsert / update payload — always an array for inserts. */
  values?: Record<string, unknown>[];
  /** upsert: `on_conflict=user_id` (comma separated) + Prefer resolution. */
  onConflict?: string[];
  ignoreDuplicates?: boolean;
  /**
   * `columns="a","b"`: the columns a write sets. supabase-js sends it with every
   * array insert/upsert (the union of the rows' keys). A row without one of them
   * writes NULL there — or the column default under `missingDefault`.
   */
  columns?: string[];
  /** `Prefer: missing=default` — `.insert(rows, { defaultToNull: false })`. */
  missingDefault?: boolean;
};

export type BuiltQuery = { sql: string; params: unknown[] };

/** What a failed query must look like to callers (PostgREST's error body). */
export type PostgrestError = {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
  /** HTTP status the adapter should answer with. */
  status: number;
};
