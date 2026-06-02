import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, ciEmail } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";
import {
  JOURNEY_PRESETS,
  allowedOwnersFor,
  canToggle,
  isJourneyOwner,
  type JourneyOwner,
} from "@/lib/candidateJourney";

/**
 * Per-candidate JOURNEY checklist. ONE endpoint serves three caller types:
 *   • borivon       — supreme admin + global sub-admins → every candidate, full power
 *   • organization  — org members / org-admins → only candidates linked to their org
 *   • candidate      — the nurse → own list, candidate-owned items only
 *
 * Party + scope resolution mirrors LAW #25. The table is RLS-locked; this
 * route (service-role) is the only reader/writer.
 */

const MAX_TEXT = 500;

type Access = {
  party: JourneyOwner;
  email: string;
  canAdd: boolean;
  canDelete: boolean;
  allowedOwners: JourneyOwner[];
};

/** Resolve the caller's party + whether they may act on `candidateId`. */
async function resolveAccess(
  req: NextRequest,
  candidateId: string,
): Promise<{ ok: true; access: Access } | { ok: false; status: number; error: string }> {
  const user = await requireUser(req);
  if (!user.ok) return { ok: false, status: user.status, error: user.error };
  if (!candidateId || !UUID_RE.test(candidateId)) {
    return { ok: false, status: 400, error: "candidateId required" };
  }

  const email = user.email;
  const db = getServiceSupabase();
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  // Supreme admin → Borivon, unrestricted.
  if (email && email === adminEmail) {
    return mkAccess("borivon");
  }

  // Partner-org membership takes precedence (org members are also rows in
  // sub_admins — /me/role routes them as org first; we mirror that).
  const { data: memRows } = await db
    .from("organization_members")
    .select("org_id")
    .ilike("sub_admin_email", ciEmail(email));
  const myOrgs = ((memRows ?? []) as { org_id: string }[]).map((r) => r.org_id);

  const { data: subRows } = await db
    .from("sub_admins")
    .select("is_agency_admin")
    .ilike("email", ciEmail(email))
    .limit(1);
  const sub = (subRows ?? [])[0] as { is_agency_admin: boolean } | undefined;

  let party: JourneyOwner;
  if (myOrgs.length > 0) party = "organization";
  else if (sub && sub.is_agency_admin === false) party = "borivon"; // global staff
  else if (sub && sub.is_agency_admin === true) party = "organization"; // org-admin w/o member row
  else if (user.userId === candidateId) party = "candidate";
  else return { ok: false, status: 403, error: "Forbidden" };

  // Scope checks.
  if (party === "organization") {
    if (myOrgs.length === 0) return { ok: false, status: 403, error: "Forbidden" };
    const { data: link } = await db
      .from("candidate_organizations")
      .select("org_id")
      .eq("candidate_user_id", candidateId)
      .eq("status", "approved")
      .in("org_id", myOrgs)
      .maybeSingle();
    if (!link) return { ok: false, status: 403, error: "Forbidden" };
  } else if (party === "candidate") {
    if (user.userId !== candidateId) return { ok: false, status: 403, error: "Forbidden" };
  }

  return mkAccess(party);

  function mkAccess(p: JourneyOwner): { ok: true; access: Access } {
    return {
      ok: true,
      access: {
        party: p,
        email,
        canAdd: p === "borivon" || p === "organization",
        canDelete: p === "borivon",
        allowedOwners: allowedOwnersFor(p),
      },
    };
  }
}

const SELECT = "id, text, owner, done, done_by, done_at, preset_key, position, created_by, due_date, blocked, blocked_reason";

