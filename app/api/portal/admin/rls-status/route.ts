import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { runRlsWatchdog } from "@/lib/rlsWatchdog";

/**
 * GET /api/portal/admin/rls-status
 *
 * Runs the RLS watchdog live and reports any table leaking to the public key.
 * Supreme admin only — it names the internal tables, and it is the same probe
 * an attacker would run, so it is not something to expose more widely.
 *
 * No AI, no model tokens: a dozen tiny count-only reads against our own
 * database. Cheap enough to run on demand every time the admin panel loads.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await runRlsWatchdog();
  return NextResponse.json({
    ok: result.leaks.length === 0,
    ...result,
  });
}
