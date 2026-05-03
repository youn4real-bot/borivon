import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

// Cache the admin user_id lookup for the lifetime of this serverless container
// so repeated calls (one per candidate message load) don't scan auth.users each time.
let _adminUserId: string | null | undefined = undefined; // undefined = not yet fetched

async function getAdminUserId(): Promise<string | null> {
  if (_adminUserId !== undefined) return _adminUserId;

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) { _adminUserId = null; return null; }

  const db = getServiceSupabase();
  // Page through users in small batches until we find the admin or exhaust the list.
  let page = 1;
  while (true) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 50 });
    const users = data?.users ?? [];
    const found = users.find(u => (u.email ?? "").toLowerCase() === adminEmail);
    if (found) { _adminUserId = found.id; return found.id; }
    if (users.length < 50) break; // last page
    page++;
  }
  _adminUserId = null;
  return null;
}

/**
 * GET /api/portal/admin-photo
 * Returns the main admin's profile photo URL (or null).
 * Used by candidate-side chat to show the real admin avatar.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const adminUserId = await getAdminUserId();
  if (!adminUserId) return NextResponse.json({ photo: null });

  const db = getServiceSupabase();
  const { data } = await db
    .from("candidate_profiles")
    .select("profile_photo")
    .eq("user_id", adminUserId)
    .maybeSingle();

  const photo = (data as { profile_photo?: string | null } | null)?.profile_photo ?? null;
  return NextResponse.json({ photo });
}
