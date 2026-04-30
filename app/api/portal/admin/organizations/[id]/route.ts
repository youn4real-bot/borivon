import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH — update an organization (rename, change code, edit notes).
 * Body: { name?, inviteCode?, notes? }
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim().slice(0, 200);
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    updates.name = name;
  }
  if (typeof body?.notes === "string") {
    updates.notes = body.notes.trim().slice(0, 500) || null;
  }
  if (typeof body?.inviteCode === "string") {
    const code = body.inviteCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
    if (!code) return NextResponse.json({ error: "Code cannot be empty" }, { status: 400 });
    updates.invite_code = code;
  }
  if (typeof body?.logoFilename === "string") {
    updates.logo_filename = body.logoFilename.trim().slice(0, 200) || null;
  }
  if (typeof body?.footerText === "string") {
    updates.footer_text = body.footerText.trim().slice(0, 500) || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db.from("organizations").update(updates).eq("id", id);
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Code already in use" }, { status: 409 });
    }
    console.error("[organizations PATCH] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/**
 * DELETE — remove an organization (cascades to members & candidate links).
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const db = getServiceSupabase();
  // CASCADE on FK takes care of members and candidate_organizations
  const { error } = await db.from("organizations").delete().eq("id", id);
  if (error) {
    console.error("[organizations DELETE] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
