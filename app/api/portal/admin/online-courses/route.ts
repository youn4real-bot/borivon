import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { isOrgSide } from "@/lib/messagesAuth";

/**
 * Admin list of online-course registrations. BORIVON HQ ONLY.
 * Read-only. Newest first. Source: online_course_registrations.
 *
 * LAW #25: these are Borivon's OWN language-course customers — names, emails,
 * phone numbers and home addresses of people who may have no connection to any
 * partner. The gate was a bare requireAdminRole, and every agency admin / org
 * member holds a sub_admins row, so a partner agency could read the entire
 * customer list. Org-side callers are refused outright; there is no per-agency
 * subset here to fall back to, because none of these rows belong to an agency.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  if (await isOrgSide(db, auth.role, auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
