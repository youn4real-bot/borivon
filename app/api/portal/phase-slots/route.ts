import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
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

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

/**
 * Rename every already-submitted document whose file_type points at this slot
 * so its filename reflects the slot's new label. Touches both the Drive file
 * (drive.files.update with new `name`) and the documents.file_name column.
 *
 * Failure on any single doc is logged + skipped — we don't roll back the
 * label change because partial rename is still better than a partial roll-back.
 */
async function renameSlotDocs(slotId: string, newLabel: string): Promise<void> {
  try {
    const db = getServiceSupabase();
    const { data: docs } = await db
      .from("documents")
      .select("id, user_id, drive_file_id, file_name")
      .eq("file_type", slotId);
    if (!docs || docs.length === 0) return;

    const slug = slugifyGerman(newLabel);
    const drive = getDriveClient();

    for (const raw of docs as { id: string; user_id: string; drive_file_id: string | null; file_name: string | null }[]) {
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

      if (raw.drive_file_id) {
        try {
          await drive.files.update({
            fileId: raw.drive_file_id,
            requestBody: { name: newName },
            supportsAllDrives: true,
            fields: "id, name",
          });
        } catch (driveErr) {
          console.warn(`[renameSlotDocs] Drive rename failed for ${raw.id}:`, driveErr);
        }
      }

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

  // ── EMPLOYER-scoped set takes priority (most specific) ─────────────────────
  // Admin/sub-admin managing a set passes ?employerId (authorized). A candidate
  // gets THEIR employer set automatically from candidate_profiles.employer_id —
  // no param, works even when an admin placed them (this is the "fixed docs per
  // pathway, e.g. Calmaroi → UKSH Lübeck" behaviour).
  let employerId: string | null = null;
  if (adminViewingCand) {
    employerId = adminCandEmployer;
  } else if (employerIdParam && UUID_RE.test(employerIdParam)) {
    const adminAuth = await requireAdminRole(req);
    if (adminAuth.ok && (await canManageEmployer(adminAuth, employerIdParam))) {
      employerId = employerIdParam;
    }
  } else {
    const adminAuth = await requireAdminRole(req);
    if (!adminAuth.ok) {
      // Candidate: their assigned employer drives the fixed set.
      const { data: prof } = await db
        .from("candidate_profiles")
        .select("employer_id")
        .eq("user_id", userId)
        .maybeSingle();
      employerId = (prof as { employer_id: string | null } | null)?.employer_id ?? null;
    }
  }

  if (employerId) {
    const { data } = await db
      .from("phase_slots")
      .select("*")
      .eq("employer_id", employerId)
      .eq("phase", phase)
      .order("position");
    const empSlots = (data ?? []) as PhaseSlot[];
    // Only short-circuit when the employer actually has a set; otherwise fall
    // through to org / global so an employer with no custom set still works.
    if (empSlots.length > 0 || employerIdParam) {
      return NextResponse.json({ slots: empSlots });
    }
  }

  let orgId: string | null = null;
  if (adminViewingCand) {
    // Admin viewing a candidate → that candidate's approved org (or global).
    orgId = adminCandOrg;
  } else if (orgIdParam && UUID_RE.test(orgIdParam)) {
    // SECURITY: a `?orgId=` param must NOT be honored blindly — that let any
    // authenticated candidate read ANY org's private slot definitions
    // (instructions, template paths) by guessing org UUIDs. Only an
    // admin/sub-admin (org tooling) may pass an arbitrary org; a candidate is
    // restricted to an org they're approved + self-joined to. An unlinked
    // param is ignored → falls through to auto-detect/global below.
    const adminAuth = await requireAdminRole(req);
    if (adminAuth.ok) {
      orgId = orgIdParam;
    } else {
      const { data: link } = await db
        .from("candidate_organizations")
        .select("org_id")
        .eq("candidate_user_id", userId)
        .eq("org_id", orgIdParam)
        .eq("status", "approved")
        .neq("added_by", "admin")
        .maybeSingle();
      if (link) orgId = orgIdParam;
    }
  }
  if (!orgId && !adminViewingCand) {
    // Org admin with no explicit scope → THEIR org's slot set (so the slot
    // manager shows + edits their org's slots, not the global ones).
    const adminAuth = await requireAdminRole(req);
    if (adminAuth.ok && adminAuth.role === "sub_admin") {
      const { data: m } = await db
        .from("organization_members")
        .select("org_id")
        .eq("sub_admin_email", adminAuth.email)
        .maybeSingle();
      orgId = (m as { org_id: string } | null)?.org_id ?? null;
    }
  }
  if (!orgId && !adminViewingCand) {
    // Auto-detect: candidate's approved org. Admin-initiated links are
    // excluded (user request 2026-05: candidate must not see content from
    // agencies an admin placed them with). Candidate-self-joined orgs
    // still get their org-specific slot templates.
    const { data: mem } = await db
      .from("candidate_organizations")
      .select("org_id")
      .eq("candidate_user_id", userId)
      .eq("status", "approved")
      .neq("added_by", "admin")
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
    candidate_signature_zone?: unknown;
    positions?: { id: string; position: number; category_id?: string | null }[];
    category_id?: string | null;
    admin_signs?: boolean; candidate_signs?: boolean; admin_fills?: boolean; candidate_fills?: boolean;
    pdf_has_native_fields?: boolean;
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
  // Move slot into / out of a category (null = uncategorized). Validated
  // as UUID-or-null; tolerated when the column isn't migrated yet.
  if (body.category_id !== undefined)
    updates.category_id = (body.category_id && UUID_RE.test(body.category_id)) ? body.category_id : null;

  if (Object.keys(updates).length > 0) {
    const { error: updErr } = await db.from("phase_slots").update(updates).eq("id", body.id);
    if (updErr && /category_id|column .* does not exist|schema cache/i.test(updErr.message ?? "")) {
      // Pre-migration fallback: drop category_id and retry the rest.
      const { category_id: _omit, ...rest } = updates;
      void _omit;
      if (Object.keys(rest).length > 0) await db.from("phase_slots").update(rest).eq("id", body.id);
    }
  }

  // When the slot's label changes, every already-submitted document under
  // this slot is renamed to match (Drive + DB) so file names always reflect
  // the current admin-defined label. Best-effort — failure logs but doesn't
  // roll back the label change.
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
