import { NextRequest } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  const [{ data: { users: authUsers } }, { data: profiles }, { data: subAdmins }] = await Promise.all([
    db.auth.admin.listUsers({ perPage: 1000, page: 1 }),
    db.from("candidate_profiles").select("user_id, first_name, last_name"),
    db.from("sub_admins").select("email"),
  ]);

  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.user_id, p]));
  const adminEmails = new Set((subAdmins ?? []).map((s: { email: string }) => s.email.toLowerCase()));

  const users = (authUsers ?? []).map(u => {
    const p = profileMap[u.id];
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "";
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
