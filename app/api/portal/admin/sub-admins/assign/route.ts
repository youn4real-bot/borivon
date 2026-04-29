import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST — assign a candidate to a sub-admin
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const subAdminEmail   = typeof body?.subAdminEmail   === "string" ? body.subAdminEmail.trim().toLowerCase() : "";
  const candidateUserId = typeof body?.candidateUserId === "string" ? body.candidateUserId.trim() : "";
  if (!EMAIL_RE.test(subAdminEmail))   return NextResponse.json({ error: "Invalid sub-admin email" }, { status: 400 });
  if (!UUID_RE.test(candidateUserId))  return NextResponse.json({ error: "Invalid candidate id" }, { status: 400 });

  const db = getServiceSupabase();
  const { error } = await db.from("sub_admin_assignments").upsert(
    { sub_admin_email: subAdminEmail, candidate_user_id: candidateUserId },
    { onConflict: "sub_admin_email,candidate_user_id" }
  );
  if (error) {
    console.error("[sub-admin assign POST] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE — unassign a candidate from a sub-admin
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const subAdminEmail   = typeof body?.subAdminEmail   === "string" ? body.subAdminEmail.trim().toLowerCase() : "";
  const candidateUserId = typeof body?.candidateUserId === "string" ? body.candidateUserId.trim() : "";
  if (!EMAIL_RE.test(subAdminEmail))   return NextResponse.json({ error: "Invalid sub-admin email" }, { status: 400 });
  if (!UUID_RE.test(candidateUserId))  return NextResponse.json({ error: "Invalid candidate id" }, { status: 400 });

  const db = getServiceSupabase();
  await db.from("sub_admin_assignments")
    .delete()
    .eq("sub_admin_email", subAdminEmail)
    .eq("candidate_user_id", candidateUserId);
  return NextResponse.json({ success: true });
}
