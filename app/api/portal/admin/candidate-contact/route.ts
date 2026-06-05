import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";

/**
 * Admin-only: a candidate's contact phone, for the one-tap WhatsApp reminder
 * (opens wa.me with the German message pre-filled). Returns ONLY the phone —
 * no other PII — and is gated by role + per-candidate scope (LAW #25).
 *
 * GET ?userId=<uuid> → { phone }
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId || !UUID_RE.test(userId)) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  if (!(await canActOnCandidate(auth.role, auth.email, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data } = await db.from("candidate_profiles").select("phone").eq("user_id", userId).maybeSingle();
  return NextResponse.json({ phone: (data as { phone?: string | null } | null)?.phone ?? null });
}
