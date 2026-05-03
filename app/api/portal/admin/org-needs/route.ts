import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

/**
 * GET — all open org requirements across every org, with org name.
 * Used by the admin panel "Org Needs" overview.
 *
 * Returns:
 *   { needs: [{ id, orgId, orgName, facilityType, slots, bundesland, city, startDate, notes, createdAt }] }
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getServiceSupabase();

  const [{ data: reqs }, { data: orgs }] = await Promise.all([
    db.from("org_requirements")
      .select("id, org_id, specialty, slots, location, start_date, notes, created_at")
      .eq("active", true)
      .order("created_at", { ascending: false }),
    db.from("organizations").select("id, name"),
  ]);

  type ReqRow = { id: string; org_id: string; specialty: string | null; slots: number; location: string | null; start_date: string | null; notes: string | null; created_at: string };
  type OrgRow = { id: string; name: string };

  const orgNameById: Record<string, string> = {};
  for (const o of (orgs ?? []) as OrgRow[]) orgNameById[o.id] = o.name;

  const needs = ((reqs ?? []) as ReqRow[]).map(r => ({
    id:        r.id,
    orgId:     r.org_id,
    orgName:   orgNameById[r.org_id] ?? "(unknown)",
    specialty: r.specialty ?? null,
    slots:     r.slots,
    location:  r.location ?? null,
    startDate: r.start_date,
    notes:     r.notes,
    createdAt: r.created_at,
  }));

  return NextResponse.json({ needs });
}
