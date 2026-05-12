import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_PHASES = ["bearbeitung", "visum"] as const;
const VALID_TYPES  = ["simple", "dual"] as const;

type PhaseSlot = {
  id: string;
  org_id: string | null;
  phase: string;
  position: number;
  type: string;
  label: string;
  label_trans: string | null;
  action_type: string | null;
  instructions: string | null;
};

// GET — any authenticated user; returns slots for a phase (org-specific → global fallback)
export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jwt = m[1].trim();

  const { data: authData, error: authErr } = await getAnonVerifyClient().auth.getUser(jwt);
  if (authErr || !authData?.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const userId = authData.user.id;

  const phase = req.nextUrl.searchParams.get("phase");
  if (!phase || !VALID_PHASES.includes(phase as typeof VALID_PHASES[number])) {
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  }

  const orgIdParam = req.nextUrl.searchParams.get("orgId");
  const db = getServiceSupabase();

  let orgId: string | null = null;
  if (orgIdParam && UUID_RE.test(orgIdParam)) {
    orgId = orgIdParam;
  } else {
    // Auto-detect: candidate's approved org
    const { data: mem } = await db
      .from("candidate_organizations")
      .select("org_id")
      .eq("candidate_user_id", userId)
      .eq("status", "approved")
      .maybeSingle();
    orgId = (mem as { org_id: string } | null)?.org_id ?? null;
  }

  let slots: PhaseSlot[] = [];
  if (orgId) {
    const { data } = await db
      .from("phase_slots")
      .select("*")
      .eq("org_id", orgId)
      .eq("phase", phase)
      .order("position");
    slots = (data ?? []) as PhaseSlot[];
  }

  // Global fallback
  if (slots.length === 0) {
    const { data } = await db
      .from("phase_slots")
      .select("*")
      .is("org_id", null)
      .eq("phase", phase)
      .order("position");
    slots = (data ?? []) as PhaseSlot[];
  }

  return NextResponse.json({ slots });
}

// POST — create a new slot (admin/sub-admin only)
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { phase, type, label, label_trans, orgId, action_type, instructions } = body as {
    phase?: string; type?: string; label?: string; label_trans?: string; orgId?: string;
    action_type?: string; instructions?: string;
  };

  if (!phase || !VALID_PHASES.includes(phase as typeof VALID_PHASES[number]))
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  if (!type || !VALID_TYPES.includes(type as typeof VALID_TYPES[number]))
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  if (!label?.trim())
    return NextResponse.json({ error: "Label required" }, { status: 400 });

  const db = getServiceSupabase();

  let resolvedOrgId: string | null = null;
  if (auth.role === "admin") {
    resolvedOrgId = (orgId && UUID_RE.test(orgId)) ? orgId : null;
  } else {
    if (!orgId || !UUID_RE.test(orgId))
      return NextResponse.json({ error: "orgId required" }, { status: 400 });
    const { data: mem } = await db
      .from("organization_members")
      .select("org_id")
      .eq("sub_admin_email", auth.email)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    resolvedOrgId = orgId;
  }

  // Next position
  const posQuery = db
    .from("phase_slots")
    .select("position")
    .eq("phase", phase)
    .order("position", { ascending: false })
    .limit(1);
  const { data: maxRow } = resolvedOrgId
    ? await posQuery.eq("org_id", resolvedOrgId)
    : await posQuery.is("org_id", null);
  const nextPos = ((maxRow as { position: number }[] | null)?.[0]?.position ?? -1) + 1;

  const insertData: Record<string, unknown> = {
    phase, position: nextPos, type, label: label.trim(),
  };
  if (resolvedOrgId) insertData.org_id = resolvedOrgId;
  if (type === "dual" && label_trans?.trim()) insertData.label_trans = label_trans.trim();
  if (action_type && ["upload","sign","fill","combo"].includes(action_type)) insertData.action_type = action_type;
  if (instructions?.trim()) insertData.instructions = instructions.trim();

  const { data, error } = await db.from("phase_slots").insert(insertData).select().single();
  if (error) {
    console.error("[phase-slots POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ slot: data });
}

// PATCH — update label/type OR bulk-reorder positions
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as {
    id?: string; label?: string; label_trans?: string | null; type?: string;
    instructions?: string | null;
    template_pdf_path?: string | null;
    form_fields?: unknown;
    positions?: { id: string; position: number }[];
  };

  const db = getServiceSupabase();

  if (body.positions) {
    for (const { id, position } of body.positions) {
      if (!UUID_RE.test(id)) continue;
      // Sub-admins may only reorder slots belonging to their own orgs.
      if (auth.role !== "admin") {
        const { data: slotCheck } = await db.from("phase_slots").select("org_id").eq("id", id).maybeSingle();
        const slotOrgId = (slotCheck as { org_id: string | null } | null)?.org_id;
        if (!slotOrgId) continue; // global slot — skip silently
        const { data: mem } = await db.from("organization_members").select("org_id")
          .eq("sub_admin_email", auth.email).eq("org_id", slotOrgId).maybeSingle();
        if (!mem) continue; // not in this org — skip
      }
      const { error: posErr } = await db.from("phase_slots").update({ position }).eq("id", id);
      if (posErr) console.error("[phase-slots PATCH reorder]", id, posErr);
    }
    return NextResponse.json({ ok: true });
  }

  if (!body.id || !UUID_RE.test(body.id))
    return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: slot } = await db
    .from("phase_slots").select("org_id").eq("id", body.id).maybeSingle();
  if (!slot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Sub-admins cannot touch global slots (org_id = null) and must be members
  // of the slot's org. Bug fix: old code only checked org_id !== null, allowing
  // sub-admins to freely edit global (null org_id) slots.
  if (auth.role !== "admin") {
    const slotOrgId = (slot as { org_id: string | null }).org_id;
    if (!slotOrgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: mem } = await db
      .from("organization_members")
      .select("org_id")
      .eq("sub_admin_email", auth.email)
      .eq("org_id", slotOrgId)
      .maybeSingle();
    if (!mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (body.label !== undefined) updates.label = body.label.trim();
  if (body.label_trans !== undefined) updates.label_trans = body.label_trans?.trim() || null;
  if (body.type !== undefined && VALID_TYPES.includes(body.type as typeof VALID_TYPES[number]))
    updates.type = body.type;
  if (body.instructions !== undefined) updates.instructions = body.instructions?.trim() || null;
  if (body.template_pdf_path !== undefined) updates.template_pdf_path = body.template_pdf_path || null;
  if (body.form_fields !== undefined) updates.form_fields = body.form_fields ?? null;

  if (Object.keys(updates).length > 0)
    await db.from("phase_slots").update(updates).eq("id", body.id);

  return NextResponse.json({ ok: true });
}

// DELETE — remove a slot
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as { id?: string };
  if (!body.id || !UUID_RE.test(body.id))
    return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const db = getServiceSupabase();
  const { data: slot } = await db
    .from("phase_slots").select("org_id").eq("id", body.id).maybeSingle();
  if (!slot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (auth.role !== "admin") {
    const slotOrgId = (slot as { org_id: string | null }).org_id;
    if (!slotOrgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: mem } = await db
      .from("organization_members")
      .select("org_id")
      .eq("sub_admin_email", auth.email)
      .eq("org_id", slotOrgId)
      .maybeSingle();
    if (!mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error: delErr } = await db.from("phase_slots").delete().eq("id", body.id);
  if (delErr) {
    console.error("[phase-slots DELETE]", delErr);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
