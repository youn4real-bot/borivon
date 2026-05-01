import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_FACILITY = ["Klinik", "Altenheim", "Ambulante Pflegedienst"] as const;

async function getOrgId(email: string): Promise<string | null> {
  const db = getServiceSupabase();
  const { data } = await db
    .from("organization_members")
    .select("org_id")
    .eq("sub_admin_email", email)
    .maybeSingle();
  return (data as { org_id: string } | null)?.org_id ?? null;
}

/** POST — org member adds a requirement for their org */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const orgId = await getOrgId(auth.email);
  if (!orgId) return NextResponse.json({ error: "Not an org member" }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  const facilityType = typeof body.facility_type === "string" ? body.facility_type.trim() : "";
  if (!VALID_FACILITY.includes(facilityType as typeof VALID_FACILITY[number])) {
    return NextResponse.json({ error: "Invalid facility type" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("org_requirements")
    .insert({
      org_id:        orgId,
      facility_type: facilityType,
      bundesland:    typeof body.bundesland === "string" ? body.bundesland.trim() || null : null,
      city:          typeof body.city       === "string" ? body.city.trim().slice(0, 100) || null : null,
      slots:         typeof body.slots === "number" ? Math.max(1, Math.floor(body.slots)) : 1,
      start_date:    typeof body.start_date === "string" ? body.start_date || null : null,
      notes:         typeof body.notes === "string" ? body.notes.trim().slice(0, 300) || null : null,
      active:        true,
    })
    .select("id, facility_type, bundesland, city, slots, start_date, notes, active, created_at")
    .single();

  if (error) {
    console.error("[org requirements POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ requirement: data });
}

/** PATCH — org member edits one of their requirements */
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const orgId = await getOrgId(auth.email);
  if (!orgId) return NextResponse.json({ error: "Not an org member" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const reqId = typeof body.requirementId === "string" ? body.requirementId.trim() : "";
  if (!UUID_RE.test(reqId)) return NextResponse.json({ error: "Invalid requirement id" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (typeof body.facility_type === "string") {
    const ft = body.facility_type.trim();
    if (!VALID_FACILITY.includes(ft as typeof VALID_FACILITY[number])) {
      return NextResponse.json({ error: "Invalid facility type" }, { status: 400 });
    }
    updates.facility_type = ft;
  }
  if (typeof body.bundesland  === "string") updates.bundesland  = body.bundesland.trim() || null;
  if (typeof body.city        === "string") updates.city        = body.city.trim().slice(0, 100) || null;
  if (typeof body.slots       === "number") updates.slots       = Math.max(1, Math.floor(body.slots));
  if (typeof body.start_date  === "string") updates.start_date  = body.start_date || null;
  if (typeof body.notes       === "string") updates.notes       = body.notes.trim().slice(0, 300) || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db
    .from("org_requirements")
    .update(updates)
    .eq("id", reqId)
    .eq("org_id", orgId);

  if (error) {
    console.error("[org requirements PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** DELETE — org member closes one of their requirements */
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const orgId = await getOrgId(auth.email);
  if (!orgId) return NextResponse.json({ error: "Not an org member" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const reqId = typeof body.requirementId === "string" ? body.requirementId.trim() : "";
  if (!UUID_RE.test(reqId)) return NextResponse.json({ error: "Invalid requirement id" }, { status: 400 });

  const db = getServiceSupabase();
  await db
    .from("org_requirements")
    .update({ active: false })
    .eq("id", reqId)
    .eq("org_id", orgId); // safety: can only close their own org's reqs

  return NextResponse.json({ success: true });
}
