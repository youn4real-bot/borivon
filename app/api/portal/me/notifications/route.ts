import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { parseMarkRead } from "@/lib/meApiRules";

/**
 * The caller's OWN notifications — what NotificationBell used to read and
 * update straight from Supabase (Supabase → D1 step P0).
 *
 * GET  ?kind=all      → { notifications } — the candidate bell's last 30,
 *                        placement rows excluded (candidates never see those)
 * GET  ?kind=invites  → { notifications } — the last 20 calendar invites
 * PATCH { ids } | { all: true[, action: "event_invite"] } → marks them read.
 *        Only ever `read = true`, only ever the caller's own rows.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const invites = req.nextUrl.searchParams.get("kind") === "invites";
  const { data, error } = invites
    ? await db.from("notifications")
        .select("id, doc_name, read, created_at")
        .eq("user_id", auth.userId).eq("action", "event_invite")
        .order("created_at", { ascending: false }).limit(20)
    : await db.from("notifications")
        .select("id, doc_id, doc_name, doc_type, action, feedback, read, created_at")
        .eq("user_id", auth.userId).neq("doc_type", "placement")
        .order("created_at", { ascending: false }).limit(30);
  if (error) return NextResponse.json({ error: "Internal error" }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = parseMarkRead(await req.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  let q = getServiceSupabase().from("notifications")
    .update({ read: true }).eq("user_id", auth.userId).eq("read", false);
  if (body.ids) q = q.in("id", body.ids);
  if (body.action) q = q.eq("action", body.action);
  const { error } = await q;
  if (error) return NextResponse.json({ error: "Internal error" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
