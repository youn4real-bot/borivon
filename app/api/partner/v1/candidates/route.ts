import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requirePartner, sharedCandidateIds, logPartnerAccess } from "@/lib/partnerAuth";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";

/**
 * GET /api/partner/v1/candidates
 *
 * Every candidate the founder has shared with the calling agency, each with the
 * list of documents available to download. This is the ONLY listing endpoint,
 * and it lists shares — not our roster. A candidate who has never had "Send to
 * <agency>" pressed simply is not here.
 *
 * Auth: Authorization: Bearer <key>  (or X-API-Key: <key>)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePartner(req);
  if (!auth.ok) {
    await logPartnerAccess({ keyId: null, orgId: null, path: "/candidates", status: auth.status });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // A partner polling us is expected; a partner hammering us is not.
  const rl = await enforceRateLimitDistributed(req, "partner-api", { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    await logPartnerAccess({ keyId: auth.keyId, orgId: auth.orgId, path: "/candidates", status: 429 });
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const ids = await sharedCandidateIds(auth.orgId);
  if (!ids.length) {
    await logPartnerAccess({ keyId: auth.keyId, orgId: auth.orgId, path: "/candidates", status: 200 });
    return NextResponse.json({ candidates: [], count: 0 });
  }

  const db = getServiceSupabase();
  const [{ data: profs }, { data: docs }] = await Promise.all([
    db.from("candidate_profiles")
      .select("user_id, first_name, last_name, dob, sex, nationality, passport_no, passport_expiry")
      .in("user_id", ids),
    // APPROVED and not archived only. A rejected phone photo of a certificate
    // must never reach a clinic through this pipe — that is exactly the mistake
    // the Drive-sharing tool was making before it was fixed.
    db.from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, file_sha256")
      .in("user_id", ids)
      .eq("status", "approved")
      .is("superseded_at", null),
  ]);

  const byUser = new Map<string, { id: string; file_name: string | null; file_type: string | null; uploaded_at: string | null; sha256: string | null }[]>();
  for (const d of (docs ?? []) as Record<string, unknown>[]) {
    const uid = String(d.user_id);
    byUser.set(uid, [...(byUser.get(uid) ?? []), {
      id: String(d.id),
      file_name: (d.file_name as string) ?? null,
      file_type: (d.file_type as string) ?? null,
      uploaded_at: (d.uploaded_at as string) ?? null,
      // Lets their side skip a download it already has, rather than re-fetching
      // every file on every poll.
      sha256: (d.file_sha256 as string) ?? null,
    }]);
  }

  const candidates = ((profs ?? []) as Record<string, unknown>[]).map((p) => {
    const uid = String(p.user_id);
    return {
      id: uid,
      first_name: (p.first_name as string) ?? null,
      last_name: (p.last_name as string) ?? null,
      date_of_birth: (p.dob as string) ?? null,
      sex: (p.sex as string) ?? null,
      nationality: (p.nationality as string) ?? null,
      passport_number: (p.passport_no as string) ?? null,
      passport_expiry: (p.passport_expiry as string) ?? null,
      documents: byUser.get(uid) ?? [],
    };
  });

  await logPartnerAccess({ keyId: auth.keyId, orgId: auth.orgId, path: "/candidates", status: 200 });
  return NextResponse.json({ candidates, count: candidates.length });
}
