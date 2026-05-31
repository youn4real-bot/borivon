import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

/**
 * Admin list of online-course registrations (supreme admin + sub-admins).
 * Read-only. Newest first. Source: online_course_registrations.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("online_course_registrations")
    .select("id, first_name, last_name, email, phone, address, group_slot, level, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("[admin/online-courses] list error:", error.message);
    return NextResponse.json({ error: "Internal error", registrations: [] }, { status: 500 });
  }
  return NextResponse.json({ registrations: data ?? [] });
}
