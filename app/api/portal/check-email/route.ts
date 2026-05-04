import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// POST { email } → { exists: boolean }
// Used by the signup form to block re-registration for existing accounts.
// Uses service role so it can query auth.users without RLS.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ exists: false });

  const db = getServiceSupabase();
  let page = 1;
  while (true) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 50 });
    if (error) return NextResponse.json({ exists: false });
    const users = data?.users ?? [];
    if (users.some(u => (u.email ?? "").toLowerCase() === email)) {
      return NextResponse.json({ exists: true });
    }
    if (users.length < 50) break;
    page++;
  }
  return NextResponse.json({ exists: false });
}
