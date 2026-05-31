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

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("leads")
    .select("id, kind, email, name, phone, message, details, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("[admin/leads] list error:", error.message);
    return NextResponse.json({ error: "Internal error", leads: [] }, { status: 500 });
  }
  return NextResponse.json({ leads: data ?? [] });
}
