import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

/**
 * Active employers for the admin assignment picker.
 *
 * GET /api/portal/admin/employers
 *   200 { employers: [{ id, name, slug, agencyId }] }
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("employers")
    .select("id, name, slug, agency_id")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("[admin/employers] list failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const employers = (data ?? []).map(e => ({
    id: (e as { id: string }).id,
    name: (e as { name: string }).name,
    slug: (e as { slug: string | null }).slug,
    agencyId: (e as { agency_id: string | null }).agency_id,
  }));
  return NextResponse.json({ employers });
}
