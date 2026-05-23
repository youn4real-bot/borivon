import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_PHASES = ["bearbeitung", "visum"] as const;
type Phase = typeof VALID_PHASES[number];

const MIGRATION_RE = /phase_slot_categories|category_id|column .* does not exist|schema cache|relation .* does not exist/i;

/**
 * Categories that group the Bearbeitung / Visum slot boxes (LAW #34).
 * Admin-managed (create/rename/delete/reorder); candidates read them to
 * render the grouped + foldable view. Org-scoped exactly like phase_slots:
 * sub-admins act only on their own org; supreme admin on any org or global.
 *
 * Schema-tolerant: if the supabase/phase_slot_categories.sql migration
 * hasn't run yet, GET returns an empty list and writes 503 — the slot UI
 * then just renders flat (its pre-categories behaviour).
 */

// ── GET — any authenticated user; list categories for a phase ──────────────
export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: authData, error: authErr } = await getAnonVerifyClient().auth.getUser(m[1].trim());
  if (authErr || !authData?.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const userId = authData.user.id;

  const phase = req.nextUrl.searchParams.get("phase");
  if (!phase || !VALID_PHASES.includes(phase as Phase)) {
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  }
  const db = getServiceSupabase();

  // Categories MUST resolve to the same scope as the slots GET, or a candidate
  // could receive global slots tagged with org category_ids (or vice-versa) and
  // those slots would silently vanish from the grouped UI. So: resolve the
  // org exactly like phase-slots, then use org scope ONLY IF that org actually
  // has slots for this phase (mirrors the slots route's org→global fallback).
  const orgIdParam = req.nextUrl.searchParams.get("orgId");
  let orgId: string | null = null;
  if (orgIdParam && UUID_RE.test(orgIdParam)) {
    orgId = orgIdParam;
  } else {
    const { data: mem } = await db
      .from("candidate_organizations")
      .select("org_id")
      .eq("candidate_user_id", userId)
      .eq("status", "approved")
      .neq("added_by", "admin")
      .maybeSingle();
    orgId = (mem as { org_id: string } | null)?.org_id ?? null;
  }

  let scopeOrgId: string | null = null;
  if (orgId) {
    const { count } = await db
      .from("phase_slots")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("phase", phase);
    if ((count ?? 0) > 0) scopeOrgId = orgId;
  }

  let q = db
    .from("phase_slot_categories")
    .select("id, org_id, phase, label, position")
    .eq("phase", phase)
    .order("position", { ascending: true });
  q = scopeOrgId ? q.eq("org_id", scopeOrgId) : q.is("org_id", null);

  const { data, error } = await q;
  if (error) {
    if (MIGRATION_RE.test(error.message ?? "")) return NextResponse.json({ categories: [], migrated: false });
    console.error("[phase-slot-categories GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ categories: data ?? [], migrated: true });
}

/** Resolve the org a sub-admin may write to (mirrors phase-slots POST). */
async function resolveWritableOrg(
  db: ReturnType<typeof getServiceSupabase>,
  role: string, email: string, orgId: string | null,
): Promise<{ ok: true; orgId: string | null } | { ok: false; status: number; error: string }> {
  if (role === "admin") {
    return { ok: true, orgId: orgId && UUID_RE.test(orgId) ? orgId : null };
  }
  // sub-admin / org-admin → must be a member of the org they target.
  if (!orgId || !UUID_RE.test(orgId)) return { ok: false, status: 400, error: "orgId required" };
  const { data: mem } = await db
    .from("organization_members").select("org_id")
    .eq("sub_admin_email", email).eq("org_id", orgId).maybeSingle();
  if (!mem) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, orgId };
}

// ── POST — create a category ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as { phase?: string; label?: string; orgId?: string };
  const phase = body.phase;
  if (!phase || !VALID_PHASES.includes(phase as Phase)) {
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  }
  const label = (body.label ?? "").trim().slice(0, 80);

  const db = getServiceSupabase();
  const scope = await resolveWritableOrg(db, auth.role, auth.email, body.orgId ?? null);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  // Next position = max + 1 within (phase, org).
  const posQ = db.from("phase_slot_categories").select("position")
    .eq("phase", phase).order("position", { ascending: false }).limit(1);
  const { data: maxRow } = scope.orgId ? await posQ.eq("org_id", scope.orgId) : await posQ.is("org_id", null);
  const nextPos = ((maxRow as { position: number }[] | null)?.[0]?.position ?? -1) + 1;

  const row: Record<string, unknown> = { phase, label, position: nextPos };
  if (scope.orgId) row.org_id = scope.orgId;

  const { data, error } = await db.from("phase_slot_categories").insert(row).select().single();
  if (error) {
    if (MIGRATION_RE.test(error.message ?? "")) {
      return NextResponse.json({ error: "Migration pending — run supabase/phase_slot_categories.sql" }, { status: 503 });
    }
    console.error("[phase-slot-categories POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ category: data });
}

// ── PATCH — rename a single category OR bulk-reorder positions ──────────────
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as {
    id?: string; label?: string;
    positions?: { id: string; position: number }[];
  };
  const db = getServiceSupabase();

  // Helper: a sub-admin may only touch a category in their own org.
  const canTouch = async (catId: string): Promise<boolean> => {
    if (auth.role === "admin") return true;
    const { data: cat } = await db.from("phase_slot_categories").select("org_id").eq("id", catId).maybeSingle();
    const orgId = (cat as { org_id: string | null } | null)?.org_id;
    if (!orgId) return false; // sub-admins can't touch global categories
    const { data: mem } = await db.from("organization_members").select("org_id")
      .eq("sub_admin_email", auth.email).eq("org_id", orgId).maybeSingle();
    return !!mem;
  };

  // Bulk reorder.
  if (Array.isArray(body.positions)) {
    for (const { id, position } of body.positions) {
      if (!UUID_RE.test(id)) continue;
      if (!(await canTouch(id))) continue;
      const { error } = await db.from("phase_slot_categories").update({ position }).eq("id", id);
      if (error && MIGRATION_RE.test(error.message ?? "")) {
        return NextResponse.json({ error: "Migration pending" }, { status: 503 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // Rename.
  if (!body.id || !UUID_RE.test(body.id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (!(await canTouch(body.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const label = (body.label ?? "").trim().slice(0, 80);
  const { error } = await db.from("phase_slot_categories").update({ label }).eq("id", body.id);
  if (error) {
    console.error("[phase-slot-categories PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// ── DELETE — remove a category; its slots become uncategorized (NOT deleted) ─
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as { id?: string };
  if (!body.id || !UUID_RE.test(body.id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const db = getServiceSupabase();
  // Org-scope guard for sub-admins.
  if (auth.role !== "admin") {
    const { data: cat } = await db.from("phase_slot_categories").select("org_id").eq("id", body.id).maybeSingle();
    const orgId = (cat as { org_id: string | null } | null)?.org_id;
    if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: mem } = await db.from("organization_members").select("org_id")
      .eq("sub_admin_email", auth.email).eq("org_id", orgId).maybeSingle();
    if (!mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Un-group the slots FIRST (never delete a candidate's document slots),
  // then remove the category. ON DELETE SET NULL is the backstop.
  await db.from("phase_slots").update({ category_id: null }).eq("category_id", body.id);
  const { error } = await db.from("phase_slot_categories").delete().eq("id", body.id);
  if (error) {
    console.error("[phase-slot-categories DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
