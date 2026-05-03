import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

// Avoid 0/O, 1/I/L — easier to dictate over the phone
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateInviteCode(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

/**
 * GET — list all organizations with member + candidate counts.
 *
 * Returns:
 *   {
 *     orgs: [
 *       { id, name, invite_code, notes, created_at,
 *         memberCount, candidateCount, pendingCount }
 *     ]
 *   }
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin" && !auth.isAgencyAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getServiceSupabase();

  const orgsBase = db.from("organizations").select("id, name, invite_code, member_invite_code, notes, logo_filename, footer_text, created_at").order("created_at", { ascending: true });
  const [{ data: orgs }, { data: members }, { data: links }] = await Promise.all([
    auth.agencyId ? orgsBase.eq("agency_id", auth.agencyId) : orgsBase,
    db.from("organization_members").select("org_id, sub_admin_email, role"),
    db.from("candidate_organizations").select("org_id, status"),
  ]);

  type OrgRow = { id: string; name: string; invite_code: string; member_invite_code: string | null; notes: string | null; logo_filename: string | null; footer_text: string | null; created_at: string };
  type MemberRow = { org_id: string; sub_admin_email: string; role: string };
  type LinkRow = { org_id: string; status: string };

  const memberCounts: Record<string, number> = {};
  for (const m of (members ?? []) as MemberRow[]) {
    memberCounts[m.org_id] = (memberCounts[m.org_id] ?? 0) + 1;
  }

  const candidateCounts: Record<string, number> = {};
  const pendingCounts:   Record<string, number> = {};
  for (const l of (links ?? []) as LinkRow[]) {
    if (l.status === "approved") candidateCounts[l.org_id] = (candidateCounts[l.org_id] ?? 0) + 1;
    if (l.status === "pending")  pendingCounts[l.org_id]   = (pendingCounts[l.org_id]   ?? 0) + 1;
  }

  const decorated = ((orgs ?? []) as OrgRow[]).map(o => ({
    ...o,
    memberCount:    memberCounts[o.id]    ?? 0,
    candidateCount: candidateCounts[o.id] ?? 0,
    pendingCount:   pendingCounts[o.id]   ?? 0,
  }));

  return NextResponse.json({ orgs: decorated });
}

/**
 * POST — create a new organization.
 * Body: { name: string, notes?: string, inviteCode?: string }
 * If inviteCode is omitted, a random 8-char code is generated.
 * If the chosen code is taken, returns 409.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name  = typeof body?.name  === "string" ? body.name.trim().slice(0, 200)  : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 500) : "";
  let code   = typeof body?.inviteCode === "string"
    ? body.inviteCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32)
    : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const db = getServiceSupabase();

  // Generate a unique code if none provided. Retry up to 5 times on collision.
  if (!code) {
    for (let i = 0; i < 5; i++) {
      const candidate = generateInviteCode(8);
      const { data: clash } = await db.from("organizations").select("id").eq("invite_code", candidate).maybeSingle();
      if (!clash) { code = candidate; break; }
    }
    if (!code) return NextResponse.json({ error: "Could not generate code" }, { status: 500 });
  } else {
    // If admin chose a custom code, make sure it's available
    const { data: clash } = await db.from("organizations").select("id").eq("invite_code", code).maybeSingle();
    if (clash) return NextResponse.json({ error: "Code already in use" }, { status: 409 });
  }

  // Generate a unique member invite code (UUID-based, lowercase)
  const memberCode = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

  const { data, error } = await db.from("organizations").insert({
    name, notes: notes || null, invite_code: code, member_invite_code: memberCode,
  }).select("id, name, invite_code, member_invite_code, notes, created_at").single();

  if (error || !data) {
    console.error("[organizations POST] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ org: data });
}
