import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { LABEL_TO_FILE_KEY } from "@/lib/fileKeys";
import { requireAdminRole, canActOnCandidate, getVisibleCandidateIds } from "@/lib/admin-auth";
import { DOC_STATUSES, ALLOWED_PROFILE_FIELDS } from "@/lib/constants";
import { sendDocApprovedEmail, sendDocRejectedEmail, sendVerifiedEmail } from "@/lib/email";

// GET — fetch candidates + their docs (filtered for sub-admins)
// Optional ?userId=X — return only docs for that candidate (used by targeted
// post-upload refreshes so we don't reload the entire admin payload).
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { role, email: token } = auth;

  const targetUserId = req.nextUrl.searchParams.get("userId") ?? null;
  const UUID_RE_ADMIN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Validate to prevent injection via the query param.
  const filteredUserId = targetUserId && UUID_RE_ADMIN.test(targetUserId) ? targetUserId : null;

  const db = getServiceSupabase();

  let docs;
  if (role === "admin") {
    // Full admin — all docs (or filtered to one user)
    let q = db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id, uploaded_by_admin")
      .order("uploaded_at", { ascending: false });
    if (filteredUserId) q = q.eq("user_id", filteredUserId);
    const { data, error } = await q;
    if (error) { console.error("[admin GET] documents query failed:", error); return NextResponse.json({ error: "Internal error" }, { status: 500 }); }
    docs = data ?? [];
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
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id, uploaded_by_admin")
      .in("user_id", allowedIds)
      .order("uploaded_at", { ascending: false });
    if (error) { console.error("[admin GET] documents query (agency) failed:", error); return NextResponse.json({ error: "Internal error" }, { status: 500 }); }
    docs = data ?? [];
  } else {
    // Sub-admin — only candidates they have access to.
    // Combines direct assignments AND organization membership.
    const assignedIds = await getVisibleCandidateIds(token);

    if (assignedIds.length === 0) {
      return NextResponse.json({ docs: [], users: {}, role });
    }

    const allowedIds = filteredUserId ? [filteredUserId].filter(id => assignedIds.includes(id)) : assignedIds;
    if (allowedIds.length === 0) return NextResponse.json({ docs: [], users: {}, role });

    const { data, error } = await db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id, uploaded_by_admin")
      .in("user_id", allowedIds)
      .order("uploaded_at", { ascending: false });

    if (error) { console.error("[admin GET] documents query failed:", error); return NextResponse.json({ error: "Internal error" }, { status: 500 }); }
    docs = data ?? [];
  }

  // Fetch user metadata (reuse the same service-role client)
  const adminClient = getServiceSupabase();

  const userIds = [...new Set(docs.map((d: { user_id: string }) => d.user_id))];
  const users: Record<string, { email: string; name: string }> = {};

  // For full admins, surface candidates who have signed up but not yet
  // uploaded anything — otherwise they're invisible until their first
  // document lands. Skip this expensive scan when ?userId is set (targeted
  // refresh) or for sub-admins / agency admins.
  if (role === "admin" && !filteredUserId) {
    // Collect all admin/sub-admin emails to exclude them from the candidate list.
    const { data: subAdminRows } = await db.from("sub_admins").select("email");
    const adminEmailSet = new Set((subAdminRows ?? []).map((r: { email: string }) => r.email.toLowerCase()));
    // Also exclude the current requester (the supreme admin).
    if (auth.email) adminEmailSet.add(auth.email.toLowerCase());

    let page = 1;
    while (true) {
      const { data: batch } = await adminClient.auth.admin.listUsers({ page, perPage: 50 });
      const list = batch?.users ?? [];
      for (const u of list) {
        if (!u.id || !u.email) continue;
        // Skip admin/sub-admin accounts — only candidates belong in this list.
        if (adminEmailSet.has(u.email.toLowerCase())) continue;
        if (!userIds.includes(u.id)) userIds.push(u.id);
        users[u.id] = {
          email: u.email,
          name: u.user_metadata?.full_name ?? u.email,
        };
      }
      if (list.length < 50) break;
      page++;
    }
  }

  // One missing/deleted user shouldn't 500 the whole admin page — swallow
  // individual lookup failures and leave that uid out of the map.
  await Promise.all(userIds.map(async (uid) => {
    if (users[uid]) return; // already populated by listUsers
    try {
      const { data } = await adminClient.auth.admin.getUserById(uid);
      if (data?.user) {
        users[uid] = {
          email: data.user.email ?? uid,
          name: data.user.user_metadata?.full_name ?? data.user.email ?? uid,
        };
      }
    } catch (err) {
      console.warn("[admin GET] getUserById failed for", uid, err);
    }
  }));

  // Fetch passport profiles (all fields).
  // payment_tier was added in supabase/payments.sql — if not yet migrated it will
  // simply be absent from the rows; the UI falls back to null gracefully.
  const { data: profileRows } = await db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, dob, sex, nationality, passport_no, passport_expiry, city_of_birth, country_of_birth, issuing_authority, issue_date, address_street, address_number, address_postal, city_of_residence, country_of_residence, passport_status, passport_feedback, marital_status, children_ages, manually_verified, profile_photo, payment_tier, placement_ready")
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

