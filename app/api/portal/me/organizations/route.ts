import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { isReadFailure, readFailureResponse } from "@/lib/readFailure";

/**
 * GET — return the caller's current organization links, FILTERED so the
 * candidate only ever sees orgs they joined themselves (invite code or
 * self-signup). Admin-initiated links (suggested-matches acceptance,
 * /organizations/[id]/candidates POST) are hidden from the candidate per
 * user request 2026-05: "the candidate should know nothing about
 * Calmaroi" / any agency-side organization. Those orgs are still useful
 * to admins, sub-admins, and back-office surfaces, which query their own
 * endpoints — this filter is candidate-self-view only.
 *
 *   { orgs: [{ id, name, status, addedAt, approvedAt }] }
 *
 * The candidate dashboard uses the `orgs` array to decide whether to show
 * the "Enter your organization code" first-screen modal — empty means no
 * self-joined org yet.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rl = await enforceUserRateLimit("me-read", `u:${auth.userId}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const db = getServiceSupabase();
  // A FAILED READ IS NOT "no organization". The dashboard opens the "enter your
  // organization code" first-screen modal precisely when this array is empty,
  // so swallowing the error here asked a candidate who joined months ago to
  // join again. Both halves now answer 503 instead of a confident empty list
  // (lib/readFailure.ts).
  const { data: links, error: linkErr } = await db
    .from("candidate_organizations")
    .select("org_id, status, added_at, approved_at, added_by")
    .eq("candidate_user_id", auth.userId)
    .neq("added_by", "admin");
  if (isReadFailure(linkErr)) {
    const f = readFailureResponse("me/organizations links", linkErr);
    return NextResponse.json(f.body, { status: f.status });
  }

  type LinkRow = { org_id: string; status: string; added_at: string; approved_at: string | null; added_by: string };
  const linkRows = (links ?? []) as LinkRow[];

  const orgIds = linkRows.map(l => l.org_id);
  type OrgRow = { id: string; name: string };
  let orgs: OrgRow[] = [];
  if (orgIds.length > 0) {
    const { data, error } = await db.from("organizations").select("id, name").in("id", orgIds);
    // Failing THIS one renames every org to "(deleted)" below, which reads as
    // "your agency is gone" — worse than saying the page could not load.
    if (isReadFailure(error)) {
      const f = readFailureResponse("me/organizations names", error);
      return NextResponse.json(f.body, { status: f.status });
    }
    orgs = (data ?? []) as OrgRow[];
  }
  const orgById: Record<string, OrgRow> = {};
  for (const o of orgs) orgById[o.id] = o;

  const result = linkRows.map(l => ({
    id:         l.org_id,
    name:       orgById[l.org_id]?.name ?? "(deleted)",
    status:     l.status,
    addedAt:    l.added_at,
    approvedAt: l.approved_at,
  }));
  return NextResponse.json({ orgs: result });
}
