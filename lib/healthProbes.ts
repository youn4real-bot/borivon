import { getServiceSupabase } from "@/lib/supabase";
import type { D1Runner } from "@/lib/d1/client";

/**
 * Dependency probes — the single source of truth for "is this portal actually working".
 *
 * Shared by TWO callers so they can never disagree:
 *   • GET /api/health?deep=1        — public, boolean-only, so the state can be checked
 *                                     from outside without a secret (and by an uptime monitor)
 *   • GET /api/cron/health-watch    — the daily watchdog that sends the founder a Telegram
 *                                     message, with the detail strings attached
 *
 * That split matters: the watchdog is the thing that WAKES somebody, and a watchdog you
 * cannot inspect is a watchdog you cannot trust. Being able to curl the public endpoint
 * and see the same verdict is how you confirm the alerting is calibrated before it has
 * ever needed to fire.
 *
 * DISCLOSURE RULE (matches the pre-existing /api/health policy): the public caller emits
 * BOOLEANS ONLY. Whether an integration is up is an uptime fact, not a secret. WHICH
 * environment variable is missing is a configuration detail and stays in `detail`, which
 * only the authenticated cron and the server log ever see.
 */

export type Probe = {
  /** Stable subsystem name. Public — appears in the /api/health body. */
  name: "google" | "drive" | "r2" | "database" | "email" | "auth" | "journal";
  ok: boolean;
  /** Human-readable cause. PRIVATE — never returned to an unauthenticated caller. */
  detail?: string;
};

/** Bound every probe so one hanging dependency cannot eat the whole cron slot. */
const PROBE_TIMEOUT_MS = 12_000;

async function withTimeout<T>(label: string, p: Promise<T>): Promise<T> {
  return await Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS),
    ),
  ]);
}

