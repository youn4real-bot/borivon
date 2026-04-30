import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

/**
 * POST — candidate redeems an organization invite code.
 *
 * Body: { code: string }
 *
 * Behavior:
 *   - Code lookup is case-insensitive and ignores spaces/dashes.
 *   - First org a candidate redeems = auto-approved (their primary org).
 *   - Subsequent codes (when they already have an approved org) = status='pending',
 *     waiting for the ultimate admin to approve.
 *   - Redeeming the same code twice is a no-op (idempotent).
 *
 * Returns: { org: { id, name }, status: 'approved' | 'pending' }
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const raw  = typeof body?.code === "string" ? body.code : "";
  // Normalize: strip spaces/dashes, uppercase. Codes never contain lowercase.
  const code = raw.toUpperCase().replace(/[\s-]+/g, "").trim();
  if (!code) return NextResponse.json({ error: "Code is required" }, { status: 400 });

  const db = getServiceSupabase();

  // Find the org by code (also try with the raw code in case dashes are part of it)
  const { data: orgByExact } = await db.from("organizations")
    .select("id, name").eq("invite_code", code).maybeSingle();
  const { data: orgByRaw }   = await db.from("organizations")
    .select("id, name").eq("invite_code", raw.toUpperCase().trim()).maybeSingle();
  const org = (orgByExact ?? orgByRaw) as { id: string; name: string } | null;
  if (!org) return NextResponse.json({ error: "Invalid code" }, { status: 404 });

  // Already linked? Return current state.
  const { data: existing } = await db.from("candidate_organizations")
    .select("status").eq("candidate_user_id", auth.userId).eq("org_id", org.id).maybeSingle();
  if (existing) {
    return NextResponse.json({ org, status: (existing as { status: string }).status });
  }

  // First org = auto-approved. Subsequent = pending.
  const { count } = await db.from("candidate_organizations")
    .select("org_id", { count: "exact", head: true })
    .eq("candidate_user_id", auth.userId)
    .eq("status", "approved");

  const isFirst = (count ?? 0) === 0;
  const status  = isFirst ? "approved" : "pending";

  const { error } = await db.from("candidate_organizations").insert({
    candidate_user_id: auth.userId,
    org_id: org.id,
    status,
    added_by: "self_signup",
    approved_at: isFirst ? new Date().toISOString() : null,
    approved_by: isFirst ? "auto" : null,
  });
  if (error) {
    console.error("[redeem-code] insert failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // Notify admin so they can review later (especially for 'pending' requests)
  try {
    await db.from("admin_notifications").insert({
      type: isFirst ? "org-join" : "org-request",
      user_email: auth.email,
      user_name: auth.email,
      doc_name: org.name,
      doc_type: status,
    });
  } catch { /* notifications are best-effort */ }

  return NextResponse.json({ org, status });
}
