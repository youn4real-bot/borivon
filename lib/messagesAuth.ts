/**
 * Shared authorization for the "Borivon Support" messaging inbox.
 *
 * "Borivon Support" is a SHARED inbox for the Borivon team: the supreme admin +
 * ALL Borivon sub-admins see the same candidate conversations and any of them
 * can reply (one identity to the candidate). Org admins / org members are NOT
 * part of it — anyone with an organization_members row, or sub_admins.is_agency_admin
 * = true, is org-side and blocked. Supreme (role "admin") is always Borivon team.
 *
 * FAILS CLOSED — any lookup error treats the caller as org-side (no team inbox).
 */
import { getServiceSupabase } from "@/lib/supabase";
import { ciEmail } from "@/lib/admin-auth";

export async function isOrgSide(
  db: ReturnType<typeof getServiceSupabase>,
  role: string,
  email: string,
): Promise<boolean> {
  if (role === "admin") return false; // supreme is always Borivon team
  // An org admin is a sub_admins row with is_agency_admin=true. Treat that as
  // org-side regardless of membership rows (an org admin invited but not yet a
  // member, or a casing mismatch, must never slip into the shared inbox).
  const { data: subRows, error: subErr } = await db
    .from("sub_admins")
    .select("is_agency_admin")
    .ilike("email", ciEmail(email))
    .limit(1);
  if (subErr) return true; // FAIL CLOSED — unknown role never gets the team inbox
  if (((subRows ?? [])[0] as { is_agency_admin?: boolean } | undefined)?.is_agency_admin === true) {
    return true;
  }
  const { data } = await db
    .from("organization_members")
    .select("sub_admin_email")
    .ilike("sub_admin_email", ciEmail(email))
    .limit(1);
  return !!(data ?? [])[0];
}
