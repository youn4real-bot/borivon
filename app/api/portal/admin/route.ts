import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { LABEL_TO_FILE_KEY } from "@/lib/fileKeys";
import { requireAdminRole, canActOnCandidate, getVisibleCandidateIds } from "@/lib/admin-auth";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";
import { UUID_RE } from "@/lib/uuid";
// Doc-review + profile-patch mutation logic is shared with the AI assistant
// (lib/assistantWrites) so both surfaces behave identically — see lib/adminCandidateActions.
import { applyDocReview, applyCandidateProfilePatch } from "@/lib/adminCandidateActions";

// GET — fetch candidates + their docs (filtered for sub-admins)
// Optional ?userId=X — return only docs for that candidate (used by targeted
// post-upload refreshes so we don't reload the entire admin payload).
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { role, email: token } = auth;

  const targetUserId = req.nextUrl.searchParams.get("userId") ?? null;
  // Validate to prevent injection via the query param.
  const filteredUserId = targetUserId && UUID_RE.test(targetUserId) ? targetUserId : null;

  const db = getServiceSupabase();

  // Whether this caller sees the UNRESTRICTED candidate pool. Supreme admin
  // always does; a regular sub-admin does too (LAW #25 — sub-admins see ALL
  // candidates). Org/agency admins are scoped, so NOT here. Drives whether we
  // also surface signed-up-but-no-docs candidates (else they're invisible to
  // sub-admins until their first upload — the "missing candidate" bug).
  let surfaceAllUsers = role === "admin";

  let docs;
  if (role === "admin") {
    // Full admin — all docs (or filtered to one user)
    let q = db
      .from("documents")
      .select("*") // '*' so a not-yet-migrated superseded_at column never errors; archived rows filtered below
      .order("uploaded_at", { ascending: false });
    if (filteredUserId) q = q.eq("user_id", filteredUserId);
    const { data, error } = await q;
    if (error) { console.error("[admin GET] documents query failed:", error); return NextResponse.json({ error: "Internal error" }, { status: 500 }); }
    docs = (data ?? []).filter((d) => !(d as { superseded_at?: string | null }).superseded_at); // hide archived (LAW #33)
  } else if (auth.isAgencyAdmin && auth.agencyId) {
    // Agency admin — all candidates in their agency
    const { data: agencyCands } = await db
      .from("candidate_profiles")
      .select("user_id")
      .eq("agency_id", auth.agencyId);
    const agencyIds = ((agencyCands ?? []) as { user_id: string }[]).map(r => r.user_id);
    if (agencyIds.length === 0) {
      return NextResponse.json({ docs: [], users: {}, role });
    }
    const allowedIds = filteredUserId ? [filteredUserId].filter(id => agencyIds.includes(id)) : agencyIds;
    if (allowedIds.length === 0) return NextResponse.json({ docs: [], users: {}, role });
    const { data, error } = await db
      .from("documents")
      .select("*") // '*' so a not-yet-migrated superseded_at column never errors; archived rows filtered below
      .in("user_id", allowedIds)
      .order("uploaded_at", { ascending: false });
    if (error) { console.error("[admin GET] documents query (agency) failed:", error); return NextResponse.json({ error: "Internal error" }, { status: 500 }); }
    docs = (data ?? []).filter((d) => !(d as { superseded_at?: string | null }).superseded_at); // hide archived (LAW #33)
  } else {
    // Sub-admin — scope by visibility (LAW #25).
    // Regular sub-admins see all (null); org admins see only their org's candidates.
    const visibleIds = await getVisibleCandidateIds(token);
    // Regular sub-admin (null = no scope) sees every candidate → also surface
    // those with no documents yet. Org admins keep their scoped list.
    surfaceAllUsers = visibleIds === null;

    let q = db
      .from("documents")
      .select("*") // '*' so a not-yet-migrated superseded_at column never errors; archived rows filtered below
      .order("uploaded_at", { ascending: false });

    if (visibleIds === null) {
      // Regular sub-admin: all candidates, filter only by specific user if requested.
      if (filteredUserId) q = q.eq("user_id", filteredUserId);
    } else {
      if (visibleIds.length === 0) return NextResponse.json({ docs: [], users: {}, role });
      const allowedIds = filteredUserId ? [filteredUserId].filter(id => visibleIds.includes(id)) : visibleIds;
      if (allowedIds.length === 0) return NextResponse.json({ docs: [], users: {}, role });
      q = q.in("user_id", allowedIds);
    }

    const { data, error } = await q;

    if (error) { console.error("[admin GET] documents query failed:", error); return NextResponse.json({ error: "Internal error" }, { status: 500 }); }
    docs = (data ?? []).filter((d) => !(d as { superseded_at?: string | null }).superseded_at); // hide archived (LAW #33)
  }

  // Fetch user metadata (reuse the same service-role client)
  const adminClient = getServiceSupabase();

  let userIds = [...new Set(docs.map((d: { user_id: string }) => d.user_id))];
  const users: Record<string, { email: string; name: string; createdAt?: string | null }> = {};

  // For full admins, surface candidates who have signed up but not yet
  // uploaded anything — otherwise they're invisible until their first
  // document lands. Skip this expensive scan when ?userId is set (targeted
  // refresh) or for sub-admins / agency admins.
  if (surfaceAllUsers && !filteredUserId) {
    // Collect all admin/sub-admin emails to exclude them from the candidate list.
    const { data: subAdminRows } = await db.from("sub_admins").select("email");
    const adminEmailSet = new Set((subAdminRows ?? []).map((r: { email: string }) => r.email.toLowerCase()));
    // Also exclude the current requester (the supreme admin).
    if (auth.email) adminEmailSet.add(auth.email.toLowerCase());

    // perPage:1000 (the GoTrue max) — the loop already stops when a short page
    // arrives, so this just cuts the number of round-trips ~20x on the admin load.
    let page = 1;
    while (true) {
      const { data: batch } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
      const list = batch?.users ?? [];
      for (const u of list) {
        if (!u.id || !u.email) continue;
        // A deleted person is GONE — never list a soft-deleted/ghost account.
        if (isSoftDeletedAuthUser(u)) continue;
        // Skip admin/sub-admin accounts — only candidates belong in this list.
        if (adminEmailSet.has(u.email.toLowerCase())) continue;
        if (!userIds.includes(u.id)) userIds.push(u.id);
        users[u.id] = {
          email: u.email,
          name: u.user_metadata?.full_name ?? u.email,
          createdAt: u.created_at ?? null, // signup timestamp → admin "who registered when" + inactive-signup radar
        };
      }
      if (list.length < 1000) break;
      page++;
    }
  }

  // One missing/deleted user shouldn't 500 the whole admin page — swallow
  // individual lookup failures and leave that uid out of the map.
  await Promise.all(userIds.map(async (uid) => {
    if (users[uid]) return; // already populated by listUsers
    try {
      const { data } = await adminClient.auth.admin.getUserById(uid);
      if (data?.user && !isSoftDeletedAuthUser(data.user)) {
        users[uid] = {
          email: data.user.email ?? uid,
          name: data.user.user_metadata?.full_name ?? data.user.email ?? uid,
          createdAt: data.user.created_at ?? null,
        };
      }
    } catch (err) {
      console.warn("[admin GET] getUserById failed for", uid, err);
    }
  }));

  // STAFF ARE NEVER CANDIDATES. The supreme admin, every sub-admin, and
  // org admins/members must never appear in the candidate list — even if a
  // stray `documents` row got mis-attributed to one of them (the old
  // CV-ownership bug saved a candidate's CV under the editing sub-admin's
  // id). Prune by resolved email so this is fixed RETROACTIVELY for all
  // existing corruption, with zero data migration.
  {
    const { data: staffRows } = await db.from("sub_admins").select("email");
    const staffEmails = new Set(
      (staffRows ?? []).map((r: { email: string }) => (r.email ?? "").toLowerCase()).filter(Boolean),
    );
    const supremeEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
    if (supremeEmail) staffEmails.add(supremeEmail);
    const excluded = new Set(
      userIds.filter(uid => staffEmails.has((users[uid]?.email ?? "").toLowerCase())),
    );
    if (excluded.size) {
      userIds = userIds.filter(uid => !excluded.has(uid));
      docs = docs.filter((d: { user_id: string }) => !excluded.has(d.user_id));
      for (const uid of excluded) delete users[uid];
    }
  }

  // Fetch passport profiles (all fields).
  // payment_tier was added in supabase/payments.sql — if not yet migrated it will
  // simply be absent from the rows; the UI falls back to null gracefully.
  const { data: profileRows } = await db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, dob, sex, nationality, passport_no, passport_expiry, city_of_birth, country_of_birth, issuing_authority, issue_date, address_street, address_number, address_postal, city_of_residence, country_of_residence, passport_status, passport_feedback, marital_status, children_ages, manually_verified, profile_photo, payment_tier, placement_ready, b2_stage, b2_failed, nursing_specialty, years_experience, workplace_pref, cv_use_agency_branding, cv_use_borivon_branding")
    .in("user_id", userIds);
  const profiles: Record<string, {
    first_name: string | null; last_name: string | null;
    dob: string | null; sex: string | null; nationality: string | null;
    passport_no: string | null; passport_expiry: string | null;
    city_of_birth: string | null; country_of_birth: string | null;
    issuing_authority: string | null; issue_date: string | null;
    address_street: string | null; address_number: string | null;
    address_postal: string | null; city_of_residence: string | null;
    country_of_residence: string | null;
    passport_status: string | null;
    passport_feedback: string | null;
    marital_status: string | null;
    children_ages: string | null;
    manually_verified: boolean | null;
    profile_photo: string | null;
    payment_tier: string | null;
    placement_ready: boolean | null;
    b2_stage?: string | null;
    b2_failed?: boolean | null;
    nursing_specialty?: string | null;
    years_experience?: number | null;
    workplace_pref?: string | null;
    cv_use_agency_branding: boolean | null;
    cv_use_borivon_branding: boolean | null;
  }> = {};
  for (const p of profileRows ?? []) {
    profiles[p.user_id] = p;
  }

  // ── Deduplicate: per (user_id, fileKey) keep only the most-recent doc ─────────
  // Docs are already sorted uploaded_at DESC so first occurrence = latest version.
  // Older versions go into docHistory so admin can view upload trail.
  // EXCEPTION: "other" (Sonstiges) is a multi-doc slot — every upload is a
  // distinct peer file, so all of them stay in activeDocs.
  const seen = new Set<string>();
  const activeDocs: typeof docs = [];
  const docHistory: typeof docs = [];
  for (const d of docs) {
    const fileType = (d as { file_type: string }).file_type;
    const fk   = LABEL_TO_FILE_KEY[fileType] ?? fileType;
    const userId = (d as { user_id: string }).user_id;
    if (fk === "other") {
      activeDocs.push(d);
      continue;
    }
    const slot = `${userId}:${fk}`;
    if (!seen.has(slot)) { seen.add(slot); activeDocs.push(d); }
    else                  docHistory.push(d);
  }

  // Org links per candidate (only approved links — pending links shouldn't
  // surface as "this candidate belongs to X" in the admin candidate list)
  const candidateOrgs: Record<string, { id: string; name: string }[]> = {};
  if (userIds.length > 0) {
    const { data: orgLinks } = await db
      .from("candidate_organizations")
      .select("candidate_user_id, org_id")
      .eq("status", "approved")
      .in("candidate_user_id", userIds);
    type LinkRow = { candidate_user_id: string; org_id: string };
    const linkRows = (orgLinks ?? []) as LinkRow[];
    const orgIds = [...new Set(linkRows.map(l => l.org_id))];
    type OrgRow = { id: string; name: string };
    let orgs: OrgRow[] = [];
    if (orgIds.length > 0) {
      const { data } = await db.from("organizations").select("id, name").in("id", orgIds);
      orgs = (data ?? []) as OrgRow[];
    }
    const orgById: Record<string, OrgRow> = {};
    for (const o of orgs) orgById[o.id] = o;
    for (const l of linkRows) {
      const o = orgById[l.org_id];
      if (!o) continue;
      (candidateOrgs[l.candidate_user_id] ??= []).push(o);
    }
  }

  return NextResponse.json({ docs: activeDocs, docHistory, users, profiles, candidateOrgs, role });
}

