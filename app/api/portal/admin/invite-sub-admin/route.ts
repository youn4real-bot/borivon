import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  const code =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  const { error } = await db.from("invite_tokens").insert({
    org_id: null,
    type: "sub-admin",
    code,
    agency_id: auth.agencyId ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const url = `${req.nextUrl.origin}/join/${code}`;
  return NextResponse.json({ url, code });
}
