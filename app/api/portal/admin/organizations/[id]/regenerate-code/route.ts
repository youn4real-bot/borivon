import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateInviteCode(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

/**
 * POST — generate a fresh invite code for an organization.
 * Used when the previous code has leaked and needs to be invalidated.
 *
 * Existing candidate links are NOT affected — they were created with the
 * old code but persist as direct user_id ↔ org_id rows.
 *
 * Returns: { invite_code: string }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const db = getServiceSupabase();

  // Try up to 5 times to find a non-colliding code
  let newCode = "";
  for (let i = 0; i < 5; i++) {
    const candidate = generateInviteCode(8);
    const { data: clash } = await db.from("organizations").select("id").eq("invite_code", candidate).maybeSingle();
    if (!clash) { newCode = candidate; break; }
  }
  if (!newCode) return NextResponse.json({ error: "Could not generate code" }, { status: 500 });

  const { error } = await db.from("organizations").update({ invite_code: newCode }).eq("id", id);
  if (error) {
    console.error("[regenerate-code] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ invite_code: newCode });
}
