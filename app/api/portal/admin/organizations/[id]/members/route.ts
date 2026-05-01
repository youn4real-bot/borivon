import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET — list members of one organization.
 *   { members: [{ sub_admin_email, role, name, label }] }
 *
 * Joins against sub_admins to surface the human name/label.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const db = getServiceSupabase();
  const { data: rows } = await db
    .from("organization_members")
    .select("sub_admin_email, role, created_at")
    .eq("org_id", id);

  type MemberRow = { sub_admin_email: string; role: string; created_at: string };
  type SubAdminRow = { email: string; name: string | null; label: string | null };
  const memberRows = (rows ?? []) as MemberRow[];

  const emails = memberRows.map(r => r.sub_admin_email);
  let subAdmins: SubAdminRow[] = [];
  if (emails.length > 0) {
    const { data: sa } = await db.from("sub_admins").select("email, name, label").in("email", emails);
    subAdmins = (sa ?? []) as SubAdminRow[];
  }
  const saByEmail: Record<string, SubAdminRow> = {};
  for (const s of subAdmins) saByEmail[s.email] = s;

  // Never expose the supreme admin as a "member" — they may appear in
  // organization_members for technical reasons but should not be shown here.
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  const members = memberRows
    .filter(r => r.sub_admin_email !== adminEmail)
    .map(r => ({
      email: r.sub_admin_email,
      role:  r.role,
      created_at: r.created_at,
      name:  saByEmail[r.sub_admin_email]?.name  ?? "",
      label: saByEmail[r.sub_admin_email]?.label ?? "",
    }));

  return NextResponse.json({ members });
}

/**
 * POST — add a member to an organization.
 * Body: { email: string, role?: 'member' | 'owner' }
 *
 * If the email isn't already a sub_admin, we create one (with empty name/label)
 * so the existing sub-admin login flow works for them.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body  = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role  = body?.role === "owner" ? "owner" : "member";
  const name  = typeof body?.name  === "string" ? body.name.slice(0, 200)  : "";
  const label = typeof body?.label === "string" ? body.label.slice(0, 200) : "";
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });

  const db = getServiceSupabase();

  // Ensure the email exists in sub_admins (otherwise they can't log in as one)
  await db.from("sub_admins").upsert({ email, name, label }, { onConflict: "email" });

  // Add to organization_members
  const { error } = await db.from("organization_members").upsert(
    { org_id: id, sub_admin_email: email, role },
    { onConflict: "org_id,sub_admin_email" }
  );
  if (error) {
    console.error("[organization members POST] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/**
 * PATCH — change a member's role.
 * Body: { email: string, role: 'member' | 'owner' }
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body  = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role  = body?.role === "owner" ? "owner" : body?.role === "member" ? "member" : null;
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  if (!role)                 return NextResponse.json({ error: "Invalid role" },  { status: 400 });

  const db = getServiceSupabase();
  const { error } = await db.from("organization_members")
    .update({ role })
    .eq("org_id", id)
    .eq("sub_admin_email", email);
  if (error) {
    console.error("[organization members PATCH] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/**
 * DELETE — remove a member from an organization.
 * Body: { email: string }
 *
 * Does NOT delete the sub_admin record itself — they may still belong to
 * other orgs or have direct candidate assignments.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body  = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });

  const db = getServiceSupabase();
  await db.from("organization_members").delete().eq("org_id", id).eq("sub_admin_email", email);
  return NextResponse.json({ success: true });
}