/** Validate a due-date input → {ok,value} where value is "YYYY-MM-DD" or null (clear). */
function parseDueDate(v: unknown): { ok: boolean; value: string | null } {
  if (v === null || v === "") return { ok: true, value: null };
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`))) {
    return { ok: true, value: v };
  }
  return { ok: false, value: null };
}

/** Idempotently seed the preset milestones onto a candidate (no-op if present). */
async function seedPresets(candidateId: string) {
  const rows = JOURNEY_PRESETS.map((p) => ({
    candidate_user_id: candidateId,
    text: p.label.en, // canonical fallback; UI re-labels presets by preset_key
    owner: p.owner,
    preset_key: p.key,
    position: p.position,
    created_by: "system",
  }));
  await getServiceSupabase()
    .from("candidate_journey_items")
    .upsert(rows, { onConflict: "candidate_user_id,preset_key", ignoreDuplicates: true });
}

// GET ?candidateId= → seed presets, return party-filtered items + permissions
export async function GET(req: NextRequest) {
  const candidateId = req.nextUrl.searchParams.get("candidateId") ?? "";
  const g = await resolveAccess(req, candidateId);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });

  await seedPresets(candidateId);

  const db = getServiceSupabase();
  let q = db
    .from("candidate_journey_items")
    .select(SELECT)
    .eq("candidate_user_id", candidateId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  // Candidate sees ONLY items explicitly assigned to them — owner='candidate'
  // CUSTOM items added by Borivon / their org. The auto-seeded preset
  // milestones are hidden from the candidate (they're the admin/org tracking
  // board), so a candidate's list is empty until something is actually
  // assigned to them.
  if (g.access.party === "candidate") q = q.eq("owner", "candidate").is("preset_key", null);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // PII hygiene: done_by / created_by are actor emails (often Borivon staff).
  // Only Borivon sees them; partner orgs + candidates get them stripped so a
  // partner can't harvest internal staff emails off a shared candidate journey.
  let items: Record<string, unknown>[] = (data ?? []) as Record<string, unknown>[];
  if (g.access.party !== "borivon") {
    items = items.map(({ done_by, created_by, ...rest }) => {
      void done_by; void created_by;
      return rest;
    });
  }
  // blocked_reason is an internal management note (e.g. "authority backlog").
  // The candidate never sees it; Borivon + the partner org do.
  if (g.access.party === "candidate") {
    items = items.map(({ blocked_reason, ...rest }) => { void blocked_reason; return rest; });
  }

  // The candidate's B2 sub-journey stage (parallel track on candidate_profiles).
  const { data: prof } = await db
    .from("candidate_profiles").select("b2_stage").eq("user_id", candidateId).maybeSingle();
  const b2Stage = (prof as { b2_stage?: string } | null)?.b2_stage ?? "not_started";

  return NextResponse.json({
    items,
    party: g.access.party,
    canAdd: g.access.canAdd,
    canDelete: g.access.canDelete,
    allowedOwners: g.access.allowedOwners,
    b2Stage,
  });
}

// POST { candidateId, text, owner } → add a custom item
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
  const g = await resolveAccess(req, candidateId);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  if (!g.access.canAdd) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  const owner = body?.owner;
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (!isJourneyOwner(owner) || !g.access.allowedOwners.includes(owner)) {
    return NextResponse.json({ error: "owner not allowed" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data: maxRow } = await db
    .from("candidate_journey_items")
    .select("position")
    .eq("candidate_user_id", candidateId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPos = (((maxRow as { position: number } | null)?.position ?? -1) + 1);

  const { data, error } = await db
    .from("candidate_journey_items")
    .insert({
      candidate_user_id: candidateId,
      text,
      owner,
      preset_key: null,
      position: nextPos,
      created_by: g.access.email,
    })
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

// PATCH { candidateId, id, done? , text? } → toggle (owner-gated) or rename (Borivon only)
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
  const id = typeof body?.id === "string" ? body.id : "";
  const g = await resolveAccess(req, candidateId);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getServiceSupabase();
  // Load the row (and confirm it belongs to this candidate).
  const { data: rowData } = await db
    .from("candidate_journey_items")
    .select("id, owner, preset_key")
    .eq("id", id)
    .eq("candidate_user_id", candidateId)
    .maybeSingle();
  const row = rowData as { id: string; owner: JourneyOwner; preset_key: string | null } | null;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.done === "boolean") {
    if (!canToggle(g.access.party, row.owner)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    patch.done = body.done;
    patch.done_by = body.done ? g.access.email : null;
    patch.done_at = body.done ? new Date().toISOString() : null;
  }

  if (typeof body.text === "string") {
    // Rename = Borivon only, custom items only (presets re-label by key).
    if (g.access.party !== "borivon" || row.preset_key) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const txt = body.text.trim().slice(0, MAX_TEXT);
    if (!txt) return NextResponse.json({ error: "text empty" }, { status: 400 });
    patch.text = txt;
  }

  // ── Autopilot management fields: due date + blocked state ──────────────────
  // These drive the pipeline board. Only the managing parties (Borivon / org)
  // set them — the candidate never sets their own deadlines or block flags.
  const managing = g.access.party === "borivon" || g.access.party === "organization";

  if ("due_date" in body) {
    if (!managing) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const d = parseDueDate(body.due_date);
    if (!d.ok) return NextResponse.json({ error: "invalid due_date" }, { status: 400 });
    patch.due_date = d.value;
  }

  if (typeof body.blocked === "boolean") {
    if (!managing) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    patch.blocked = body.blocked;
    if (!body.blocked) patch.blocked_reason = null; // clearing a block clears its reason
  }

  if (typeof body.blocked_reason === "string") {
    if (!managing) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    patch.blocked_reason = body.blocked_reason.trim().slice(0, MAX_TEXT) || null;
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await db
    .from("candidate_journey_items")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

// DELETE { candidateId, id } → remove a CUSTOM item (Borivon only; presets are permanent)
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
  const id = typeof body?.id === "string" ? body.id : "";
  const g = await resolveAccess(req, candidateId);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  if (!g.access.canDelete) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getServiceSupabase();
  // Only custom items (preset_key null) are deletable — guard in the query.
  const { data, error } = await db
    .from("candidate_journey_items")
    .delete()
    .eq("id", id)
    .eq("candidate_user_id", candidateId)
    .is("preset_key", null)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Not found or not deletable" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
