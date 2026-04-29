import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET — list all sub-admins with their assigned candidate IDs
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getServiceSupabase();

  const { data: subAdmins } = await db
    .from("sub_admins")
    .select("id, email, name, label, created_at")
    .order("created_at", { ascending: true });

  const { data: assignments } = await db
    .from("sub_admin_assignments")
    .select("sub_admin_email, candidate_user_id");

  return NextResponse.json({ subAdmins: subAdmins ?? [], assignments: assignments ?? [] });
}

// POST — add a sub-admin
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name  = typeof body?.name  === "string" ? body.name.slice(0, 200)  : "";
  const label = typeof body?.label === "string" ? body.label.slice(0, 200) : "";
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });

  const db = getServiceSupabase();
  const { error } = await db.from("sub_admins").upsert(
    { email, name, label },
    { onConflict: "email" }
  );
  if (error) {
    console.error("[sub-admins POST] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE — remove a sub-admin (and all their assignments)
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });

  const db = getServiceSupabase();
  await db.from("sub_admin_assignments").delete().eq("sub_admin_email", email);
  await db.from("sub_admins").delete().eq("email", email);
  return NextResponse.json({ success: true });
}
