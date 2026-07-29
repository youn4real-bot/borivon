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
 * `?deep=1` — additionally prove Google Workspace is actually REACHABLE.
 *
 * This exists because Google failures here are SILENT by design: the booking
 * page's busyIntervals() catches everything and returns [], so a completely
 * dead calendar client still produces a perfectly normal-looking slot list.
 * There is no way to tell "calendar works, nothing booked" from "calendar
 * broken" by looking at the site — which makes any change to the Google layer
 * unverifiable, and that is precisely the layer that has to be reworked to get
 * googleapis out of the Workers bundle.
 *
 * So: one real API call, behind a query flag so the normal uptime ping stays
 * free. The body is a bare boolean — no account, no error text, nothing about
 * the configuration. Whether an integration is up is an uptime fact, not a
 * secret, and this is the only thing that makes a Google regression loud.
 */
async function googleReachable(): Promise<boolean> {
  try {
    // Imported lazily so the ordinary health ping never pulls the Workspace
    // client in at all.
    const { testWorkspace } = await import("@/lib/googleWorkspace");
    const res = await testWorkspace();
    return !!res.ok;
  } catch (e) {
    console.error("[health] google probe threw:", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function GET(req: Request) {
  const missing = REQUIRED.filter(
    (k) => !process.env[k] || process.env[k] === "placeholder",
  );
  const ok = missing.length === 0;
  if (!ok) console.error("[health] missing/placeholder env:", missing.join(", "));

  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const google = deep ? await googleReachable() : undefined;
  if (deep && !google) console.error("[health] GOOGLE WORKSPACE UNREACHABLE");

  return NextResponse.json(
    {
      ok, status: ok ? "healthy" : "degraded",
      ...(deep ? { google } : {}),
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
