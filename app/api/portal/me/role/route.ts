import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";

/**
 * Returns the caller's role for client-side UI gating ("Show admin button?").
 * Auth is the user's verified Supabase JWT; nothing here exposes the admin
 * identity (no NEXT_PUBLIC_ADMIN_EMAIL leak).
 *
 *   200 { role: "admin" }     — full admin
 *   200 { role: "sub_admin" } — sub-admin
 *   200 { role: null }        — authenticated but no admin role
 *   401                      — no/invalid token
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (auth.ok) return NextResponse.json({ role: auth.role });
  // 401 means not signed in; 403 means signed in but no admin role
  if (auth.status === 403) return NextResponse.json({ role: null });
  return NextResponse.json({ error: auth.error }, { status: auth.status });
}
