import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { sendPlacedEmail } from "@/lib/email";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MatchRow = {
  id: string;
  candidate_user_id: string;
  org_id: string;
  requirement_id: string | null;
  status: string;
  suggested_at: string;
};
type ReqRow = { id: string; specialty: string | null; slots: number; location: string | null; start_date: string | null };

/** GET — list all pending suggested matches with enriched candidate + org details. */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getServiceSupabase();

  const { data: matches } = await db
    .from("suggested_matches")
    .select("id, candidate_user_id, org_id, requirement_id, status, suggested_at")
    .eq("status", "pending")
    .order("suggested_at", { ascending: false });

  const rows = (matches ?? []) as MatchRow[];
  if (!rows.length) return NextResponse.json({ matches: [] });

  // Enrich: org names
  const orgIds = [...new Set(rows.map(r => r.org_id))];
  const { data: orgs } = await db.from("organizations").select("id, name").in("id", orgIds);
  const orgById: Record<string, string> = {};
  for (const o of (orgs ?? []) as { id: string; name: string }[]) orgById[o.id] = o.name;

  // Enrich: requirement details
  const reqIds = [...new Set(rows.map(r => r.requirement_id).filter(Boolean))] as string[];
  let reqById: Record<string, ReqRow> = {};
  if (reqIds.length > 0) {
    const { data: reqs } = await db
      .from("org_requirements")
      .select("id, specialty, slots, location, start_date")
      .in("id", reqIds);
    for (const r of (reqs ?? []) as ReqRow[]) reqById[r.id] = r;
  }

  // Enrich: candidate names from auth.users
  const adminClient = getServiceSupabase();
  const candidateIds = [...new Set(rows.map(r => r.candidate_user_id))];
  const candidateInfo: Record<string, { name: string; email: string }> = {};
  await Promise.all(candidateIds.map(async uid => {
    try {
      const { data } = await adminClient.auth.admin.getUserById(uid);
      if (data?.user) {
        candidateInfo[uid] = {
          name:  data.user.user_metadata?.full_name ?? data.user.email ?? uid,
          email: data.user.email ?? uid,
        };
      }
    } catch { /* skip */ }
  }));

  const enriched = rows.map(r => ({
    id:              r.id,
    candidateUserId: r.candidate_user_id,
    candidateName:   candidateInfo[r.candidate_user_id]?.name  ?? r.candidate_user_id,
    candidateEmail:  candidateInfo[r.candidate_user_id]?.email ?? "",
    orgId:           r.org_id,
    orgName:         orgById[r.org_id] ?? "(deleted)",
    requirement:     r.requirement_id ? (reqById[r.requirement_id] ?? null) : null,
    suggestedAt:     r.suggested_at,
  }));

  return NextResponse.json({ matches: enriched });
}

/** POST — accept or skip a match.
 *  Body: { matchId, action: "accepted" | "skipped" } */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
  const action  = typeof body.action  === "string" ? body.action.trim()  : "";
  if (!UUID_RE.test(matchId)) return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
  if (action !== "accepted" && action !== "skipped") {
    return NextResponse.json({ error: "action must be 'accepted' or 'skipped'" }, { status: 400 });
  }

  const db = getServiceSupabase();

  const { data: match } = await db
    .from("suggested_matches")
    .select("id, candidate_user_id, org_id, status")
    .eq("id", matchId)
    .eq("status", "pending")
    .maybeSingle();

  if (!match) return NextResponse.json({ error: "Match not found or already decided" }, { status: 404 });

  // Mark match decided
  await db.from("suggested_matches").update({
    status:     action,
    decided_at: new Date().toISOString(),
    decided_by: auth.email,
  }).eq("id", matchId);

  if (action === "accepted") {
    // Upsert candidate → org link
    const { data: existing } = await db
      .from("candidate_organizations")
      .select("status")
      .eq("candidate_user_id", match.candidate_user_id)
      .eq("org_id", match.org_id)
      .maybeSingle();

    if (existing) {
      await db.from("candidate_organizations").update({
        status:      "approved",
        approved_at: new Date().toISOString(),
        approved_by: auth.email,
      }).eq("candidate_user_id", match.candidate_user_id).eq("org_id", match.org_id);
    } else {
      await db.from("candidate_organizations").insert({
        candidate_user_id: match.candidate_user_id,
        org_id:            match.org_id,
        status:            "approved",
        added_by:          "admin",
        approved_at:       new Date().toISOString(),
        approved_by:       auth.email,
      });
    }

    // Notify candidate
    const { data: org } = await db
      .from("organizations")
      .select("name")
      .eq("id", match.org_id)
      .maybeSingle();

    const orgName = (org as { name: string } | null)?.name ?? "Organisation";
    await db.from("notifications").insert({
      user_id:  match.candidate_user_id,
      doc_id:   null,
      doc_name: orgName,
      doc_type: "placement",
      action:   "placed",
      feedback: null,
      read:     false,
    });

    // Fire placement email (fire-and-forget)
    db.auth.admin.getUserById(match.candidate_user_id).then(({ data }) => {
      const email = data?.user?.email;
      if (email) sendPlacedEmail(email, orgName);
    }).catch(() => {});
  }

  return NextResponse.json({ success: true });
}
