/**
 * ACADEMY — tab visibility control API. SUPREME ADMIN ONLY.
 *
 * The supreme admin (ADMIN_EMAIL) decides who can see the Academy nav tab while
 * it's a work-in-progress:
 *   GET  → { maskedAll, overrides: [{ userId, visible }] }
 *   POST { action: "mask_all",  value }            → hide/show for everyone
 *   POST { action: "set_user",  userId, visible }  → allow/hide one person
 *   POST { action: "reset_user", userId }          → clear override (back to default)
 *
 * Hard-gated to role === "admin" (supreme). Sub-admins / org admins can never
 * reach this — they don't control the tab.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = getServiceSupabase();

  const [{ data: st }, { data: ov }] = await Promise.all([
    db.from("academy_settings").select("masked_all").eq("id", true).maybeSingle(),
    db.from("academy_tab_access").select("user_id, visible"),
  ]);
  return NextResponse.json({
    maskedAll: (st as { masked_all: boolean } | null)?.masked_all ?? false,
    overrides: ((ov ?? []) as { user_id: string; visible: boolean }[]).map(o => ({ userId: o.user_id, visible: o.visible })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = getServiceSupabase();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action === "mask_all") {
    const value = body.value === true;
    const { error } = await db.from("academy_settings").upsert(
      { id: true, masked_all: value, updated_by: auth.email, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, maskedAll: value });
  }

  if (action === "set_user") {
    const userId = String(body.userId ?? "");
    if (!UUID.test(userId)) return NextResponse.json({ error: "Bad user id" }, { status: 400 });
    const visible = body.visible === true;
    const { error } = await db.from("academy_tab_access").upsert(
      { user_id: userId, visible, updated_by: auth.email, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "reset_user") {
    const userId = String(body.userId ?? "");
    if (!UUID.test(userId)) return NextResponse.json({ error: "Bad user id" }, { status: 400 });
    // Remove the explicit override → this person falls back to the global default.
    const { error } = await db.from("academy_tab_access").delete().eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
