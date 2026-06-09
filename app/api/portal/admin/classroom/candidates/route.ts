import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getStaffUserIdsAmong } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * SUPREME-ADMIN-ONLY: search candidates to invite to a live class.
 * GET ?q=<name> → { candidates: [{ userId, name }] } (max 25). Staff excluded.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden — supreme admin only" }, { status: 403 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  const db = getServiceSupabase();

  let query = db.from("candidate_profiles").select("user_id, first_name, last_name").limit(40);
  if (q) {
    const safe = q.replace(/[\\%_]/g, (c) => "\\" + c);
    query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`);
  }
  const { data, error } = await query;
  if (error) { console.error("[classroom/candidates] error:", error.message); return NextResponse.json({ error: "load_failed" }, { status: 500 }); }

  const rows = (data ?? []) as { user_id: string; first_name: string | null; last_name: string | null }[];
  const staff = await getStaffUserIdsAmong(rows.map((r) => r.user_id));
  const candidates = rows
    .filter((r) => !staff.has(r.user_id))
    .map((r) => ({ userId: r.user_id, name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "—" }))
    .filter((c) => c.name !== "—")
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 25);

  return NextResponse.json({ candidates });
}
