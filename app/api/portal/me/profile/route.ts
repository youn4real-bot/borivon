import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { parseProfileCols } from "@/lib/meApiRules";

/**
 * GET /api/portal/me/profile?cols=a,b,c[&userId=<own id>]
 *   → { profile: { …requested columns } | null }
 *
 * The caller's OWN candidate_profiles row — what the browser used to read
 * straight from Supabase under self-only row-level security (Supabase → D1
 * step P0). Columns come from a fixed allow-list (lib/meApiRules).
 *
 * SELF ONLY, deliberately. `userId` is accepted so call sites can pass the id
 * they always filtered on, but any id other than the caller's is refused —
 * exactly what RLS did. An admin-on-behalf path was tried and pulled after
 * review: the CV builder's passport overlay would then run for admins and
 * revert their LAW #37 overrides. Admin reads of a candidate go through the
 * existing /api/portal/admin/* routes.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const cols = parseProfileCols(req.nextUrl.searchParams.get("cols"));
  if (!cols) return NextResponse.json({ error: "Unknown or missing columns" }, { status: 400 });

  const want = req.nextUrl.searchParams.get("userId");
  if (want && want !== auth.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await getServiceSupabase()
    .from("candidate_profiles").select(cols.join(",")).eq("user_id", auth.userId).maybeSingle();
  if (error) return NextResponse.json({ error: "Internal error" }, { status: 500 });
  return NextResponse.json({ profile: data ?? null }, { headers: { "Cache-Control": "no-store" } });
}
