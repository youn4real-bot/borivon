import { NextRequest } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  // Paginate auth users — listUsers returns at most perPage per call.
  // Loop until a page comes back short (no more users) or we hit the safety
  // cap of 50 pages (50 000 users) to avoid runaway loops.
  const PER_PAGE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allAuthUsers: any[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data: { users: batch } } = await db.auth.admin.listUsers({ perPage: PER_PAGE, page });
    allAuthUsers.push(...(batch ?? []));
    if ((batch ?? []).length < PER_PAGE) break;
  }
  // Hide soft-deleted accounts (single source of truth: lib/softDeleted.ts).
  for (let i = allAuthUsers.length - 1; i >= 0; i--) {
    if (isSoftDeletedAuthUser(allAuthUsers[i])) allAuthUsers.splice(i, 1);
  }

  const [{ data: profiles }, { data: subAdmins }, { data: orgMembers }] = await Promise.all([
    db.from("candidate_profiles").select("user_id, first_name, last_name, profile_photo, manually_verified"),
    db.from("sub_admins").select("email, is_agency_admin"),
    db.from("organization_members").select("sub_admin_email"),
  ]);
  const authUsers = allAuthUsers;

  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.user_id, p]));
  // Classify each account into one of three "kinds":
  //   borivon   → supreme admin (ADMIN_EMAIL) or a regular sub-admin → black tick, "A"
  //   org       → admin of a partner organization                  → red tick,   "O"
  //   candidate → everyone else                                    → gold tick,  "K"
  const supremeEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const subMap = new Map<string, boolean>(
    (subAdmins ?? []).map((s: { email: string; is_agency_admin?: boolean | null }) =>
      [s.email.toLowerCase(), !!s.is_agency_admin]),
  );
  const orgMemberEmails = new Set(
    (orgMembers ?? [])
      .map((m: { sub_admin_email?: string | null }) => (m.sub_admin_email ?? "").toLowerCase())
      .filter(Boolean),
  );

  const users = (authUsers ?? []).map(u => {
    const p = profileMap[u.id];
    // Prefer profile DB name → fall back to auth user_metadata set at signup
    const profileName = [p?.first_name, p?.last_name].filter(Boolean).join(" ");
    const metaName = (u.user_metadata?.full_name as string | undefined)?.trim()
      || [u.user_metadata?.first_name, u.user_metadata?.last_name].filter(Boolean).join(" ");
    const name = profileName || metaName || "";
    const email = (u.email ?? "").toLowerCase();

    // Order matters: org members are also written into sub_admins (with
    // is_agency_admin=false), so the organization_members check must win over
    // the "plain sub-admin = borivon" fallback.
    let kind: "borivon" | "org" | "candidate";
    if (supremeEmail && email === supremeEmail) {
      kind = "borivon";                         // supreme Borivon admin
    } else if (subMap.get(email) === true) {
      kind = "org";                             // is_agency_admin → org admin
    } else if (orgMemberEmails.has(email)) {
      kind = "org";                             // member of a partner org
    } else if (subMap.has(email)) {
      kind = "borivon";                         // regular Borivon sub-admin
    } else {
      kind = "candidate";
    }
    const role = kind === "candidate" ? "candidate" : "admin"; // back-compat

    return {
      id: u.id,
      email: u.email ?? "",
      name,
      role,
      kind,
      createdAt: u.created_at,
      photo: (p as { profile_photo?: string | null } | undefined)?.profile_photo ?? null,
      verified: !!(p as { manually_verified?: boolean | null } | undefined)?.manually_verified,
    };
  });

  // Sort: admins first, then by createdAt desc
  users.sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return Response.json({ users });
}