// POST — review a document (status + feedback) → notify candidate. Shares the
// exact mutation/notification pipeline with the AI assistant via applyDocReview.
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { role, email: token } = auth;

  const { docId, status, feedback } = await req.json();
  if (!docId || !status) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  if (typeof docId !== "string" || typeof status !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const r = await applyDocReview(
    db,
    { docId, status, feedback },
    (ownerId) => canActOnCandidate(role, token, ownerId), // LAW #25 — sub-admins scoped
  );
  if (!r.ok) {
    if (r.error === "reject_needs_reason") return NextResponse.json({ error: "Rejection requires a reason" }, { status: 400 });
    if (r.error === "bad_status") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (r.error === "not_found") return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (r.error === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// PATCH — update candidate profile fields (admin or assigned sub-admin). Shares
// the allowlist/date/OCR/cv_draft/name-sync/notify pipeline with the AI
// assistant via applyCandidateProfilePatch.
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { role, email: token } = auth;

  const { userId, profile } = await req.json();
  if (!userId || !profile || typeof profile !== "object") {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (typeof userId !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (!(await canActOnCandidate(role, token, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const r = await applyCandidateProfilePatch(db, { userId, profile: profile as Record<string, unknown> });
  if (!r.ok) {
    if (r.error === "no_valid_fields") return NextResponse.json({ error: "No valid fields" }, { status: 400 });
    return NextResponse.json({ error: r.error }, { status: 500 }); // "Save failed: …" (exact pg msg)
  }
  return NextResponse.json({ success: true });
}
