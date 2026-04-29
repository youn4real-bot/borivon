import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { LABEL_TO_FILE_KEY } from "@/lib/fileKeys";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

// Allowlist of profile columns sub-admins / admins are permitted to update via PATCH.
// Anything outside this list is silently dropped, preventing mass-assignment.
const ALLOWED_PROFILE_FIELDS = new Set<string>([
  "first_name", "last_name", "dob", "sex", "nationality",
  "passport_no", "passport_expiry", "city_of_birth", "country_of_birth",
  "issuing_authority", "issue_date",
  "address_street", "address_number", "address_postal",
  "city_of_residence", "country_of_residence",
  "passport_status", "passport_feedback",
  "marital_status", "children_ages",
]);

// GET — fetch candidates + their docs (filtered for sub-admins)
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { role, email: token } = auth;

  const db = getServiceSupabase();

  let docs;
  if (role === "admin") {
    // Full admin — all docs
    const { data, error } = await db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
      .order("uploaded_at", { ascending: false });
    if (error) { console.error("[admin GET] documents query failed:", error); return NextResponse.json({ error: "Internal error" }, { status: 500 }); }
    docs = data ?? [];
  } else {
    // Sub-admin — only assigned candidates
    const { data: assignments } = await db
      .from("sub_admin_assignments")
      .select("candidate_user_id")
      .eq("sub_admin_email", token);

    const assignedIds = (assignments ?? []).map((a: { candidate_user_id: string }) => a.candidate_user_id);

    if (assignedIds.length === 0) {
      return NextResponse.json({ docs: [], users: {}, role });
    }

    const { data, error } = await db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
      .in("user_id", assignedIds)
      .order("uploaded_at", { ascending: false });

    if (error) { console.error("[admin GET] documents query failed:", error); return NextResponse.json({ error: "Internal error" }, { status: 500 }); }
    docs = data ?? [];
  }

  // Fetch user metadata
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  );

  const userIds = [...new Set(docs.map((d: { user_id: string }) => d.user_id))];
  const users: Record<string, { email: string; name: string }> = {};
  // One missing/deleted user shouldn't 500 the whole admin page — swallow
  // individual lookup failures and leave that uid out of the map.
  await Promise.all(userIds.map(async (uid) => {
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

  // Fetch passport profiles (all fields)
  const { data: profileRows } = await db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, dob, sex, nationality, passport_no, passport_expiry, city_of_birth, country_of_birth, issuing_authority, issue_date, address_street, address_number, address_postal, city_of_residence, country_of_residence, passport_status, passport_feedback, marital_status, children_ages")
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
  }> = {};
  for (const p of profileRows ?? []) {
    profiles[p.user_id] = p;
  }

  // ── Deduplicate: per (user_id, fileKey) keep only the most-recent doc ─────────
  // Docs are already sorted uploaded_at DESC so first occurrence = latest version.
  // Older versions go into docHistory so admin can view upload trail.
  const seen = new Set<string>();
  const activeDocs: typeof docs = [];
  const docHistory: typeof docs = [];
  for (const d of docs) {
    const fk   = LABEL_TO_FILE_KEY[(d as { file_type: string }).file_type] ?? (d as { file_type: string }).file_type;
    const slot = `${(d as { user_id: string }).user_id}:${fk}`;
    if (!seen.has(slot)) { seen.add(slot); activeDocs.push(d); }
    else                  docHistory.push(d);
  }

  return NextResponse.json({ docs: activeDocs, docHistory, users, profiles, role });
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
  if (!["approved", "rejected", "pending"].includes(status)) {
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
      .single();

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
    }
  }

  return NextResponse.json({ success: true });
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

  const db = getServiceSupabase();
  const { error } = await db
    .from("candidate_profiles")
    .update(cleanProfile)
    .eq("user_id", userId);

  if (error) {
    console.error("[admin PATCH] update profile failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
