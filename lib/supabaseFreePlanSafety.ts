/**
 * The two protections Supabase needs once it only holds the logins and is
 * downgraded to the Free plan (docs/cutover-runbook.md, "Before downgrading
 * Supabase to Free").
 *
 *   KEEP-ALIVE  Free pauses a project whose database sees no activity for about
 *               7 days. After DATA_BACKEND="d1" every data read goes to D1, so a
 *               quiet week would pause Supabase and the next morning no candidate
 *               could log in. One real counted query a day prevents it.
 *   BACKUP      Free has no backups at all, and auth.users (above all the bcrypt
 *               password hashes) is the one table D1 does not hold. One encrypted
 *               copy a day goes to R2; the newest 30 are kept.
 *
 * NEVER THROUGH THE SERVICE CLIENT. getServiceSupabase() answers from D1 when
 * DATA_BACKEND="d1", so a keep-alive built on it would keep D1 awake, let Supabase
 * pause, and report "ok" the whole time. Both reads here are plain fetches to
 * Supabase's own URL with the service key, and this file imports nothing from
 * lib/supabase or lib/d1 (tests/supabaseFreePlanSafety.test.ts holds it to that).
 *
 * Rides the 06:00 briefing cron: no new trigger. Never throws, because a broken
 * backup must not cost the founder his briefing. Failures are loud instead:
 * Telegram AND email, like the health watchdog, since email still reaches him
 * while Telegram is silenced.
 */
import { parseBackupKey, encryptBackup, decryptBackup } from "@/lib/authBackupCrypto";

type Env = Record<string, string | undefined>;
type Log = Pick<Console, "log" | "warn" | "error">;

export type BackupStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Every key under the prefix. */
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
};

export type SafetyDeps = {
  env: Env;
  fetch: typeof fetch;
  store: () => Promise<BackupStore>;
  /** title + facts go to Telegram; advice is added to the email only. */
  alert: (title: string, detail: string, advice: string) => Promise<void>;
  now: () => Date;
  log: Log;
  pageSize: number;
};

export const BACKUP_PREFIX = "backups/auth-users/";
export const BACKUP_KEEP = 30;
const BACKUP_KEY_RE = /^backups\/auth-users\/\d{4}-\d{2}-\d{2}\.json\.enc$/;
const TIMEOUT_MS = 15_000;
const MAX_PAGES = 1000;

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

function supabaseTarget(env: Env): { url: string; headers: Record<string, string> } | null {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  return { url, headers: { apikey: key, authorization: `Bearer ${key}` } };
}

/* ─────────────────────────────── keep-alive ─────────────────────────────── */

export type KeepAliveResult = { ok: true; rows: number | null } | { ok: false; detail: string };

/**
 * A counted HEAD on app_settings through PostgREST: Postgres runs a real
 * count(*), nothing crosses the wire. Not the auth schema (PostgREST answers
 * PGRST106, it is not exposed) and not /auth/v1/health, which answers without
 * touching the database — neither would count as activity. app_settings is a
 * three-row table that stays in Supabase after the switch: the runbook keeps
 * every table as the rollback target.
 */
