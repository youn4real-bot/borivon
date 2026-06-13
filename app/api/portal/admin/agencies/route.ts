import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

// Supreme admin only — agency CRUD

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getServiceSupabase();
  const { data: agencies } = await db
    .from("agencies")
    .select("id, name, created_at")
    .order("created_at", { ascending: true });

  type AgencyRow = { id: string; name: string; created_at: string };
  const agencyRows = (agencies ?? []) as AgencyRow[];

  // sub_admins is a tiny staff table — fetching its two scalar columns is cheap.
  const { data: subAdmins } = await db.from("sub_admins").select("agency_id, is_agency_admin");
  type SARow = { agency_id: string | null; is_agency_admin: boolean };
  const adminCounts: Record<string, number> = {};
  const memberCounts: Record<string, number> = {};
  for (const sa of (subAdmins ?? []) as SARow[]) {
    if (!sa.agency_id) continue;
    if (sa.is_agency_admin) adminCounts[sa.agency_id] = (adminCounts[sa.agency_id] ?? 0) + 1;
    else memberCounts[sa.agency_id] = (memberCounts[sa.agency_id] ?? 0) + 1;
  }

  // EGRESS: candidate_profiles scales with the whole candidate base, so NEVER
  // pull its rows just to count — ask Postgres for an exact head count per
  // agency (zero rows over the wire). One count per agency (agencies are few).
  const candCountEntries = await Promise.all(
    agencyRows.map(async (a) => {
      const { count } = await db
        .from("candidate_profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("agency_id", a.id);
      return [a.id, count ?? 0] as const;
    }),
  );
  const candCounts: Record<string, number> = Object.fromEntries(candCountEntries);

  const decorated = agencyRows.map(a => ({
    ...a,
    adminCount:     adminCounts[a.id]  ?? 0,
    memberCount:    memberCounts[a.id] ?? 0,
    candidateCount: candCounts[a.id]   ?? 0,
  }));

  return NextResponse.json({ agencies: decorated });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const db = getServiceSupabase();
  const { data, error } = await db.from("agencies").insert({ name }).select("id, name, created_at").single();
  if (error || !data) {
    console.error("[agencies POST] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ agency: data });
}

// PATCH — assign sub-admin to agency (or remove)
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const subAdminEmail  = typeof body?.email       === "string"  ? body.email.trim().toLowerCase() : "";
  const agencyId       = typeof body?.agencyId    === "string"  ? body.agencyId    : null;
  const isAgencyAdmin  = typeof body?.isAgencyAdmin === "boolean" ? body.isAgencyAdmin : false;
  if (!subAdminEmail) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const db = getServiceSupabase();
  const { error } = await db
    .from("sub_admins")
    .update({ agency_id: agencyId, is_agency_admin: isAgencyAdmin })
    .eq("email", subAdminEmail);

  if (error) {
    console.error("[agencies PATCH] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
