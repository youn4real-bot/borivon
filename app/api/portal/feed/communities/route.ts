import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

/**
 * GET /api/portal/feed/communities
 *
 * Lists every community the caller can read / post into.
 *
 * Returned structure:
 *   { communities: [
 *       { kind: "global", id: null, name: "Borivon" },
 *       { kind: "org",    id: "<uuid>", name: "Calmaroi" },
 *       ...
 *   ] }
 *
 * Visibility rules:
 *   - Supreme admin: every org + the global community.
 *   - Org members:   only the orgs they're listed in (no global).
 *   - Candidates:    global + every approved-linked org community.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const isAdmin = auth.email === adminEmail;

  // Org IDs the user is a STAFF member of (sub_admin / org_member).
  // These users do NOT see the global Borivon community — that's the
  // candidate community.
  const { data: memberRows } = await db
    .from("organization_members")
    .select("org_id")
    .eq("sub_admin_email", auth.email);
  const memberOrgIds = ((memberRows ?? []) as { org_id: string }[]).map(r => r.org_id);

  // Org IDs the user is a CANDIDATE in (approved-linked).
  const { data: candRows } = await db
    .from("candidate_organizations")
    .select("org_id")
    .eq("candidate_user_id", auth.userId)
    .eq("status", "approved");
  const candOrgIds = ((candRows ?? []) as { org_id: string }[]).map(r => r.org_id);

  // Build ordered, de-duped org list and resolve names.
  const orgIds = [...new Set([...memberOrgIds, ...candOrgIds, ...(isAdmin ? [] : [])])];

  let allOrgIds = orgIds;
  if (isAdmin) {
    const { data: orgs } = await db.from("organizations").select("id");
    allOrgIds = ((orgs ?? []) as { id: string }[]).map(o => o.id);
  }

  let names: Record<string, string> = {};
  if (allOrgIds.length > 0) {
    const { data: orgs } = await db
      .from("organizations")
      .select("id, name")
      .in("id", allOrgIds);
    names = Object.fromEntries(
      ((orgs ?? []) as { id: string; name: string }[]).map(o => [o.id, o.name]),
    );
  }

  const communities: { kind: "global" | "org"; id: string | null; name: string }[] = [];

  // Global community — only candidates and supreme admin see it. Org members
  // (whose only role is internal staff for one org) do NOT.
  const isOrgMemberOnly = memberOrgIds.length > 0 && candOrgIds.length === 0 && !isAdmin;
  if (!isOrgMemberOnly) {
    communities.push({ kind: "global", id: null, name: "Borivon" });
  }

  for (const id of allOrgIds) {
    communities.push({ kind: "org", id, name: names[id] ?? "Organization" });
  }

  return NextResponse.json({ communities });
}
