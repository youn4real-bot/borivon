import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

/**
 * Admin list of homepage-funnel leads (supreme admin + sub-admins).
 * Reached from the profile-avatar menu → "Leads". Read-only, newest first.
 * Source: leads (run supabase/leads.sql).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // BORIVON'S OWN FUNNEL — not a partner agency's to read.
  //
  // requireAdminRole passes any row in sub_admins, is_agency_admin included, so
  // an org admin at a partner agency could list every inbound enquiry: each
  // clinic's contact person and phone, each nurse's email, and the free-text
  // message they sent. Those agencies compete with Borivon for the same German
  // clinics and the same Moroccan nurses. The sibling bookings route already
  // scopes this way; this one was simply missed.
  if (auth.role !== "admin" && auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("leads")
    .select("id, kind, email, name, phone, message, details, created_at, candidate_user_id")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("[admin/leads] list error:", error.message);
    return NextResponse.json({ error: "Internal error", leads: [] }, { status: 500 });
  }
  return NextResponse.json({ leads: data ?? [] });
}