/** Never let a probe throw — a health check that dies is worse than none. */
async function guard(name: Probe["name"], fn: () => Promise<Probe>): Promise<Probe> {
  try {
    return await withTimeout(name, fn());
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Google Workspace. Imported lazily so a caller where Google is irrelevant never
 * pulls the Workspace client into the isolate at all.
 *
 * Google fails SILENTLY everywhere it is used: booking's busyIntervals() catches
 * everything and returns [], so a completely dead calendar client still renders a
 * perfectly normal-looking slot list. This probe is the only thing that tells them apart.
 */
/**
 * ONE live Workspace check, reported as TWO probes.
 *
 * `google` keeps meaning exactly what it meant before — the domain-wide
 * delegation works and Gmail answers. `drive` is separate because the two fail
 * separately: the Drive API is enabled in the GCP project on its own and
 * delegated on its own, so a healthy Gmail says nothing about whether an agency
 * can receive a dossier. Folding Drive into `google` would also hide it, since a
 * green `google` is the line anyone reads first.
 *
 * This is the failure that already happened. After the Cloudflare migration the
 * Drive client could not run at all, every caller caught and logged, and the
 * sync reported success while copying nothing — for five months, with the health
 * probe reporting google:true the whole time. Now that is a row of its own.
 *
 * Split from a single testWorkspace() call rather than probed twice, because two
 * calls would double the daily API traffic to learn nothing extra.
 */
async function checkWorkspace(): Promise<[Probe, Probe]> {
  const { testWorkspace } = await import("@/lib/googleWorkspace");
  const res = await testWorkspace();
  if (!res.ok) {
    // "not_configured" is NOT a free pass. Google IS configured in production, so
    // reaching this branch there means the credentials were lost or rotated away —
    // which kills the Drive mirror, Gmail and Calendar just as dead as an auth error.
    const detail = res.error === "not_configured"
      ? "credentials missing — Drive mirror, Gmail and Calendar are all dead"
      : res.error;
    return [{ name: "google", ok: false, detail }, { name: "drive", ok: false, detail }];
  }
  return [
    { name: "google", ok: true, detail: res.calendar ? "gmail+calendar" : "gmail only" },
    res.drive
      ? { name: "drive", ok: true }
      : { name: "drive", ok: false, detail: "auth works but Drive does not answer — candidate dossiers are not reaching the agencies" },
  ];
}

/**
 * R2 — where every candidate document actually lives since 2026-06-09.
 * A LIST on a prefix expected to be empty proves credentials + binding + network
 * without reading anyone's file. Zero results is a PASS: this tests reachability,
 * not contents.
 */
async function checkR2(): Promise<Probe> {
  const { r2Configured, r2List } = await import("@/lib/r2");
  if (!r2Configured()) return { name: "r2", ok: false, detail: "not configured — documents cannot be served" };
  await r2List("__healthcheck__/");
  return { name: "r2", ok: true };
}

/** One cheap counted read against the table the portal cannot work without. */
async function checkDatabase(): Promise<Probe> {
  const { error, count } = await getServiceSupabase()
    .from("documents")
    .select("*", { count: "exact", head: true });
  // supabase-js RESOLVES with { error } instead of throwing — checking only for a
  // thrown exception here would report a dead database as healthy.
  if (error) return { name: "database", ok: false, detail: error.message || "unknown error" };
  return { name: "database", ok: true, detail: `${count} documents` };
}

/**
 * Logins. Since DATA_BACKEND="d1" the `database` probe reads D1, so a paused or
 * down Supabase — the Free plan pauses a quiet project; then NOBODY can log in —
 * left every hourly probe green. Only the 06:00 keep-alive would notice, up to a
 * day later. GoTrue's health endpoint answers only while the project is up.
 */
async function checkAuth(): Promise<Probe> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return { name: "auth", ok: false, detail: "Supabase URL or anon key missing — nobody can log in" };
  const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  await res.body?.cancel().catch(() => {});
  return res.ok
    ? { name: "auth", ok: true }
    : { name: "auth", ok: false, detail: `Supabase auth answered HTTP ${res.status} — logins fail (paused project?)` };
}

/** Tables every one of whose rows is inserted through the journaled service client, with their insert time. */
export const JOURNAL_WATCHED: readonly (readonly [table: string, column: string])[] = [
  ["notifications", "created_at"],
  ["admin_notifications", "created_at"],
  ["messages", "created_at"],
  ["documents", "uploaded_at"],
  ["leads", "created_at"],
];

/** How long a journal insert may trail its write (it runs after the response). */
export const JOURNAL_LAG_MS = 10 * 60_000;

/**
 * The rollback journal (lib/d1/writeJournal.ts) — D1 only. A write it fails to
 * record is a write a rollback silently loses, and the only signal was a
 * "[write-journal] LOST" line nobody reads. Proof here instead: the newest row
 * of each watched table must have a journaled insert into that table no older
 * than itself (minus the background lag). A row newer than the journal's first
 * entry (the copy's own rows are older) and newer than every journaled insert
 * into its table was written without the journal.
 */
export async function checkJournal(runner: D1Runner, now = Date.now()): Promise<Probe> {
  const parts = JOURNAL_WATCHED.map(([t, c], i) =>
    `(SELECT max("${c}") FROM "${t}") AS "row${i}", ` +
    // POST and PATCH: the page organiser and replace-passport-pdf move
    // documents.uploaded_at forward with an UPDATE, so its newest value can
    // belong to a journaled PATCH, not an insert.
    `(SELECT max("at") FROM "_write_journal" WHERE "method" IN ('POST', 'PATCH') AND ("path" = '/rest/v1/${t}' OR "path" LIKE '/rest/v1/${t}?%')) AS "jn${i}"`);
  let row: Record<string, unknown>;
  try {
    row = (await runner.run(`SELECT (SELECT min("at") FROM "_write_journal") AS "first", ${parts.join(", ")}`)).results[0] ?? {};
  } catch (e) {
    // No journal table: D1 has not answered a write yet. Nothing to compare with.
    if (/no such table/i.test(e instanceof Error ? e.message : String(e))) return { name: "journal", ok: true, detail: "no journal yet" };
    throw e;
  }
  const first = Date.parse(String(row.first ?? ""));
  const lost = JOURNAL_WATCHED.filter((_, i) => {
    const newest = Date.parse(String(row[`row${i}`] ?? ""));
    if (!Number.isFinite(newest) || !Number.isFinite(first) || newest < first - JOURNAL_LAG_MS || newest > now) return false;
    const journaled = Date.parse(String(row[`jn${i}`] ?? ""));
    return !Number.isFinite(journaled) || newest > journaled + JOURNAL_LAG_MS;
  }).map(([t]) => t);
  return lost.length
    ? { name: "journal", ok: false, detail: `newest ${lost.join(", ")} row(s) are not in the rollback journal — a rollback would lose them (search the logs for "[write-journal] LOST")` }
    : { name: "journal", ok: true };
}

/**
 * Email is a CONFIG probe, not a reachability probe: actually sending a test
 * email costs money and lands in somebody's inbox every single day. Presence of
 * the key is the honest thing to check daily.
 */
function checkEmail(): Probe {
  return process.env.RESEND_API_KEY
    ? { name: "email", ok: true }
    : { name: "email", ok: false, detail: "RESEND_API_KEY missing — no email of any kind can be sent" };
}

/*
 * NO PAYMENTS PROBE, and no payments.
 *
 * The paid plan was removed on 2026-09-20 — code, routes and dependency. There is
 * nothing left to probe, so there is nothing here. Before that the probe had
 * already been dropped for a second reason worth keeping in mind if payments ever
 * come back: it reported payments:false every morning at 05:00 because the key was
 * never set, and a watchdog that cries wolf daily is one you learn to ignore —
 * which would have quietly destroyed its value for Google, R2 and email, the three
 * that actually matter.
 */

async function journalProbe(): Promise<Probe> {
  const { getD1 } = await import("@/lib/d1/client");
  const runner = await getD1();
  if (!runner) return { name: "journal", ok: false, detail: "D1 is not reachable from this runtime" };
  return checkJournal(runner);
}

/** Run every probe concurrently. Never throws. */
export async function runHealthProbes(): Promise<Probe[]> {
  const onD1 = process.env.DATA_BACKEND === "d1";
  const [workspace, r2, database, auth, journal] = await Promise.all([
    // A throw or a hang here must not lose the drive row: reporting one probe
    // where two are expected reads as "drive was fine", which is the opposite of
    // what a dead Workspace client means.
    withTimeout("google", checkWorkspace()).catch((e): [Probe, Probe] => {
      const detail = e instanceof Error ? e.message : String(e);
      return [{ name: "google", ok: false, detail }, { name: "drive", ok: false, detail }];
    }),
    guard("r2", checkR2),
    guard("database", checkDatabase),
    guard("auth", checkAuth),
    onD1 ? guard("journal", journalProbe) : Promise.resolve(null),
  ]);
  return [...workspace, r2, database, auth, ...(journal ? [journal] : []), checkEmail()];
}

/** Public shape: booleans only, no detail, no variable names. */
export function publicSummary(probes: Probe[]): Record<string, boolean> {
  return Object.fromEntries(probes.map((p) => [p.name, p.ok]));
}

/**
 * How many LIVE candidate documents can ONLY be served through Google Drive.
 *
 * Normally a very small number (all but a handful were copied to R2 on 2026-06-09),
 * and not worth an alert on its own. But when Google is down it is the BLAST RADIUS:
 * it turns "google is broken" into "N candidate documents are unreachable right now",
 * which is the difference between a shrug and a decision.
 *
 * Returns null if the count itself fails — it must never mask the Google alert.
 */
export async function driveOnlyDocCount(): Promise<number | null> {
  try {
    const { count, error } = await getServiceSupabase()
      .from("documents")
      .select("*", { count: "exact", head: true })
      .is("superseded_at", null)
      .not("drive_file_id", "is", null)
      .is("r2_key", null);
    if (error) return null;
    return count ?? null;
  } catch {
    return null;
  }
}
