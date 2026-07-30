import { getServiceSupabase } from "@/lib/supabase";

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
  name: "google" | "r2" | "database" | "email";
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
async function checkGoogle(): Promise<Probe> {
  const { testWorkspace } = await import("@/lib/googleWorkspace");
  const res = await testWorkspace();
  if (res.ok) return { name: "google", ok: true, detail: res.calendar ? "gmail+calendar" : "gmail only" };
  // "not_configured" is NOT a free pass. Google IS configured in production, so
  // reaching this branch there means the credentials were lost or rotated away —
  // which kills the Drive mirror, Gmail and Calendar just as dead as an auth error.
  if (res.error === "not_configured")
    return { name: "google", ok: false, detail: "credentials missing — Drive mirror, Gmail and Calendar are all dead" };
  return { name: "google", ok: false, detail: res.error };
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
 * NO PAYMENTS PROBE, deliberately.
 *
 * The first live run of this watchdog reported payments:false — STRIPE_SECRET_KEY
 * is genuinely not set on the Worker. That is not a fault: Stripe is not in use.
 * Alerting on it would have messaged the founder every morning at 05:00 about a
 * thing he does not want, and a watchdog that cries wolf daily is one you learn to
 * ignore — which would quietly destroy its value for Google, R2 and email, the
 * three that actually matter.
 *
 * The Stripe integration itself is untouched and still in the codebase; only the
 * health check stops asserting it should be configured. Add a probe back here if
 * subscriptions are ever switched on.
 */

/** Run every probe concurrently. Never throws. */
export async function runHealthProbes(): Promise<Probe[]> {
  const [google, r2, database] = await Promise.all([
    guard("google", checkGoogle),
    guard("r2", checkR2),
    guard("database", checkDatabase),
  ]);
  return [google, r2, database, checkEmail()];
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
