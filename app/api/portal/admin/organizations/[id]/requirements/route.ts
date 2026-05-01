import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET — list all requirements for an org (active + inactive). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid org id" }, { status: 400 });

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("org_requirements")
    .select("id, specialty, slots, location, start_date, notes, active, created_at")
    .eq("org_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[requirements GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ requirements: data ?? [] });
}

/** POST — add a new requirement.
 *  Body: { specialty?, slots?, location?, start_date?, notes? } */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid org id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("org_requirements")
    .insert({
      org_id:     id,
      specialty:  typeof body.specialty  === "string" ? body.specialty.trim().slice(0, 200) || null : null,
      slots:      typeof body.slots === "number" ? Math.max(1, Math.floor(body.slots)) : 1,
      location:   typeof body.location   === "string" ? body.location.trim().slice(0, 200)  || null : null,
      start_date: typeof body.start_date === "string" ? body.start_date || null : null,
      notes:      typeof body.notes      === "string" ? body.notes.trim().slice(0, 500) || null : null,
      active:     true,
    })
    .select("id, specialty, slots, location, start_date, notes, active, created_at")
    .single();

  if (error) {
    console.error("[requirements POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ requirement: data });
}

/** PATCH — update a requirement.
 *  Body: { requirementId, specialty?, slots?, location?, start_date?, notes?, active? } */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid org id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const reqId = typeof body.requirementId === "string" ? body.requirementId.trim() : "";
  if (!UUID_RE.test(reqId)) return NextResponse.json({ error: "Invalid requirement id" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (typeof body.specialty  === "string")  updates.specialty  = body.specialty.trim().slice(0, 200) || null;
  if (typeof body.slots      === "number")  updates.slots      = Math.max(1, Math.floor(body.slots));
  if (typeof body.location   === "string")  updates.location   = body.location.trim().slice(0, 200) || null;
  if (typeof body.start_date === "string")  updates.start_date = body.start_date || null;
  if (typeof body.notes      === "string")  updates.notes      = body.notes.trim().slice(0, 500) || null;
  if (typeof body.active     === "boolean") updates.active     = body.active;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db
    .from("org_requirements")
    .update(updates)
    .eq("id", reqId)
    .eq("org_id", id);

  if (error) {
    console.error("[requirements PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/** DELETE — close a requirement (sets active = false, keeps audit trail).
 *  Body: { requirementId } */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid org id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const reqId = typeof body.requirementId === "string" ? body.requirementId.trim() : "";
  if (!UUID_RE.test(reqId)) return NextResponse.json({ error: "Invalid requirement id" }, { status: 400 });

  const db = getServiceSupabase();
  await db
    .from("org_requirements")
    .update({ active: false })
    .eq("id", reqId)
    .eq("org_id", id);

  return NextResponse.json({ success: true });
}
