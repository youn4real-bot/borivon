import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";

/**
 * Personal manual checklist for the LOGGED-IN user (a candidate's own private
 * to-do list — "generic normal checklist").
 *
 * Reuses the admin_checklist_items table with scope='personal', keyed by
 * owner_email. Items are naturally isolated per user (the candidate's email is
 * distinct from any admin's), so a candidate only ever sees their own personal
 * items — never an admin's personal list and never any shared list. The table
 * is RLS-locked (service-role only); this route authorizes every call by the
 * verified JWT and scopes strictly to owner_email = caller.
 *
 * NOTE: org/Borivon-assigned tasks are a SEPARATE thing (the per-candidate
 * journey, /api/portal/journey) — this route is only the candidate's own list.
 */

const MAX_TEXT = 500;
const SELECT = "id, scope, text, done, position, created_by, created_at";

type Item = { id: string; scope: string; text: string; done: boolean; position: number };

// GET → { items: Item[] } — the caller's personal items
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await getServiceSupabase()
    .from("admin_checklist_items")
    .select(SELECT)
    .eq("scope", "personal")
    .eq("owner_email", auth.email)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: (data ?? []) as Item[] });
}

// POST { text } → add a personal item
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const db = getServiceSupabase();
  const { data: maxRow } = await db
    .from("admin_checklist_items")
    .select("position")
    .eq("scope", "personal")
    .eq("owner_email", auth.email)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPos = (((maxRow as { position: number } | null)?.position ?? -1) + 1);

  const { data, error } = await db
    .from("admin_checklist_items")
    .insert({ scope: "personal", owner_email: auth.email, org_id: null, text, position: nextPos, created_by: auth.email })
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data as Item });
}

/** Confirm row `id` is the caller's personal item. */
async function ownsItem(email: string, id: string): Promise<boolean> {
  const { data } = await getServiceSupabase()
    .from("admin_checklist_items")
    .select("owner_email, scope")
    .eq("id", id)
    .maybeSingle();
  const row = data as { owner_email: string | null; scope: string } | null;
  return !!row && row.scope === "personal" && row.owner_email === email;
}

// PATCH { id, done?, text? } → toggle / rename own item
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.done === "boolean") patch.done = body.done;
  if (typeof body.text === "string") {
    const t = body.text.trim().slice(0, MAX_TEXT);
    if (!t) return NextResponse.json({ error: "text empty" }, { status: 400 });
    patch.text = t;
  }
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  if (!(await ownsItem(auth.email, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await getServiceSupabase()
    .from("admin_checklist_items")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data as Item });
}

// DELETE { id } → remove own item
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (!(await ownsItem(auth.email, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { error } = await getServiceSupabase().from("admin_checklist_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
