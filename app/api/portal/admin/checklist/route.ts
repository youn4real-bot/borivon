import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, ciEmail, type AdminAuthResult } from "@/lib/admin-auth";

/**
 * Manual admin checklists (NOT the auto document-progress checklist).
 *
 * Lists per admin:
 *   • personal  → private to the caller (scoped by owner_email).
 *   • shared    → among admins of the SAME org (scoped by org_id).
 *   • shared_hq → org↔Borivon PRIVATE channel: an org admin's items here are
 *                 seen by that org's admins + Borivon HQ. Other orgs never see
 *                 it. Only meaningful for org admins (HQ admins have no org).
 *
 * Org resolution (mirrors LAW #25 grouping):
 *   supreme admin                       → HQ list   (org_id = NULL)
 *   sub-admin, is_agency_admin = false  → HQ list   (org_id = NULL)  [global staff]
 *   sub-admin, is_agency_admin = true   → their org (org_id from organization_members)
 *
 * Service-role only: the table is RLS-locked with no policy, so every read /
 * write goes through this authenticated route.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 500;

type Scope = "personal" | "shared" | "shared_hq";
type Item = {
  id: string;
  scope: Scope;
  text: string;
  done: boolean;
  position: number;
  created_by: string | null;
  created_at: string;
};

/**
 * The org_id a caller's SHARED list lives under (NULL = HQ/global list).
 * Org admins (is_agency_admin) share their org's list; everyone else shares HQ.
 */
async function resolveSharedOrgId(auth: Extract<AdminAuthResult, { ok: true }>): Promise<string | null> {
  if (auth.role === "admin" || !auth.isAgencyAdmin) return null;
  const db = getServiceSupabase();
  const { data } = await db
    .from("organization_members")
    .select("org_id")
    .ilike("sub_admin_email", ciEmail(auth.email))
    .limit(1);
  return ((data ?? [])[0] as { org_id: string } | undefined)?.org_id ?? null;
}

const SELECT = "id, scope, text, done, position, created_by, created_at";

// GET → { personal, shared, sharedBorivon, scope, orgName, isOrgAdmin }
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const orgId = await resolveSharedOrgId(auth);
  const isOrgAdmin = orgId !== null;

  const personalP = db
    .from("admin_checklist_items")
    .select(SELECT)
    .eq("scope", "personal")
    .eq("owner_email", auth.email)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  let sharedQ = db
    .from("admin_checklist_items")
    .select(SELECT)
    .eq("scope", "shared")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  sharedQ = orgId === null ? sharedQ.is("org_id", null) : sharedQ.eq("org_id", orgId);

  // Org↔Borivon channel + org name — org admins only.
  const borivonP = isOrgAdmin
    ? db.from("admin_checklist_items").select(SELECT)
        .eq("scope", "shared_hq").eq("org_id", orgId)
        .order("position", { ascending: true }).order("created_at", { ascending: true })
    : Promise.resolve({ data: [], error: null });
  const orgNameP = isOrgAdmin
    ? db.from("organizations").select("name").eq("id", orgId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [personalR, sharedR, borivonR, orgNameR] = await Promise.all([personalP, sharedQ, borivonP, orgNameP]);
  if (personalR.error) return NextResponse.json({ error: personalR.error.message }, { status: 500 });
  if (sharedR.error)   return NextResponse.json({ error: sharedR.error.message }, { status: 500 });

  return NextResponse.json({
    personal:      (personalR.data ?? []) as Item[],
    shared:        (sharedR.data ?? []) as Item[],
    sharedBorivon: (borivonR.data ?? []) as Item[],
    scope:         orgId === null ? "hq" : "org",
    orgName:       (orgNameR.data as { name?: string } | null)?.name ?? null,
    isOrgAdmin,
  });
}

// POST { scope, text } → add an item, returns the created row
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const reqScope = body?.scope === "personal" || body?.scope === "shared" ? body.scope : null;
  // `list: "borivon"` on a shared post → the org↔Borivon channel (org admins).
  const wantBorivon = body?.list === "borivon";
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!reqScope) return NextResponse.json({ error: "scope required" }, { status: 400 });
  if (!text)     return NextResponse.json({ error: "text required" }, { status: 400 });

  const db = getServiceSupabase();
  const orgId = reqScope === "shared" ? await resolveSharedOrgId(auth) : null;
  // Channel scope only applies to org admins (orgId set). HQ admins fall back
  // to the plain HQ shared list even if list=borivon is sent.
  const dbScope: Scope =
    reqScope === "shared" && wantBorivon && orgId !== null ? "shared_hq" : reqScope;

  // append to the bottom: next position = current max + 1 within this list
  let maxQ = db.from("admin_checklist_items").select("position").eq("scope", dbScope);
  maxQ = dbScope === "personal"
    ? maxQ.eq("owner_email", auth.email)
    : (orgId === null ? maxQ.is("org_id", null) : maxQ.eq("org_id", orgId));
  const { data: maxRow } = await maxQ.order("position", { ascending: false }).limit(1).maybeSingle();
  const nextPos = (((maxRow as { position: number } | null)?.position ?? -1) + 1);

  const { data, error } = await db
    .from("admin_checklist_items")
    .insert({
      scope:       dbScope,
      owner_email: dbScope === "personal" ? auth.email : null,
      org_id:      dbScope === "personal" ? null : orgId,
      text,
      position:    nextPos,
      created_by:  auth.email,
    })
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data as Item });
}

/**
 * Confirm the caller may touch row `id`, returning it (or null on deny).
 * personal → must be the owner. shared → must match the caller's org list.
 */
async function loadOwned(auth: Extract<AdminAuthResult, { ok: true }>, id: string) {
  const db = getServiceSupabase();
  const { data } = await db
    .from("admin_checklist_items")
    .select("id, scope, owner_email, org_id")
    .eq("id", id)
    .maybeSingle();
  const row = data as { id: string; scope: Scope; owner_email: string | null; org_id: string | null } | null;
  if (!row) return null;
  if (row.scope === "personal") return row.owner_email === auth.email ? row : null;
  const myOrg = await resolveSharedOrgId(auth);
  // shared_hq (org↔Borivon channel): only that org's admins may write.
  if (row.scope === "shared_hq") return myOrg !== null && row.org_id === myOrg ? row : null;
  // shared: must belong to the caller's resolved list (HQ null, or their org).
  return row.org_id === myOrg ? row : null;
}

// PATCH { id, done?, text? } → toggle done and/or edit text
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
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

  if (!(await loadOwned(auth, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("admin_checklist_items")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data as Item });
}

// DELETE { id } → remove an item
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (!(await loadOwned(auth, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getServiceSupabase();
  const { error } = await db.from("admin_checklist_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
