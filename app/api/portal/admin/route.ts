import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { LABEL_TO_FILE_KEY } from "@/lib/fileKeys";
import { requireAdminRole, canActOnCandidate, getVisibleCandidateIds } from "@/lib/admin-auth";
import { DOC_STATUSES, ALLOWED_PROFILE_FIELDS } from "@/lib/constants";
import { sendDocApprovedEmail, sendDocRejectedEmail } from "@/lib/email";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";

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
    // Sub-admin — scope by visibility (LAW #25).
    // Regular sub-admins see all (null); org admins see only their org's candidates.
    const visibleIds = await getVisibleCandidateIds(token);
    // Regular sub-admin (null = no scope) sees every candidate → also surface
    // those with no documents yet. Org admins keep their scoped list.
    surfaceAllUsers = visibleIds === null;

    let q = db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id, uploaded_by_admin")
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
    docs = data ?? [];
  }

  // Fetch user metadata (reuse the same service-role client)
  const adminClient = getServiceSupabase();

  let userIds = [...new Set(docs.map((d: { user_id: string }) => d.user_id))];
  const users: Record<string, { email: string; name: string }> = {};

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

    let page = 1;
    while (true) {
      const { data: batch } = await adminClient.auth.admin.listUsers({ page, perPage: 50 });
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
      if (data?.user && !isSoftDeletedAuthUser(data.user)) {
        users[uid] = {
          email: data.user.email ?? uid,
          name: data.user.user_metadata?.full_name ?? data.user.email ?? uid,
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
      // doc.file_type may be a phase_slots UUID (B/V slot docs). Resolve to its
      // friendly label so the candidate's bell shows "Vollmacht wurde
      // genehmigt" instead of a raw UUID.
      let notifDocType = doc.file_type;
      const SLOT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (SLOT_UUID.test(notifDocType)) {
        const { data: slotRow } = await db
          .from("phase_slots").select("label").eq("id", notifDocType).maybeSingle();
        const slotLabel = (slotRow as { label?: string | null } | null)?.label;
        if (slotLabel) notifDocType = slotLabel;
      }
      const isPassportDoc = /pass/i.test(doc.file_type);

      if (status === "approved" && isPassportDoc) {
        // Passport PDF approved — do NOT notify on its own. The candidate is
        // only told once BOTH the PDF and the passport data are accepted.
        // The gate sends the combined "approved" notification + email iff the
        // data is also approved; otherwise it stays silent.
        await maybeNotifyPassportApproved(db, doc.user_id);
      } else {
        // Every other doc (and ALL rejections, incl. a rejected passport
        // scan so the candidate knows to re-take the photo) notify normally.
        await db.from("notifications").insert({
          user_id:  doc.user_id,
          doc_id:   docId,
          doc_name: doc.file_name,
          doc_type: notifDocType,
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
      }

      // Auto blue-tick: passport file just approved — check if data is also approved
      if (status === "approved" && isPassportDoc) {
        await maybeGrantVerified(db, doc.user_id);
      }
    }
  }

  return NextResponse.json({ success: true });
}

/** Full passport acceptance (PDF doc + data both approved) marks the
 *  candidate placement-ready and kicks off org match suggestions.
 *
 *  POLICY (changed): this NO LONGER grants the gold verified tick. The badge
 *  is now tied ONLY to (a) a paid premium subscription, or (b) an explicit
 *  supreme-admin grant in the Users tab. Passport approval just tells the
 *  candidate via the normal "approved" bell notification — no gold badge,
 *  no gold celebration, no verified email. Existing manually_verified users
 *  are never touched here. */
async function maybeGrantVerified(
  db: ReturnType<typeof getServiceSupabase>,
  userId: string,
) {
  const { data: profile } = await db
    .from("candidate_profiles")
    .select("passport_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.passport_status !== "approved") return;

  // Passport doc approved too?
  const { data: passDocs } = await db
    .from("documents")
    .select("status")
    .eq("user_id", userId)
    .ilike("file_type", "%pass%")
    .eq("status", "approved")
    .limit(1);
  if (!passDocs?.length) return;

  // Mark placement-ready ONCE (guard catches false AND NULL) — purely for
  // org matching, NOT verification. No gold tick is set.
  const { data: updated } = await db
    .from("candidate_profiles")
    .update({ placement_ready: true })
    .eq("user_id", userId)
    .not("placement_ready", "is", true)
    .select("user_id");
  if (!updated?.length) return; // already placement-ready

  maybeCreateMatches(db, userId).catch(e => console.warn("[maybeCreateMatches]", e));
}

/** Send the candidate's "passport approved" notification ONLY when BOTH the
 *  passport PDF document AND the passport data (passport_status) have been
 *  manually approved by an admin. Approving just one side (e.g. data correct
 *  but the scan is a blurry photo) must NOT notify — it's not a full passport
 *  acceptance. Idempotent: fires once per approval cycle. If the passport is
 *  later rejected and re-approved, the rejected notification resets the cycle
 *  so a fresh "approved" is sent again. */
async function maybeNotifyPassportApproved(
  db: ReturnType<typeof getServiceSupabase>,
  userId: string,
) {
  // Both sides must be approved.
  const { data: profile } = await db
    .from("candidate_profiles")
    .select("passport_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.passport_status !== "approved") return;

  const { data: passDocs } = await db
    .from("documents")
    .select("id, file_name, file_type, status")
    .eq("user_id", userId)
    .ilike("file_type", "%pass%")
    .order("uploaded_at", { ascending: false })
    .limit(1);
  const passDoc = passDocs?.[0];
  if (!passDoc || passDoc.status !== "approved") return;

  // Dedupe per cycle: look at the most recent passport approve/reject
  // notification. If it's already "approved", we've notified for this
  // acceptance — skip. If it's "rejected" (or none), this is a fresh full
  // acceptance → notify.
  const { data: lastNotif } = await db
    .from("notifications")
    .select("action")
    .eq("user_id", userId)
    .in("action", ["approved", "rejected"])
    .ilike("doc_type", "%pass%")
    .order("created_at", { ascending: false })
    .limit(1);
  if (lastNotif?.[0]?.action === "approved") return;

  await db.from("notifications").insert({
    user_id:  userId,
    doc_id:   passDoc.id,
    doc_name: passDoc.file_name,
    doc_type: passDoc.file_type,
    action:   "approved",
    feedback: null,
    read:     false,
  });

  db.auth.admin.getUserById(userId).then(({ data }) => {
    const email = data?.user?.email;
    if (email) sendDocApprovedEmail(email, passDoc.file_type);
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

    // Passport rejection clears placement-ready only. It must NOT touch
    // manually_verified anymore — the gold tick is now tied solely to a paid
    // subscription or an explicit admin grant, so a passport reject can't
    // strip a verification the candidate earned another way.
    await db
      .from("candidate_profiles")
      .update({ placement_ready: false })
      .eq("user_id", userId);
  }

  // Passport DATA approved → notify the candidate ONLY if the passport PDF
  // doc is ALSO approved (full acceptance). Approving just the data never
  // notifies on its own. Gate is idempotent + works for any admin tier
  // (PATCH already guarded by requireAdminRole + canActOnCandidate above).
  if (newPassportStatus === "approved" && prevPassportStatus !== "approved") {
    await maybeNotifyPassportApproved(db, userId);
  }

  // Auto blue-tick: passport data just approved — check if file is also approved
  if (newPassportStatus === "approved") {
    await maybeGrantVerified(db, userId);
  }

  return NextResponse.json({ success: true });
}
