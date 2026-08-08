import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";

/**
 * "Send to <agency>" — the button behind the whole partner API.
 *
 * Until this runs for a candidate, that person does not exist as far as the
 * partner's key is concerned. This is the ONLY thing that grants access, and
 * un-sharing revokes it on their very next request.
 *
 *   GET    ?candidateUserId=…  → which agencies this candidate is shared with
 *   POST   { candidateUserId, orgId }   → share
 *   DELETE { candidateUserId, orgId }   → un-share
 *
 * Borivon team only, and never an agency admin: letting a partner's own admin
 * press this would let them grant themselves candidates (LAW #25).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (auth.role !== "admin" && auth.isAgencyAdmin) {
    return { ok: false as const, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, auth };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.res;
  const candidateUserId = req.nextUrl.searchParams.get("candidateUserId") ?? "";
  if (!UUID_RE.test(candidateUserId)) return NextResponse.json({ error: "bad_candidate" }, { status: 400 });
  if (!(await canActOnCandidate(g.auth.role, g.auth.email, candidateUserId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("partner_shares")
    .select("org_id, shared_at, shared_by")
    .eq("candidate_user_id", candidateUserId)
    .is("revoked_at", null);
  if (error) return NextResponse.json({ shares: [], needsMigration: true, hint: "Run supabase/partner_api.sql" });

  const { data: orgs } = await db.from("organizations").select("id, name");
  const orgName = new Map(((orgs ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  return NextResponse.json({
    shares: ((data ?? []) as Record<string, unknown>[]).map((s) => ({
      orgId: s.org_id,
      agency: orgName.get(String(s.org_id)) ?? null,
      sharedAt: s.shared_at,
      sharedBy: s.shared_by,
    })),
    organizations: (orgs ?? []),
  });
}

export async function POST(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({}));
  const candidateUserId = String((body as { candidateUserId?: unknown }).candidateUserId ?? "");
  const orgId = String((body as { orgId?: unknown }).orgId ?? "");
  if (!UUID_RE.test(candidateUserId) || !UUID_RE.test(orgId)) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  if (!(await canActOnCandidate(g.auth.role, g.auth.email, candidateUserId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  // Upsert on (org, candidate) and clear revoked_at, so re-sharing somebody who
  // was pulled back works and keeps the original row.
  const { error } = await db.from("partner_shares").upsert(
    {
      org_id: orgId,
      candidate_user_id: candidateUserId,
      shared_at: new Date().toISOString(),
      shared_by: g.auth.email,
      revoked_at: null,
    },
    { onConflict: "org_id,candidate_user_id" },
  );
  if (error) {
    console.error("[partner-share POST] failed:", error.message);
    return NextResponse.json({ error: "share_failed", hint: "Run supabase/partner_api.sql" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({}));
  const candidateUserId = String((body as { candidateUserId?: unknown }).candidateUserId ?? "");
  const orgId = String((body as { orgId?: unknown }).orgId ?? "");
  if (!UUID_RE.test(candidateUserId) || !UUID_RE.test(orgId)) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  if (!(await canActOnCandidate(g.auth.role, g.auth.email, candidateUserId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Revoked, not deleted — "who did we send this person to, and when" must stay
  // answerable after the fact.
  const { error } = await getServiceSupabase()
    .from("partner_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("candidate_user_id", candidateUserId)
    .is("revoked_at", null);
  if (error) return NextResponse.json({ error: "unshare_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
