import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, getVisibleOrgIds } from "@/lib/admin-auth";
import { isOrgSide } from "@/lib/messagesAuth";
import { UUID_RE } from "@/lib/uuid";


/**
 * Employer registry.
 *
 *   GET   /api/portal/admin/employers         → active only, picker shape (admin + sub_admin)
 *   GET   /api/portal/admin/employers?all=1   → ALL employers, full row    (SUPREME only)
 *   POST  /api/portal/admin/employers         → create                     (BORIVON TEAM)
 *   PATCH /api/portal/admin/employers         → update by id               (SUPREME only)
 *
 * No hard delete — set active=false to retire (FK candidate_profiles.employer_id
 * is ON DELETE SET NULL, but keeping the row preserves history/audit).
 *
 * Why POST is open to the whole Borivon team while PATCH is not:
 * creating is the tail of PLACING a candidate. A sub-admin already picks the
 * employer and writes candidate_profiles.employer_id (../assign-employer, gated
 * per-candidate, no role check) — but if the hospital was not already in the
 * registry the flow dead-ended on the founder, and the placement waited on him.
 * PATCH/?all=1 are the registry MANAGEMENT surface (rename, retire, re-parent an
 * employer under an agency) and stay supreme-only: those edit rows other people's
 * candidates already point at.
 */

type Body = {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  address_lines?: unknown;
  agency_id?: unknown;
  active?: unknown;
  notes?: unknown;
};

/** Validate + coerce. Returns either an error or a clean partial row. */
function sanitizeIn(body: Body, opts: { isCreate: boolean }): { err?: string; row?: Record<string, unknown> } {
  const row: Record<string, unknown> = {};

  if ("slug" in body) {
    if (body.slug === null || body.slug === "") row.slug = null;
    else if (typeof body.slug !== "string") return { err: "slug must be a string" };
    else {
      const s = body.slug.trim().toLowerCase();
      if (!/^[a-z0-9_-]{1,64}$/.test(s)) return { err: "slug: a-z 0-9 _ - (max 64)" };
      row.slug = s;
    }
  }

  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) return { err: "name required" };
    row.name = body.name.trim().slice(0, 200);
  } else if (opts.isCreate) {
    return { err: "name required" };
  }

  if ("address_lines" in body) {
    if (!Array.isArray(body.address_lines)) return { err: "address_lines must be an array" };
    const lines = (body.address_lines as unknown[])
      .filter((l): l is string => typeof l === "string")
      .map(l => l.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (lines.length === 0) return { err: "address_lines: at least 1 non-empty line" };
    row.address_lines = lines;
  } else if (opts.isCreate) {
    return { err: "address_lines required" };
  }

  if ("agency_id" in body) {
    if (body.agency_id === null || body.agency_id === "") row.agency_id = null;
    else if (typeof body.agency_id !== "string" || !UUID_RE.test(body.agency_id.trim()))
      return { err: "agency_id must be a UUID or null" };
    else row.agency_id = body.agency_id.trim();
  }

  if ("active" in body) row.active = body.active === true || body.active === "true";

  if ("notes" in body) {
    if (body.notes === null || body.notes === "") row.notes = null;
    else if (typeof body.notes !== "string") return { err: "notes must be a string" };
    else row.notes = body.notes.slice(0, 2000);
  }

  return { row };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const wantAll = req.nextUrl.searchParams.get("all") === "1";
  const db = getServiceSupabase();

  // Manage page: full rows, all (active + inactive). Borivon team.
  //
  // This is the list behind /portal/admin/employers. It was supreme-only, which
  // meant a sub-admin could assign a candidate to an employer but could never
  // open the page that shows which employers exist, what their addresses are, or
  // which are retired — so the one screen that makes placement legible was
  // invisible to the people doing the placing. Agencies stay out: the roster of
  // every employer, including the ones parented to a competitor, is not theirs.
  if (wantAll) {
    if (await isOrgSide(db, auth.role, auth.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { data, error } = await db
      .from("employers")
      .select("id, slug, name, address_lines, agency_id, active, notes, created_at, updated_at")
      .order("active", { ascending: false })
      .order("name", { ascending: true });
    if (error) {
      console.error("[admin/employers all] list failed:", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    return NextResponse.json({ employers: data ?? [] });
  }

  // Picker shape (active only). admin + sub_admin.
  //
  // SCOPED for org-side callers (LAW #25). The roster of every employer — each
  // hospital's id, name, slug and PARENT AGENCY — is Borivon's commercial map,
  // not an agency's. The ?all=1 branch above already refuses them; this picker
  // handed over the same map, and the new Documents page renders it as a scope
  // list, so an agency admin could read off every competitor's sites. They now
  // see only the sites under the agencies they administer.
  const pickerScope = (await isOrgSide(db, auth.role, auth.email))
    ? (await getVisibleOrgIds(auth.email)) ?? []
    : null;

  let pickerQuery = db
    .from("employers")
    .select("id, name, slug, agency_id")
    .eq("active", true)
    .order("name", { ascending: true });
  if (pickerScope !== null) {
    // No agencies resolved → no sites, rather than every site.
    if (pickerScope.length === 0) return NextResponse.json({ employers: [] });
    pickerQuery = pickerQuery.in("agency_id", pickerScope);
  }
  const { data, error } = await pickerQuery;

  if (error) {
    console.error("[admin/employers] list failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const employers = (data ?? []).map(e => ({
    id: (e as { id: string }).id,
    name: (e as { name: string }).name,
    slug: (e as { slug: string | null }).slug,
    agencyId: (e as { agency_id: string | null }).agency_id,
  }));
  return NextResponse.json({ employers });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db0 = getServiceSupabase();
  // Borivon staff only. isOrgSide is the codebase's existing staff-vs-agency
  // predicate (same one the org-candidates route uses) and it FAILS CLOSED, so
  // a lookup blip denies rather than letting an agency admin add employers into
  // the registry every other agency picks from.
  if (await isOrgSide(db0, auth.role, auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const { err, row } = sanitizeIn(body, { isCreate: true });
  if (err || !row) return NextResponse.json({ error: err ?? "Bad request" }, { status: 400 });
  if (!("active" in row)) row.active = true;
  // A sub-admin creates DIRECT employers only. Parenting a new employer under an
  // agency changes that agency's roster and its CV branding, which is a registry
  // decision, not a placement one — keep it with PATCH and the supreme admin.
  if (auth.role !== "admin" && row.agency_id) {
    return NextResponse.json({ error: "Only the supreme admin can attach an employer to an agency" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db.from("employers").insert(row).select().single();
  if (error) {
    console.error("[admin/employers POST] create failed:", error);
    return NextResponse.json({ error: `Create failed: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ employer: data });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db0 = getServiceSupabase();
  if (await isOrgSide(db0, auth.role, auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { err, row } = sanitizeIn(body, { isCreate: false });
  if (err || !row) return NextResponse.json({ error: err ?? "Bad request" }, { status: 400 });
  if (Object.keys(row).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  // Correcting a hospital's address or retiring it is placement work. MOVING an
  // employer under a different agency re-assigns whose roster it belongs to and
  // which branding its candidates' CVs carry — that is a registry decision, and
  // it stays with the supreme admin, exactly as it does on create.
  if (auth.role !== "admin" && "agency_id" in row) {
    return NextResponse.json({ error: "Only the supreme admin can move an employer between agencies" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db.from("employers").update(row).eq("id", id).select().single();
  if (error) {
    console.error("[admin/employers PATCH] update failed:", error);
    return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ employer: data });
}
