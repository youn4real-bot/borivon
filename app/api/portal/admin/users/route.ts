import { NextRequest } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";

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

  const [{ data: profiles }, { data: subAdmins }] = await Promise.all([
    db.from("candidate_profiles").select("user_id, first_name, last_name"),
    db.from("sub_admins").select("email"),
  ]);
  const authUsers = allAuthUsers;

  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.user_id, p]));
  const adminEmails = new Set((subAdmins ?? []).map((s: { email: string }) => s.email.toLowerCase()));

  const users = (authUsers ?? []).map(u => {
    const p = profileMap[u.id];
    // Prefer profile DB name → fall back to auth user_metadata set at signup
    const profileName = [p?.first_name, p?.last_name].filter(Boolean).join(" ");
    const metaName = (u.user_metadata?.full_name as string | undefined)?.trim()
      || [u.user_metadata?.first_name, u.user_metadata?.last_name].filter(Boolean).join(" ");
    const name = profileName || metaName || "";
    const role = adminEmails.has((u.email ?? "").toLowerCase()) ? "admin" : "candidate";
    return { id: u.id, email: u.email ?? "", name, role, createdAt: u.created_at };
  });

  // Sort: admins first, then by createdAt desc
  users.sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return Response.json({ users });
}
