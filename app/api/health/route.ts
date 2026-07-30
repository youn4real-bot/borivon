import { NextResponse } from "next/server";

/**
 * Liveness / readiness probe for an external uptime monitor (UptimeRobot,
 * Better Uptime, Pingdom, …). No auth — point a monitor at /api/health and
 * alert on anything that isn't HTTP 200.
 *
 * Returns 200 "healthy" when the critical server env vars are present, or 503
 * "degraded" when one is missing/placeholder (so a misconfigured deploy trips
 * the monitor immediately). The PUBLIC body never names which var is missing
 * and never exposes any value — the specifics go to the server log only.
 */
export const dynamic = "force-dynamic";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * `?deep=1` — additionally prove every external dependency is actually REACHABLE:
 * Google Workspace, R2, the database, and that email + payments are configured.
 *
 * This exists because these failures are SILENT by design: the booking page's
 * busyIntervals() catches everything and returns [], so a completely dead calendar
 * client still produces a perfectly normal-looking slot list. There is no way to
 * tell "calendar works, nothing booked" from "calendar broken" by looking at the
 * site — and the same is true of a missing Resend key, which silently sends no
 * email at all.
 *
 * The probes are shared with the daily watchdog at /api/cron/health-watch (which
 * is what actually pages the founder), so the two can never disagree — and the
 * watchdog's calibration can be verified from outside without holding CRON_SECRET.
 *
 * The body is BOOLEANS ONLY: no account, no error text, no variable names, nothing
 * about the configuration. Whether an integration is up is an uptime fact, not a
 * secret; which env var is missing is a configuration detail and stays server-side.
 */

export async function GET(req: Request) {
  const missing = REQUIRED.filter(
    (k) => !process.env[k] || process.env[k] === "placeholder",
  );
  const envOk = missing.length === 0;
  if (!envOk) console.error("[health] missing/placeholder env:", missing.join(", "));

  const deep = new URL(req.url).searchParams.get("deep") === "1";
  let deps: Record<string, boolean> | undefined;
  if (deep) {
    const { runHealthProbes, publicSummary } = await import("@/lib/healthProbes");
    const probes = await runHealthProbes();
    deps = publicSummary(probes);
    const broken = probes.filter((p) => !p.ok);
    if (broken.length) {
      console.error("[health] DEPENDENCY DOWN:", broken.map((p) => `${p.name}: ${p.detail ?? ""}`).join(" | "));
    }
  }

  // A failing DEEP probe must not flip the shallow uptime signal: an external
  // monitor pings /api/health (no deep flag) and should page on the app being
  // down, not on Stripe being unconfigured. The deep body carries that detail.
  const ok = envOk;
  return NextResponse.json(
    {
      ok, status: ok ? "healthy" : "degraded",
      ...(deps ? { deps } : {}),
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