export async function supabaseKeepAlive(deps: Pick<SafetyDeps, "env" | "fetch">): Promise<KeepAliveResult> {
  const t = supabaseTarget(deps.env);
  if (!t) return { ok: false, detail: "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing" };
  try {
    const res = await deps.fetch(`${t.url}/rest/v1/app_settings?select=key`, {
      method: "HEAD",
      headers: { ...t.headers, prefer: "count=exact" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
    return { ok: true, rows: total ? Number(total[1]) : null };
  } catch (e) {
    return { ok: false, detail: errText(e) };
  }
}

/* ───────────────────────────────── backup ───────────────────────────────── */

export type BackupResult =
  | { state: "skipped" }
  | { state: "written"; key: string; accounts: number; bytes: number; pruned: number; pruneError?: string }
  | { state: "failed"; detail: string };

type Account = Record<string, unknown> & { id: string };

/** Only the error code and PostgREST's message: they name functions and columns, never a row. */
async function rpcFailure(res: Response): Promise<string> {
  let code = "";
  let message = "";
  try {
    const j = (await res.json()) as { code?: unknown; message?: unknown };
    code = typeof j?.code === "string" ? j.code : "";
    message = typeof j?.message === "string" ? j.message.slice(0, 160) : "";
  } catch { /* not JSON */ }
  if (res.status === 404 && code === "PGRST202") {
    return "supabase/auth_users_backup.sql has not been run in Supabase (the export function is missing)";
  }
  return `export HTTP ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`;
}

/**
 * Every account, a page at a time (keyset on id), through the read-only function
 * in supabase/auth_users_backup.sql. GET, so nothing here can write to Supabase.
 *
 * Refuses a partial export rather than sealing it: a backup that silently lacks
 * the newest accounts is found out only on the day it is needed.
 */
async function exportAccounts(deps: SafetyDeps, t: { url: string; headers: Record<string, string> }): Promise<Account[]> {
  const out: Account[] = [];
  let expected: number | null = null;
  let after: string | null = null;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error("export did not finish within the page limit");
    const q = new URLSearchParams({ page_size: String(deps.pageSize) });
    if (after) q.set("after_id", after);
    const res = await deps.fetch(`${t.url}/rest/v1/rpc/bv_auth_users_backup_page?${q}`, {
      method: "GET",
      headers: { ...t.headers, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(await rpcFailure(res));
    const body = (await res.json()) as { total?: unknown; users?: unknown };
    if (!Array.isArray(body?.users) || typeof body.total !== "number") throw new Error("export answered an unexpected shape");
    expected ??= body.total;
    const users = body.users as Account[];
    for (const u of users) {
      if (typeof u?.id !== "string") throw new Error("export returned an account without an id");
      out.push(u);
    }
    if (users.length < deps.pageSize) break;
    const last = users[users.length - 1].id;
    // A page that ends where the last one did would loop until the page limit.
    if (last === after) throw new Error("export pagination did not advance");
    after = last;
  }
  if (new Set(out.map((u) => u.id)).size !== out.length) throw new Error("export returned the same account twice");
  if (out.length === 0) throw new Error("export returned no accounts");
  // >= and not ===: an account created during the export is allowed to land in it.
  if (expected !== null && out.length < expected) throw new Error(`export incomplete: ${out.length} of ${expected} accounts`);
  return out;
}

/**
 * Keep the NEWEST 30 backups, not "the last 30 calendar days". The two are the
 * same while the cron runs daily; they differ exactly when it matters — after a
 * month of failed runs, a date rule would delete every good backup the moment
 * the first new one landed. Only keys this job writes are candidates, and
 * nothing is deleted unless today's backup is visible in the listing.
 */
async function pruneBackups(store: BackupStore, todayKey: string): Promise<number> {
  const keys = (await store.list(BACKUP_PREFIX)).filter((k) => BACKUP_KEY_RE.test(k)).sort().reverse();
  if (!keys.includes(todayKey)) throw new Error("today's backup is not in the listing, so nothing was pruned");
  const doomed = keys.slice(BACKUP_KEEP);
  for (const k of doomed) await store.delete(k);
  return doomed.length;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Never throws. */
export async function authUsersBackup(deps: SafetyDeps): Promise<BackupResult> {
  const parsed = parseBackupKey(deps.env.AUTH_BACKUP_KEY);
  // Absent = not set up yet (deployed before `wrangler secret put`): one line, nothing else.
  if (parsed.state === "absent") {
    deps.log.warn("[auth-backup] AUTH_BACKUP_KEY is not set: login backup skipped");
    return { state: "skipped" };
  }
  if (parsed.state === "malformed") {
    return { state: "failed", detail: "AUTH_BACKUP_KEY is malformed (it must be 32 random bytes, base64): no backup written" };
  }
  const t = supabaseTarget(deps.env);
  if (!t) return { state: "failed", detail: "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing" };
  try {
    const accounts = await exportAccounts(deps, t);
    const now = deps.now();
    const plain = new TextEncoder().encode(JSON.stringify({
      format: "borivon-auth-users",
      version: 1,
      exported_at: now.toISOString(),
      supabase_host: new URL(t.url).host,
      accounts: accounts.length,
      users: accounts,
    })) as Uint8Array<ArrayBuffer>;
    const sealed = await encryptBackup(plain, parsed.key);
    // Open it again before storing. A file that cannot be opened is discovered
    // on the day logins have to be restored, which is the one day it is too late.
    if (!sameBytes(await decryptBackup(sealed, parsed.key), plain)) throw new Error("the sealed backup did not open back to the export");

    const key = `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.json.enc`;
    const store = await deps.store();
    await store.put(key, sealed, "application/octet-stream");

    let pruned = 0;
    let pruneError: string | undefined;
    try {
      pruned = await pruneBackups(store, key);
    } catch (e) {
      pruneError = errText(e);
    }
    // warn, not log: next.config's removeConsole strips console.log in production,
    // and the runbook's Day-3 check looks for this exact line in the Worker logs.
    deps.log.warn(`[auth-backup] ok ${key} accounts=${accounts.length} bytes=${sealed.length} pruned=${pruned}`);
    return { state: "written", key, accounts: accounts.length, bytes: sealed.length, pruned, ...(pruneError ? { pruneError } : {}) };
  } catch (e) {
    return { state: "failed", detail: errText(e) };
  }
}

/* ───────────────────────────────── runner ───────────────────────────────── */

const KEEPALIVE_ADVICE =
  "Supabase now only runs the logins. On the Free plan a project with no database activity for about 7 days is paused, " +
  "and then nobody can log in. Check the project at https://supabase.com/dashboard (Restore it if it is paused).";
const BACKUP_ADVICE =
  "No login backup was written today. The older backups in R2 (backups/auth-users/) are untouched. " +
  "See docs/cutover-runbook.md, \"Before downgrading Supabase to Free\".";

/** Telegram for the founder's chat, email because it survives the Telegram silence. Each best-effort. */
async function defaultAlert(title: string, detail: string, advice: string): Promise<void> {
  const text = `${title}\n${detail}`;
  try {
    const tg = await import("@/lib/telegram");
    const chat = (process.env.TELEGRAM_CHAT_ID || "").trim();
    if (tg.telegramConfigured() && chat) await tg.tgSend(chat, text);
  } catch (e) {
    console.error("[supabase-safety] telegram alert failed:", errText(e));
  }
  try {
    const { sendAdminAlertEmail } = await import("@/lib/email");
    await sendAdminAlertEmail(`Borivon: ${title}`, `${text}\n\n${advice}\n\nChecked at ${new Date().toISOString()}.`);
  } catch (e) {
    console.error("[supabase-safety] email alert failed:", errText(e));
  }
}

function defaultDeps(): SafetyDeps {
  return {
    env: process.env,
    // Looked up at call time, so nothing captured at import can stand in for it.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch,
    store: async () => {
      const r2 = await import("@/lib/r2");
      return {
        put: (key, body, contentType) => r2.r2Put(key, body, contentType),
        list: async (prefix) => (await r2.r2List(prefix)).map((o) => o.key),
        delete: (key) => r2.r2Delete(key),
      };
    },
    alert: defaultAlert,
    now: () => new Date(),
    log: console,
    pageSize: 500,
  };
}

export type SafetySummary = { keepAlive: "ok" | "failed"; backup: BackupResult["state"] };

/** The daily pass. Resolves whatever happens: every failure is logged and alerted instead. */
export async function runSupabaseFreePlanSafety(overrides: Partial<SafetyDeps> = {}): Promise<SafetySummary> {
  const summary: SafetySummary = { keepAlive: "failed", backup: "failed" };
  try {
    const deps: SafetyDeps = { ...defaultDeps(), ...overrides };
    const loud = async (title: string, detail: string, advice: string) => {
      deps.log.error(`[supabase-safety] ${title}: ${detail}`);
      try {
        await deps.alert(title, detail, advice);
      } catch (e) {
        deps.log.error("[supabase-safety] alert failed:", errText(e));
      }
    };

    const alive = await supabaseKeepAlive(deps);
    if (alive.ok) {
      summary.keepAlive = "ok";
      // warn, not log: removeConsole strips console.log in production (see [auth-backup] ok).
      deps.log.warn(`[supabase-keepalive] ok (app_settings rows=${alive.rows ?? "?"})`);
    } else {
      await loud("Supabase keep-alive failed", alive.detail, KEEPALIVE_ADVICE);
    }

    const backup = await authUsersBackup(deps);
    summary.backup = backup.state;
    if (backup.state === "failed") await loud("Login backup failed", backup.detail, BACKUP_ADVICE);
    if (backup.state === "written" && backup.pruneError) {
      await loud("Login backup written, old backups not pruned", backup.pruneError, BACKUP_ADVICE);
    }
  } catch (e) {
    try { console.error("[supabase-safety] crashed:", errText(e)); } catch { /* never throw */ }
  }
  return summary;
}