// POST — update status + feedback, then notify candidate
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { role, email: token } = auth;

  const { docId, status, feedback } = await req.json();
  if (!docId || !status) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  if (typeof docId !== "string" || typeof status !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  // Allow only known status values
  if (!(DOC_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const db = getServiceSupabase();

  // Sub-admins may only review docs for their assigned candidates
  const { data: doc0 } = await db.from("documents").select("user_id").eq("id", docId).maybeSingle();
  if (!doc0) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  if (!(await canActOnCandidate(role, token, doc0.user_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Update the document
  const { error } = await db
    .from("documents")
    .update({ status, feedback: typeof feedback === "string" ? feedback : null })
    .eq("id", docId);

  if (error) {
    console.error("[admin POST] update document failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // Notify candidate on approve / reject
  if (status === "approved" || status === "rejected") {
    const { data: doc } = await db
      .from("documents")
      .select("user_id, file_name, file_type")
      .eq("id", docId)
      .maybeSingle();

    if (doc) {
      await db.from("notifications").insert({
        user_id:  doc.user_id,
        doc_id:   docId,
        doc_name: doc.file_name,
        doc_type: doc.file_type,
        action:   status,
        feedback: typeof feedback === "string" ? feedback : null,
        read:     false,
      });

      // Fire transactional email (fire-and-forget)
      db.auth.admin.getUserById(doc.user_id).then(({ data }) => {
        const email = data?.user?.email;
        if (!email) return;
        if (status === "approved") sendDocApprovedEmail(email, doc.file_type);
        else sendDocRejectedEmail(email, doc.file_type, typeof feedback === "string" ? feedback : null);
      }).catch(() => {});

      // Auto blue-tick: passport file just approved — check if data is also approved
      if (status === "approved" && /pass/i.test(doc.file_type)) {
        await maybeGrantVerified(db, doc.user_id);
      }
    }
  }

  return NextResponse.json({ success: true });
}

/** Send a one-time "verified" notification and mark manually_verified when
 *  both the passport document AND passport_status are approved. */
async function maybeGrantVerified(
  db: ReturnType<typeof getServiceSupabase>,
  userId: string,
) {
  // Check passport_status
  const { data: profile } = await db
    .from("candidate_profiles")
    .select("passport_status, manually_verified")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.passport_status !== "approved") return;
  if (profile?.manually_verified) return; // already verified

  // Check passport doc approved
  const { data: passDocs } = await db
    .from("documents")
    .select("status")
    .eq("user_id", userId)
    .ilike("file_type", "%pass%")
    .eq("status", "approved")
    .limit(1);
  if (!passDocs?.length) return;

  // Grant verified + mark placement-ready atomically. Conditional on the
  // current value of manually_verified so concurrent calls (passport doc and
  // passport data approved at almost the same moment) don't both fall through
  // to insert duplicate notifications + send duplicate verified emails.
  // Catch both manually_verified=false AND NULL (newly-created rows where the
  // column was never set) — eq("manually_verified", false) misses NULL and
  // would let two concurrent grants both win the race.
  const { data: updated } = await db
    .from("candidate_profiles")
    .update({ manually_verified: true, placement_ready: true })
    .eq("user_id", userId)
    .not("manually_verified", "is", true)
    .select("user_id");
  if (!updated?.length) return; // lost the race — someone else already verified

  // Trigger match suggestions for this newly-ready candidate (fire-and-forget)
  maybeCreateMatches(db, userId).catch(e => console.warn("[maybeCreateMatches]", e));

  // Send one-time "verified" notification (skip if already sent)
  const { data: existing } = await db
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("action", "verified")
    .limit(1);
  if (existing?.length) return;

  await db.from("notifications").insert({
    user_id:  userId,
    doc_id:   null,
    doc_name: "Verifizierung",
    doc_type: "Passport",
    action:   "verified",
    feedback: null,
    read:     false,
  });

  // Fire verified email (fire-and-forget)
  db.auth.admin.getUserById(userId).then(({ data }) => {
    const email = data?.user?.email;
    if (!email) return;
    const firstName = (data?.user?.user_metadata?.full_name ?? "").split(" ")[0];
    sendVerifiedEmail(email, firstName);
  }).catch(() => {});
}

/** When a candidate becomes placement_ready, cross-check all active org
 *  requirements and insert a suggested_matches row for each new match. */
async function maybeCreateMatches(
  db: ReturnType<typeof getServiceSupabase>,
  userId: string,
) {
  // All orgs with at least one active requirement
  const { data: reqs } = await db
    .from("org_requirements")
    .select("id, org_id")
    .eq("active", true);
  if (!reqs?.length) return;

  // Deduplicate: one suggestion per org (use the first/oldest active req)
  const orgToReqId: Record<string, string> = {};
  for (const r of (reqs as { id: string; org_id: string }[]).reverse()) {
    orgToReqId[r.org_id] = r.id;
  }

  // Skip orgs where the candidate is already linked
  const { data: linked } = await db
    .from("candidate_organizations")
    .select("org_id")
    .eq("candidate_user_id", userId)
    .in("status", ["approved", "pending"]);
  const linkedIds = new Set(((linked ?? []) as { org_id: string }[]).map(l => l.org_id));

  // Skip orgs that already have a suggested_matches row for this candidate
  const { data: existing } = await db
    .from("suggested_matches")
    .select("org_id")
    .eq("candidate_user_id", userId);
  const suggestedIds = new Set(((existing ?? []) as { org_id: string }[]).map(s => s.org_id));

  const toInsert = Object.entries(orgToReqId)
    .filter(([orgId]) => !linkedIds.has(orgId) && !suggestedIds.has(orgId))
    .map(([orgId, reqId]) => ({
      candidate_user_id: userId,
      org_id:            orgId,
      requirement_id:    reqId,
      status:            "pending",
    }));

  if (toInsert.length > 0) {
    await db.from("suggested_matches").insert(toInsert);
  }
}

// PATCH — update candidate profile fields (admin or assigned sub-admin)
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

  // Allowlist filter — drop any field not in ALLOWED_PROFILE_FIELDS
  const cleanProfile: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile as Record<string, unknown>)) {
    if (ALLOWED_PROFILE_FIELDS.has(k)) cleanProfile[k] = v;
  }
  if (Object.keys(cleanProfile).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  const newPassportStatus = cleanProfile.passport_status as string | undefined;

  // When rejecting the passport, wipe all OCR-extracted fields in the same
  // atomic update — so the DB never holds stale rejected data that could
  // accidentally surface in the CV builder or admin panel.
  if (newPassportStatus === "rejected") {
    const OCR_FIELDS = [
      "first_name", "last_name", "dob", "sex",
      "nationality", "passport_no", "passport_expiry",
      "city_of_birth", "country_of_birth",
      "issuing_authority", "issue_date",
      "address_street", "address_number", "address_postal",
      "city_of_residence", "country_of_residence",
      "marital_status", "children_ages",
    ] as const;
    for (const f of OCR_FIELDS) cleanProfile[f] = null;
  }

  const db = getServiceSupabase();

  // Read prior passport_status so we can suppress duplicate reject notifications
  // when admin re-clicks reject on an already-rejected profile.
  let prevPassportStatus: string | null = null;
  if (newPassportStatus === "rejected" || newPassportStatus === "approved") {
    const { data: prior } = await db
      .from("candidate_profiles")
      .select("passport_status")
      .eq("user_id", userId)
      .maybeSingle();
    prevPassportStatus = (prior as { passport_status?: string | null } | null)?.passport_status ?? null;
  }

  const { data: updatedRows, error } = await db
    .from("candidate_profiles")
    .update(cleanProfile)
    .eq("user_id", userId)
    .select("user_id");

  if (error) {
    console.error("[admin PATCH] update profile failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Notify candidate when passport data is rejected — only on actual transition
  // into 'rejected' (admin re-clicking same button no longer resends).
  if (newPassportStatus === "rejected" && prevPassportStatus !== "rejected") {
    // Find the passport doc to link the notification to it
    const { data: passDocs } = await db
      .from("documents")
      .select("id, file_name, file_type")
      .eq("user_id", userId)
      .ilike("file_type", "%pass%")
      .order("uploaded_at", { ascending: false })
      .limit(1);
    const passDoc = passDocs?.[0];
    await db.from("notifications").insert({
      user_id:  userId,
      doc_id:   passDoc?.id ?? null,
      doc_name: passDoc?.file_name ?? "Passport",
      doc_type: passDoc?.file_type ?? "Passport",
      action:   "rejected",
      feedback: (cleanProfile.passport_feedback as string | null) ?? null,
      read:     false,
    });

    // Fire rejection email (fire-and-forget)
    db.auth.admin.getUserById(userId).then(({ data }) => {
      const email = data?.user?.email;
      if (!email) return;
      sendDocRejectedEmail(email, passDoc?.file_type ?? "Passport", (cleanProfile.passport_feedback as string | null) ?? null);
    }).catch(() => {});

    // Revoke blue-tick + placement-ready — both are outside ALLOWED_PROFILE_FIELDS
    // so we update them directly here.
    await db
      .from("candidate_profiles")
      .update({ manually_verified: false, placement_ready: false })
      .eq("user_id", userId);
  }

  // Auto blue-tick: passport data just approved — check if file is also approved
  if (newPassportStatus === "approved") {
    await maybeGrantVerified(db, userId);
  }

  return NextResponse.json({ success: true });
}
