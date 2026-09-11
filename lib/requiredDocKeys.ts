/**
 * Which required-papers set applies to each candidate — the agency behind her
 * site first, else an agency she joined herself (never an admin-placed link).
 *
 * The SAME resolution GET /api/portal/admin uses for the list's % and the
 * candidate's own phase-slots request uses for what she sees. Any screen that
 * scores papers must use it too, or the same nurse reads "100%" in the list and
 * "incomplete" in a search filter.
 *
 * Fail-open: any table missing or unreadable → no override (the built-in
 * default set), never an error.
 */
import type { getServiceSupabase } from "@/lib/supabase";

export async function requiredKeysByUser(
  db: ReturnType<typeof getServiceSupabase>,
  ids: string[],
  employerOf: (uid: string) => string | null | undefined,
): Promise<Map<string, string[] | null>> {
  const out = new Map<string, string[] | null>();
  if (!ids.length) return out;
  try {
    const [empRes, orgRes, linkRes] = await Promise.all([
      db.from("employers").select("id, agency_id"),
      db.from("organizations").select("id, required_doc_keys"),
      db.from("candidate_organizations").select("candidate_user_id, org_id, added_by")
        .eq("status", "approved").in("candidate_user_id", ids),
    ]);
    const agencyByEmp = new Map(((empRes.data ?? []) as { id: string; agency_id: string | null }[]).map(e => [e.id, e.agency_id]));
    const reqByOrg = new Map(((orgRes.data ?? []) as { id: string; required_doc_keys: string[] | null }[]).map(o => [o.id, o.required_doc_keys]));
    const selfOrg = new Map<string, string>();
    for (const l of (linkRes.data ?? []) as { candidate_user_id: string; org_id: string; added_by: string | null }[]) {
      if (l.added_by !== "admin" && !selfOrg.has(l.candidate_user_id)) selfOrg.set(l.candidate_user_id, l.org_id);
    }
    for (const uid of ids) {
      const emp = employerOf(uid) ?? null;
      const orgId = (emp && agencyByEmp.get(emp)) || selfOrg.get(uid) || null;
      out.set(uid, orgId ? reqByOrg.get(orgId) ?? null : null);
    }
  } catch { /* → default set for everyone */ }
  return out;
}
