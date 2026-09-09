import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate, canActOnOrg } from "@/lib/admin-auth";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { UUID_RE } from "@/lib/uuid";

const VALID_PHASES = ["bearbeitung", "visum"] as const;
const VALID_TYPES  = ["simple", "dual"] as const;

/** Mirrors lib in app/api/portal/upload/route.ts — kept inline to avoid a
 *  bigger shared-lib refactor for one cross-route use. */
function slugifyGerman(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    || "dokument";
}

/**
 * Rename every already-submitted document whose file_type points at this slot
 * so its filename reflects the slot's new label. This writes documents.file_name,
 * which is the name every surface actually shows — the portal, the download
 * headers, and the agency Drive mirror all read it, while the physical R2 object
 * key stays internal and opaque.
 *
 * There is deliberately no Drive call here. Files have been R2-primary since the
 * cutover, so no document written on Workers carries a drive_file_id, and the
 * googleapis client that used to rename the pre-migration Drive copies was the
 * single reason this route pulled googleapis into the Worker bundle.
 *
 * Failure on any single doc is logged + skipped — we don't roll back the
 * label change because partial rename is still better than a partial roll-back.
 */
async function renameSlotDocs(slotId: string, newLabel: string): Promise<void> {
  try {
    const db = getServiceSupabase();
    const { data: docs } = await db
      .from("documents")
      .select("id, user_id, file_name")
      .eq("file_type", slotId);
    if (!docs || docs.length === 0) return;

    const slug = slugifyGerman(newLabel);

    for (const raw of docs as { id: string; user_id: string; file_name: string | null }[]) {
      // Look up candidate first/last for the filename prefix
      const { data: prof } = await db
        .from("candidate_profiles")
        .select("first_name, last_name")
        .eq("user_id", raw.user_id)
        .maybeSingle();
      const p = prof as { first_name?: string | null; last_name?: string | null } | null;
      const fn = (p?.first_name ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "kandidat";
      const ln = (p?.last_name ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "unbekannt";
      // Preserve the existing extension if we can read it; default to "pdf".
      const ext = (raw.file_name ?? "").split(".").pop()?.toLowerCase() || "pdf";
      const newName = `${fn}_${ln}_pflegekraft_${slug}.${ext}`;

      const { error: updErr } = await db
        .from("documents")
        .update({ file_name: newName })
        .eq("id", raw.id);
      if (updErr) console.warn(`[renameSlotDocs] DB rename failed for ${raw.id}:`, updErr);
    }
  } catch (e) {
    console.error("[renameSlotDocs] unexpected error:", e);
  }
}

/**
 * May `auth` manage slots for this employer?
 *   • supreme admin → any employer.
 *   • org admin (sub_admin) → only employers whose agency_id is one of the
 *     orgs they belong to (organization_members).
 * Returns true/false. Caller has already validated employerId is a UUID.
 */
async function canManageEmployer(
  auth: Extract<Awaited<ReturnType<typeof requireAdminRole>>, { ok: true }>,
  employerId: string,
): Promise<boolean> {
  const db = getServiceSupabase();
  const { data: emp } = await db
    .from("employers")
    .select("agency_id")
    .eq("id", employerId)
    .maybeSingle();
  const agencyId = (emp as { agency_id: string | null } | null)?.agency_id ?? null;
  if (auth.role === "admin") return true;              // supreme → any
  if (!agencyId) return false;                          // org admin needs an org-linked employer
  const { data: mem } = await db
    .from("organization_members")
    .select("org_id")
    .eq("sub_admin_email", auth.email)
    .eq("org_id", agencyId)
    .maybeSingle();
  return !!mem;
}

type PhaseSlot = {
  id: string;
  org_id: string | null;
  employer_id: string | null;
  phase: string;
  position: number;
  type: string;
  label: string;
  label_trans: string | null;
  action_type: string | null;
  instructions: string | null;
  admin_signs: boolean;
  candidate_signs: boolean;
  admin_fills: boolean;
  candidate_fills: boolean;
  /** LAW #30 Mode 1: PDF already has AcroForm fields; skip box-drawing. */
  pdf_has_native_fields: boolean;
  candidate_signature_zone: { page: number; x: number; y: number; w: number; h: number } | null;
  /** true = permanent/required (default), false = optional (doesn't block completeness). */
  is_required?: boolean;
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

  const rl = await enforceUserRateLimit("slot-read", `u:${userId}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const phase = req.nextUrl.searchParams.get("phase");
  if (!phase || !VALID_PHASES.includes(phase as typeof VALID_PHASES[number])) {
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  }

  const orgIdParam = req.nextUrl.searchParams.get("orgId");
  const employerIdParam = req.nextUrl.searchParams.get("employerId");
  const candidateIdParam = req.nextUrl.searchParams.get("candidateId");
  const db = getServiceSupabase();

  // ── ADMIN viewing a specific candidate → resolve THAT candidate's scope ────
  // (employer → their approved org → global) so EVERY admin — Borivon HQ or org
  // admin — sees exactly the same set the candidate sees. Without this, each
  // admin resolved their OWN org and org-admin-created slots vanished for HQ.
  let adminCandEmployer: string | null = null;
  let adminCandOrg: string | null = null;
  let adminViewingCand = false;
  if (candidateIdParam && UUID_RE.test(candidateIdParam)) {
    const adminAuth = await requireAdminRole(req);
    if (adminAuth.ok) {
      // LAW #25: an org-scoped sub-admin must NOT read an out-of-scope candidate's
      // employer/org linkage — or, via that linkage, another org's private slot
      // config — by passing ?candidateId=. Gate on the same scope check every
      // per-candidate action uses. Supreme/HQ pass (canActOnCandidate → true).
      if (!(await canActOnCandidate(adminAuth.role, adminAuth.email, candidateIdParam))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      adminViewingCand = true;
      const { data: prof } = await db
        .from("candidate_profiles").select("employer_id").eq("user_id", candidateIdParam).maybeSingle();
      adminCandEmployer = (prof as { employer_id: string | null } | null)?.employer_id ?? null;
      const { data: link } = await db
        .from("candidate_organizations").select("org_id")
        .eq("candidate_user_id", candidateIdParam).eq("status", "approved").maybeSingle();
      adminCandOrg = (link as { org_id: string } | null)?.org_id ?? null;
    }
  }

  // ── Resolve the slot set ────────────────────────────────────────────────────
  // Two modes:
  //  • MANAGEMENT (?employerId or ?orgId, and NO ?candidateId) → return ONLY that
  //    single scope's slots, so the admin edits the "UKSH Kiel set" or the
  //    "Calmaroi batch set" in isolation.
  //  • CANDIDATE-FACING (admin ?candidateId, or a candidate's own request) →
  //    COMBINE the batch (the candidate's employer's AGENCY, e.g. Calmaroi) with
  //    the site set (their employer, e.g. UKSH Kiel), so every assigned candidate
  //    automatically gets the full list — batch docs first, then site extras.
  //    Falls back to their own linked org, then the global default.

  // (1) MANAGEMENT — one employer's set.
  if (!candidateIdParam && employerIdParam && UUID_RE.test(employerIdParam)) {
    const adminAuth = await requireAdminRole(req);
    if (adminAuth.ok && (await canManageEmployer(adminAuth, employerIdParam))) {
      const { data } = await db.from("phase_slots").select("*")
        .eq("employer_id", employerIdParam).eq("phase", phase).order("position");
      return NextResponse.json({ slots: (data ?? []) as PhaseSlot[] });
    }
    return NextResponse.json({ slots: [] });
  }
  // (2) MANAGEMENT — one org's (batch) set.
  if (!candidateIdParam && orgIdParam && UUID_RE.test(orgIdParam)) {
    const adminAuth = await requireAdminRole(req);
    let ok = false;
    if (adminAuth.ok) {
      // LAW #25: a scoped agency admin may only manage their own org's set.
      ok = adminAuth.role === "admin" || (await canActOnOrg(adminAuth.role, adminAuth.email, orgIdParam));
    } else {
      // A candidate may read an org they self-joined (never an admin-placed one).
      const { data: link } = await db.from("candidate_organizations").select("org_id")
        .eq("candidate_user_id", userId).eq("org_id", orgIdParam)
        .eq("status", "approved").neq("added_by", "admin").maybeSingle();
      ok = !!link;
    }
    if (ok) {
      const { data } = await db.from("phase_slots").select("*")
        .eq("org_id", orgIdParam).eq("phase", phase).order("position");
      return NextResponse.json({ slots: (data ?? []) as PhaseSlot[] });
    }
    // not authorized for the param → fall through to the combined/global view.
  }

  // (3) CANDIDATE-FACING — resolve the candidate's employer + batch org, combine.
  let cEmployer: string | null = null;
  let cOrg: string | null = null;
  if (adminViewingCand) {
    cEmployer = adminCandEmployer;
    cOrg = adminCandOrg;
  } else {
    const adminAuth = await requireAdminRole(req);
    if (!adminAuth.ok) {
      // Candidate's own request. employer_id is read directly (no admin-placed
      // exclusion) so a placed candidate still gets their pathway's docs.
      const { data: prof } = await db.from("candidate_profiles")
        .select("employer_id").eq("user_id", userId).maybeSingle();
      cEmployer = (prof as { employer_id: string | null } | null)?.employer_id ?? null;
      const { data: mem } = await db.from("candidate_organizations")
        .select("org_id").eq("candidate_user_id", userId)
        .eq("status", "approved").neq("added_by", "admin").maybeSingle();
      cOrg = (mem as { org_id: string } | null)?.org_id ?? null;
    } else if (adminAuth.role === "sub_admin") {
      // Org admin with no candidate/param → their own org's set (manager default).
      const { data: m } = await db.from("organization_members")
        .select("org_id").eq("sub_admin_email", adminAuth.email).maybeSingle();
      cOrg = (m as { org_id: string } | null)?.org_id ?? null;
    }
    // Supreme admin with no params → global (both null → global fallback below).
  }

  // The BATCH set is the employer's AGENCY (UKSH Kiel/Lübeck → Calmaroi), so a
  // candidate at ANY site of that agency gets the shared batch docs. No employer
  // → fall back to the candidate's own linked org as the batch.
  let batchOrg: string | null = cOrg;
  if (cEmployer) {
    const { data: emp } = await db.from("employers").select("agency_id").eq("id", cEmployer).maybeSingle();
    const agencyId = (emp as { agency_id: string | null } | null)?.agency_id ?? null;
    if (agencyId) batchOrg = agencyId;
  }

  let batchSlots: PhaseSlot[] = [];
  if (batchOrg) {
    const { data } = await db.from("phase_slots").select("*")
      .eq("org_id", batchOrg).eq("phase", phase).order("position");
    batchSlots = (data ?? []) as PhaseSlot[];
  }
  let siteSlots: PhaseSlot[] = [];
  if (cEmployer) {
    const { data } = await db.from("phase_slots").select("*")
      .eq("employer_id", cEmployer).eq("phase", phase).order("position");
    siteSlots = (data ?? []) as PhaseSlot[];
  }
  // "Everyone" docs are ADDITIVE, never a fallback. A slot with no org and no
  // employer is one the founder declared for EVERY candidate, so it must still
  // reach someone who ALSO has an agency batch or a site list — otherwise adding
  // a single Calmaroi doc silently hid the whole global set from that intake.
  //
  // employer_id is filtered in JS, not SQL: employer-scoped rows keep org_id NULL,
  // so `.is("org_id", null)` alone also matches every SITE's private slots and
  // would hand one employer's documents to unrelated candidates. (Filtering in JS
  // also stays schema-tolerant if employer_id isn't migrated.)
  const { data: globalData } = await db.from("phase_slots").select("*")
    .is("org_id", null).eq("phase", phase).order("position");
  const globalSlots = ((globalData ?? []) as PhaseSlot[])
    .filter(s => !(s as { employer_id?: string | null }).employer_id);

  // Everyone → batch (Calmaroi) → site (Kiel/Lübeck) extras. Re-number position
  // across the combined list so a position-sort keeps the three groups in order
  // (the persisted per-scope positions are edited in the manager views).
  const slots = [...globalSlots, ...batchSlots, ...siteSlots].map((s, i) => ({ ...s, position: i }));

  return NextResponse.json({ slots });
}

// POST — create a new slot (admin/sub-admin only)
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { phase, type, label, label_trans, orgId, employerId, action_type, instructions } = body as {
    phase?: string; type?: string; label?: string; label_trans?: string; orgId?: string; employerId?: string;
    action_type?: string; instructions?: string;
    admin_signs?: boolean; candidate_signs?: boolean; admin_fills?: boolean; candidate_fills?: boolean;
    pdf_has_native_fields?: boolean;
  };

  if (!phase || !VALID_PHASES.includes(phase as typeof VALID_PHASES[number]))
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  if (!type || !VALID_TYPES.includes(type as typeof VALID_TYPES[number]))
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  if (!label?.trim())
    return NextResponse.json({ error: "Label required" }, { status: 400 });

  const db = getServiceSupabase();

  // EMPLOYER-scoped slot (most specific). org_id stays null on these rows.
  let resolvedEmployerId: string | null = null;
  let resolvedOrgId: string | null = null;
  if (employerId && UUID_RE.test(employerId)) {
    if (!(await canManageEmployer(auth, employerId)))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    resolvedEmployerId = employerId;
  } else if (auth.role === "admin") {
    resolvedOrgId = (orgId && UUID_RE.test(orgId)) ? orgId : null;
  } else {
    // Org admin. If they passed an explicit orgId, it must be one of theirs.
    // Otherwise default to their (single) org — so creating a slot from a
    // candidate's view just works without the client knowing the org id.
    if (orgId && UUID_RE.test(orgId)) {
      const { data: mem } = await db
        .from("organization_members")
        .select("org_id")
        .eq("sub_admin_email", auth.email)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      resolvedOrgId = orgId;
    } else {
      const { data: mem } = await db
        .from("organization_members")
        .select("org_id")
        .eq("sub_admin_email", auth.email)
        .maybeSingle();
      // Org admin → their org. Borivon HQ sub-admin (no org) → global (null).
      resolvedOrgId = (mem as { org_id: string } | null)?.org_id ?? null;
    }
  }

  // Next position — within the resolved scope (employer ▸ org ▸ global).
  const posQuery = db
    .from("phase_slots")
    .select("position")
    .eq("phase", phase)
    .order("position", { ascending: false })
    .limit(1);
  const { data: maxRow } = resolvedEmployerId
    ? await posQuery.eq("employer_id", resolvedEmployerId)
    : resolvedOrgId
      ? await posQuery.eq("org_id", resolvedOrgId)
      : await posQuery.is("org_id", null).is("employer_id", null);
  const nextPos = ((maxRow as { position: number }[] | null)?.[0]?.position ?? -1) + 1;

  const insertData: Record<string, unknown> = {
    phase, position: nextPos, type, label: label.trim(),
  };
  if (resolvedEmployerId) insertData.employer_id = resolvedEmployerId;
  if (resolvedOrgId) insertData.org_id = resolvedOrgId;
  if (type === "dual" && label_trans?.trim()) insertData.label_trans = label_trans.trim();
  if (action_type && ["upload","sign","fill","combo"].includes(action_type)) insertData.action_type = action_type;
  if (instructions?.trim()) insertData.instructions = instructions.trim();
  // New flexible action flags (LAW #34)
  insertData.admin_signs           = body.admin_signs           === true;
  insertData.candidate_signs       = body.candidate_signs       === true;
  insertData.admin_fills           = body.admin_fills           === true;
  insertData.candidate_fills       = body.candidate_fills       === true;
  insertData.pdf_has_native_fields = body.pdf_has_native_fields === true;
  // Required (permanent) by default; admin can mark a slot optional. Schema-tolerant:
  // if the is_required column isn't migrated yet, retry without it (slot still created).
  insertData.is_required           = body.is_required           !== false;

  let { data, error } = await db.from("phase_slots").insert(insertData).select().single();
  if (error && /is_required|column .* does not exist|schema cache/i.test(error.message ?? "")) {
    delete insertData.is_required;
    ({ data, error } = await db.from("phase_slots").insert(insertData).select().single());
  }
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
    candidate_signature_zone?: unknown;
    positions?: { id: string; position: number; category_id?: string | null }[];
    category_id?: string | null;
    admin_signs?: boolean; candidate_signs?: boolean; admin_fills?: boolean; candidate_fills?: boolean;
    pdf_has_native_fields?: boolean;
    is_required?: boolean;
  };

  const db = getServiceSupabase();

  if (body.positions) {
    for (const { id, position, category_id } of body.positions) {
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
      // category_id is OPTIONAL in the reorder payload — when present we
      // also move the slot into (or out of, when null) a category, so a
      // cross-category drag persists both the new order AND the new group
      // in one round-trip. Tolerate the column not existing yet (pre-
      // migration): retry the update without it.
      const patch: Record<string, unknown> = { position };
      if (category_id !== undefined) patch.category_id = category_id;
      const { error: posErr } = await db.from("phase_slots").update(patch).eq("id", id);
      if (posErr && /category_id|column .* does not exist|schema cache/i.test(posErr.message ?? "")) {
        await db.from("phase_slots").update({ position }).eq("id", id);
      } else if (posErr) {
        console.error("[phase-slots PATCH reorder]", id, posErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (!body.id || !UUID_RE.test(body.id))
    return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: slot } = await db
    .from("phase_slots").select("org_id, employer_id").eq("id", body.id).maybeSingle();
  if (!slot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Sub-admins: may only touch slots they manage — their org's slots OR an
  // employer (pathway) set under one of their orgs. Never global (both null).
  if (auth.role !== "admin") {
    const s = slot as { org_id: string | null; employer_id: string | null };
    if (s.employer_id) {
      if (!(await canManageEmployer(auth, s.employer_id)))
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else if (s.org_id) {
      const { data: mem } = await db
        .from("organization_members")
        .select("org_id")
        .eq("sub_admin_email", auth.email)
        .eq("org_id", s.org_id)
        .maybeSingle();
      if (!mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.label !== undefined) updates.label = body.label.trim();
  if (body.label_trans !== undefined) updates.label_trans = body.label_trans?.trim() || null;
  if (body.type !== undefined && VALID_TYPES.includes(body.type as typeof VALID_TYPES[number]))
    updates.type = body.type;
  if (body.instructions !== undefined) updates.instructions = body.instructions?.trim() || null;
  if (body.template_pdf_path !== undefined) updates.template_pdf_path = body.template_pdf_path || null;
  if (body.form_fields !== undefined) updates.form_fields = body.form_fields ?? null;
  if (body.candidate_signature_zone !== undefined) updates.candidate_signature_zone = body.candidate_signature_zone ?? null;
  if (body.admin_signs           !== undefined) updates.admin_signs           = !!body.admin_signs;
  if (body.candidate_signs       !== undefined) updates.candidate_signs       = !!body.candidate_signs;
  if (body.admin_fills           !== undefined) updates.admin_fills           = !!body.admin_fills;
  if (body.candidate_fills       !== undefined) updates.candidate_fills       = !!body.candidate_fills;
  if (body.pdf_has_native_fields !== undefined) updates.pdf_has_native_fields = !!body.pdf_has_native_fields;
  if (body.is_required           !== undefined) updates.is_required           = body.is_required !== false;
  // Move slot into / out of a category (null = uncategorized). Validated
  // as UUID-or-null; tolerated when the column isn't migrated yet.
  if (body.category_id !== undefined)
    updates.category_id = (body.category_id && UUID_RE.test(body.category_id)) ? body.category_id : null;

  if (Object.keys(updates).length > 0) {
    const { error: updErr } = await db.from("phase_slots").update(updates).eq("id", body.id);
    if (updErr && /category_id|is_required|column .* does not exist|schema cache/i.test(updErr.message ?? "")) {
      // Pre-migration fallback: drop the not-yet-migrated columns and retry the rest.
      const { category_id: _o1, is_required: _o2, ...rest } = updates;
      void _o1; void _o2;
      if (Object.keys(rest).length > 0) await db.from("phase_slots").update(rest).eq("id", body.id);
    }
  }

  // When the slot's label changes, every already-submitted document under this
  // slot is renamed to match so file names always reflect the current
  // admin-defined label. Best-effort — failure logs but doesn't roll back the
  // label change.
  if (body.label !== undefined) {
    await renameSlotDocs(body.id, body.label.trim());
  }

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
    .from("phase_slots").select("org_id, employer_id").eq("id", body.id).maybeSingle();
  if (!slot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (auth.role !== "admin") {
    const s = slot as { org_id: string | null; employer_id: string | null };
    if (s.employer_id) {
      if (!(await canManageEmployer(auth, s.employer_id)))
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else if (s.org_id) {
      const { data: mem } = await db
        .from("organization_members")
        .select("org_id")
        .eq("sub_admin_email", auth.email)
        .eq("org_id", s.org_id)
        .maybeSingle();
      if (!mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { error: delErr } = await db.from("phase_slots").delete().eq("id", body.id);
  if (delErr) {
    console.error("[phase-slots DELETE]", delErr);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
