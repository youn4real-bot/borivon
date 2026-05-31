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

export async function GET() {
  const missing = REQUIRED.filter(
    (k) => !process.env[k] || process.env[k] === "placeholder",
  );
  const ok = missing.length === 0;
  if (!ok) console.error("[health] missing/placeholder env:", missing.join(", "));
  return NextResponse.json(
    { ok, status: ok ? "healthy" : "degraded", ts: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}
