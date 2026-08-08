/**
 * Authenticating a partner agency's request, and deciding what it may see.
 *
 * This is the whole security boundary of the partner API. Two rules, and both
 * are enforced here rather than in any route:
 *
 *   1. A key belongs to exactly ONE organisation.
 *   2. A key can only reach candidates the founder has EXPLICITLY shared with
 *      that organisation, by pressing "Send to <agency>" on that person.
 *
 * There is deliberately no "list every candidate" path anywhere. If a share row
 * does not exist, the candidate does not exist as far as the API is concerned —
 * a request for them answers 404, exactly as it would for a made-up id, so the
 * API cannot be used to probe whether somebody is on our books.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { extractPartnerKey, hashPartnerKey, looksLikePartnerKey } from "@/lib/partnerKeys";

export type PartnerAuthOk = { ok: true; keyId: string; orgId: string };
export type PartnerAuthFail = { ok: false; status: 401 | 403 | 429; error: string };
export type PartnerAuth = PartnerAuthOk | PartnerAuthFail;

/**
 * Resolve the caller. Returns the organisation the key belongs to, or a failure
 * with the status the route should answer.
 *
 * A REVOKED key is rejected here by the query itself (`revoked_at is null`), so
 * revoking in the admin panel takes effect on the very next request — there is
 * no cache to wait out.
 */
export async function requirePartner(req: { headers: { get(n: string): string | null } }): Promise<PartnerAuth> {
  const key = extractPartnerKey(req.headers);
  // Shape-check first so a scanner spraying junk never reaches the database.
  if (!looksLikePartnerKey(key)) return { ok: false, status: 401, error: "missing_or_malformed_api_key" };

  const hash = await hashPartnerKey(key as string);
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("partner_api_keys")
    .select("id, org_id, revoked_at")
    .eq("key_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  // A lookup FAILURE is not an authorisation. Fail closed: if we cannot check
  // the key, nobody gets in.
  if (error) {
    console.error("[partner auth] key lookup failed:", error.message);
    return { ok: false, status: 401, error: "invalid_api_key" };
  }
  if (!data) return { ok: false, status: 401, error: "invalid_api_key" };

  const row = data as { id: string; org_id: string };

  // Best-effort "last seen", so a key that stops being used is visible in the
  // admin list. Never blocks the request.
  db.from("partner_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id)
    .then(undefined, () => { /* ignore */ });

  return { ok: true, keyId: row.id, orgId: row.org_id };
}

/**
 * Has this candidate been shared with this organisation, and not un-shared?
 *
 * Every candidate-scoped route calls this. It is the button's teeth.
 */
export async function isSharedWithPartner(orgId: string, candidateUserId: string): Promise<boolean> {
  try {
    const { data, error } = await getServiceSupabase()
      .from("partner_shares")
      .select("id")
      .eq("org_id", orgId)
      .eq("candidate_user_id", candidateUserId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) return false; // fail closed
    return !!data;
  } catch {
    return false;
  }
}

/** Every candidate currently shared with this organisation. */
export async function sharedCandidateIds(orgId: string): Promise<string[]> {
  try {
    const { data, error } = await getServiceSupabase()
      .from("partner_shares")
      .select("candidate_user_id")
      .eq("org_id", orgId)
      .is("revoked_at", null);
    if (error) return [];
    return [...new Set(((data ?? []) as { candidate_user_id: string }[]).map((r) => r.candidate_user_id))];
  } catch {
    return [];
  }
}

/**
 * Record what the partner fetched.
 *
 * Without this, "did Calmaroi ever download her passport?" has no answer — and
 * that is a question a candidate, or a regulator, is entitled to ask. Never
 * throws and never blocks the response.
 */
export async function logPartnerAccess(entry: {
  keyId: string | null;
  orgId: string | null;
  path: string;
  candidateUserId?: string | null;
  documentId?: string | null;
  status: number;
}): Promise<void> {
  try {
    await getServiceSupabase().from("partner_api_log").insert({
      key_id: entry.keyId,
      org_id: entry.orgId,
      path: entry.path.slice(0, 300),
      candidate_user_id: entry.candidateUserId ?? null,
      document_id: entry.documentId ?? null,
      status: entry.status,
    });
  } catch {
    /* the log must never be the reason a request fails */
  }
}
