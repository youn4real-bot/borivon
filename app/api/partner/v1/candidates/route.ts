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
    // EVERY field their intake form asks for, not just the headline ones.
    // The point of this API is that nobody retypes anything: if their portal
    // has a box for "place of birth" and we know it, it should arrive filled.
    // Sending only name + passport would leave an operator copying the rest by
    // hand off a PDF, which is the exact work this is meant to delete.
    db.from("candidate_profiles")
      // One literal string, not a joined array: supabase-js infers the row type
      // from the literal, and a computed one degrades it to an error type.
      .select("user_id, first_name, last_name, dob, sex, nationality, phone, passport_no, passport_expiry, issue_date, issuing_authority, city_of_birth, country_of_birth, address_street, address_number, address_postal, city_of_residence, country_of_residence, marital_status, children_ages, nursing_specialty, years_experience")
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
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
    return {
      id: uid,
      first_name: str(p.first_name),
      last_name: str(p.last_name),
      date_of_birth: str(p.dob),
      sex: str(p.sex),
      nationality: str(p.nationality),
      phone: str(p.phone),
      place_of_birth: {
        city: str(p.city_of_birth),
        country: str(p.country_of_birth),
      },
      address: {
        street: str(p.address_street),
        number: str(p.address_number),
        postal_code: str(p.address_postal),
        city: str(p.city_of_residence),
        country: str(p.country_of_residence),
      },
      passport: {
        number: str(p.passport_no),
        expiry: str(p.passport_expiry),
        issued_on: str(p.issue_date),
        issuing_authority: str(p.issuing_authority),
      },
      marital_status: str(p.marital_status),
      children_ages: str(p.children_ages),
      nursing_specialty: str(p.nursing_specialty),
      years_experience: p.years_experience ?? null,
      documents: byUser.get(uid) ?? [],
    };
  });

  await logPartnerAccess({ keyId: auth.keyId, orgId: auth.orgId, path: "/candidates", status: 200 });
  return NextResponse.json({ candidates, count: candidates.length });
}
